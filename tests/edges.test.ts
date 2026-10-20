import { expect, test } from 'claude-code/testing'

import type { Change, TestRun, Turn } from '../types'
import { byFolder, changeTotals, stepsOf, stepVerb } from '../hooks/steps'
import { bashWrites, classify, rmTargets } from '../hooks/classify'
import { detectRunner, parseResult } from '../hooks/tests-parse'
import { checkTurn } from '../hooks/trust'
import { goalOf } from '../hooks/turn'
import { paneRows } from '../hooks/draw/detail'
import { turnForDuration } from '../hooks/state'
import { groupSummary, logLine, logLines } from '../hooks/summary'

// Edge cases from the 2026-10-17 probe. See docs/ADRs/0009-read-bash-statically.md.

test('bash writes: quoted paths, sudo tee, cd, mv into a folder, git restore', async () => {
  const cases: [string, string[]][] = [
    ['echo hi > "my file.txt"', ['my file.txt']],
    ["echo hi > 'notes.md'", ['notes.md']],
    ['echo x | sudo tee /etc/hosts', ['/etc/hosts']],
    ['echo x | sudo tee -a /etc/hosts > /dev/null', ['/etc/hosts']],
    ['cd sub && echo x > out.txt', ['sub/out.txt']],
    ['cd app/src && cd .. && touch ready', ['app/ready']],
    ['cd /repo/app && echo x > a.txt', ['/repo/app/a.txt']],
    ['cd "$DIR" && echo x > a.txt', []],
    ['cd "$DIR" && echo x > /tmp/a.txt', ['/tmp/a.txt']],
    ['mv a.ts b.ts src/', ['src/a.ts', 'src/b.ts']],
    ['cp lib/a.ts dist/', ['dist/a.ts']],
    ['git checkout -- src/a.ts src/b.ts', ['src/a.ts', 'src/b.ts']],
    ['git checkout main', []],
    ['git restore src/a.ts', ['src/a.ts']],
    ['git restore -s HEAD~1 src/a.ts', ['src/a.ts']],
    ['git restore --staged src/a.ts', []],
    ['echo x >| forced.txt', ['forced.txt']],
  ]
  for (const [command, paths] of cases) expect([command, bashWrites(command)]).toEqual([command, paths])
})

test('bash writes: a path the text cannot name is dropped', async () => {
  for (const command of ['cat > $OUT <<EOF\nhi\nEOF', 'echo x > "$HOME/a"', 'echo x > `mktemp`', 'touch build/*.stamp'])
    expect([command, bashWrites(command)]).toEqual([command, []])
})

test('rm: --, quotes, sudo and cd', async () => {
  expect(rmTargets('rm -- -weird')).toEqual(['-weird'])
  expect(rmTargets('rm "old notes.md"')).toEqual(['old notes.md'])
  expect(rmTargets('sudo rm /etc/x.conf')).toEqual(['/etc/x.conf'])
  expect(rmTargets('cd sub && rm a.txt')).toEqual(['sub/a.txt'])
  expect(rmTargets('rm $TMPFILE')).toEqual([])
})

test('runners: quoted text and list-only runs are not test runs', async () => {
  const cases: [string, string | null][] = [
    ['echo "run npm test later"', null],
    ["git commit -m 'make pytest pass'", null],
    ['pytest --collect-only', null],
    ['pytest --co -q', null],
    ['npx jest --listTests', null],
    ['cargo test -- --list', null],
    ['go test -list . ./...', null],
    ['npx vitest list', null],
    ['pytest -k "not slow"', 'pytest'],
  ]
  for (const [command, runner] of cases) expect([command, detectRunner(command)]).toEqual([command, runner])
})

test('runners: make, just, tox, playwright, deno and unittest are found', async () => {
  const cases: [string, string][] = [
    ['make test', 'make test'],
    ['just test', 'just test'],
    ['tox -e py312', 'tox'],
    ['npx playwright test', 'playwright'],
    ['deno test -A', 'deno test'],
    ['python -m unittest discover', 'unittest'],
    ['python3 -m unittest tests.test_auth', 'unittest'],
  ]
  for (const [command, runner] of cases) expect([command, detectRunner(command)]).toEqual([command, runner])
})

test('runners: unittest summary', async () => {
  expect(parseResult('unittest', '....\nRan 5 tests in 0.004s\n\nOK (skipped=1)')).toEqual({ passed: 4, failed: 0, skipped: 1 })
  expect(parseResult('unittest', 'Ran 6 tests in 0.1s\n\nFAILED (failures=1, errors=1)')).toEqual({ passed: 4, failed: 2, skipped: 0 })
  expect(parseResult('unittest', 'Ran 3 tests in 0.1s\n\nOK (expected failures=1)')).toEqual({ passed: 2, failed: 0, skipped: 1 })
})

test('runners: playwright and deno summaries', async () => {
  expect(parseResult('playwright', 'Running 6 tests\n  1 failed\n    [chromium] login.spec.ts\n  1 skipped\n  4 passed (5.2s)')).toEqual({ passed: 4, failed: 1, skipped: 1 })
  expect(parseResult('deno test', 'ok | 5 passed | 0 failed | 1 ignored (20ms)')).toEqual({ passed: 5, failed: 0, skipped: 1 })
  expect(parseResult('deno test', 'FAILED | 3 passed | 2 failed (31ms)')).toEqual({ passed: 3, failed: 2, skipped: 0 })
})

test('runners: make test reads the summary of the runner it starts', async () => {
  expect(parseResult('make test', 'pytest -q\n12 passed in 1.62s')).toEqual({ passed: 12, failed: 0, skipped: 0 })
})

function turn(log: string[]): Turn {
  return { changes: [], testRuns: [], log } as unknown as Turn
}

function flag(log: string[], kind: string): string | undefined {
  return checkTurn(turn(log)).find(f => f.kind === kind)?.detail
}

test('trust: short git flags, refspec force and hard reset are flagged', async () => {
  const cases: [string, string][] = [
    ['git commit -n -m x', 'skipped hooks'],
    ['git commit -anm wip', 'skipped hooks'],
    ['git push -fu origin main', 'force push'],
    ['git push origin +main', 'force push'],
    ['git reset --hard HEAD~3', 'git reset --hard'],
  ]
  for (const [c, label] of cases) expect([c, flag([`Bash ${c}`], 'bypass')]).toEqual([c, label])
  for (const c of ['git commit -m "no tests"', 'git commit --amend --no-edit', 'git push -u origin feature', 'git reset HEAD~1', 'echo "git push --force"'])
    expect([c, flag([`Bash ${c}`], 'bypass')]).toEqual([c, undefined])
})

test('trust: bulk deletes are flagged by command', async () => {
  const cases: [string, string][] = [
    ["find . -name '*.pyc' -delete", 'ran find -delete'],
    ['find build -type f -exec rm {} +', 'ran find -delete'],
    ['git clean -fd', 'ran git clean'],
    ['ls *.log | xargs rm -f', 'ran xargs rm'],
  ]
  for (const [c, detail] of cases) expect([c, flag([`Bash ${c}`], 'deleted')]).toEqual([c, detail])
  for (const c of ['find . -name "*.py"', 'git clean -n', 'xargs echo'])
    expect([c, flag([`Bash ${c}`], 'deleted')]).toEqual([c, undefined])
})

test('classify: a quoted redirect target becomes a change', async () => {
  expect(classify('Bash', { command: 'echo hi > "/repo/my notes.md"' }, {}, false, '/repo')[0]).toEqual(
    { kind: 'change', change: { path: 'my notes.md', added: 0, removed: 0, viaBash: true, isTest: false, isDelete: false, outsideRoot: false, addsSkip: false } })
})

test('trust: a flag stays one short line, whatever the commands', async () => {
  const heredoc = "cat > t.ts <<'EOF'\ngit push --force origin main\nEOF"
  expect(flag([`Bash ${heredoc}`], 'bypass')).toBeUndefined()
  const log = ['Bash git push -f', 'Bash git commit --no-verify -m wip && git push --force origin main', 'Bash git reset --hard']
  const f = checkTurn(turn(log)).find(x => x.kind === 'bypass')
  expect(f?.detail).toBe('force push, skipped hooks, git reset --hard')
  expect(f?.items).toEqual(['git push -f', 'git commit --no-verify -m wip', 'git push --force origin main', 'git reset --hard'])
  const many = ['a', 'b', 'c', 'd'].map(n => ({ path: `src/${n}.py`, isDelete: true }))
  expect(checkTurn({ changes: many, testRuns: [], log: [] } as unknown as Turn)[0]?.detail).toBe('deleted src/a.py, src/b.py +2 more')
})

test('classify: sed -n reads the file, not its line range', async () => {
  expect(classify('Bash', { command: 'sed -n 28,100p hooks/a.ts' }, {}, false)).toEqual([{ kind: 'read', path: 'hooks/a.ts' }])
  expect(classify('Bash', { command: "sed -n '1,40p' tests/b.ts" }, {}, false)).toEqual([{ kind: 'read', path: 'tests/b.ts' }])
})

test('classify: a compound search keeps only its first sub-command, and its read counts too', async () => {
  expect(classify('Bash', { command: 'ls ~/.claude/skills | grep -i writ; cat docs/status.md' }, {}, false)).toEqual([{ kind: 'search', pattern: 'ls ~/.claude/skills' }, { kind: 'read', path: 'docs/status.md' }])
})

test('goal: a long prompt is cut at a word', async () => {
  const g = goalOf("Before we start these, let's actually have our ADRs in place. Let's store it under docs/ADRs.")
  expect(g).toBe("Before we start these, let's actually have our ADRs in place. Let's…")
})

test('bash writes: escaped quotes inside double quotes', async () => {
  expect(bashWrites(`sed -i '' "136s/\\[\\"'git push -f'/['git push -f'/" tests/edges.test.ts && sed -n 136p tests/edges.test.ts`)).toEqual(['tests/edges.test.ts'])
  expect(detectRunner('echo "say \\"npm test\\" twice"')).toBeNull()
})

test('summary: a line names what was read, searched and written', async () => {
  const call = (tool: string, input: unknown) => ({ tool, input, isRunning: false, isErrored: false })
  expect(groupSummary([call('Read', { file_path: 'src/a.ts' })]).map(p => p.text)).toEqual(['Read src/a.ts'])
  expect(groupSummary(['a', 'b', 'c', 'a'].map(n => call('Read', { file_path: `src/${n}.ts` }))).map(p => p.text)).toEqual(['Read src/a.ts, src/b.ts +1 more'])
  expect(groupSummary([call('Grep', { pattern: 'decodeToken' }), call('Grep', { pattern: 'x' })]).map(p => p.text)).toEqual(['2 searches'])
  expect(groupSummary([call('Bash', { command: 'echo a > out/a.txt && echo b > out/b.txt && echo c > out/c.txt' })]).map(p => p.text)).toEqual(['wrote out/a.txt, out/b.txt +1 more'])
})

test('bash writes: a variable the same command set names the path', async () => {
  expect(bashWrites(`S=/tmp/run/notify.sh; cat > "$S" <<'EOF'\necho hi\nEOF\nchmod +x "$S"`)).toEqual(['/tmp/run/notify.sh'])
  expect(bashWrites('export OUT=dist && echo x > ${OUT}/a.json')).toEqual(['dist/a.json'])
  expect(bashWrites('echo x > "$UNSET/a.json"')).toEqual([])
  expect(rmTargets('F=old.txt; rm "$F"')).toEqual(['old.txt'])
})

test('main screen: each "Baked for" line keeps the turn it first drew', async () => {
  const t = (id: string, startedAt: number, endedAt: number | null, toolUseIds = ['x']) => ({ id, startedAt, endedAt, toolUseIds }) as unknown as Turn
  const a = t('a', 0, 32_000)
  const b = t('b', 40_000, 127_000)
  const c = t('c', 130_000, null)
  const pins = new Map([['line-a', 'a']])
  // An old line redrawn later keeps its own turn, not the newest one.
  expect(turnForDuration([a, b, c], pins, 'line-a', 32_000, 200_000)?.id).toBe('a')
  // A new line takes the free turn nearest its length.
  expect(turnForDuration([a, b, c], pins, 'line-b', 87_000, 200_000)?.id).toBe('b')
  // A line for a turn with no tool calls draws the engine's own line, even when an older turn is free.
  const quiet = t('q', 150_000, 153_000, [])
  expect(turnForDuration([a, b, quiet], pins, 'line-q', 3_000, 200_000)).toBeNull()
})

const ch = (path: string, added: number, removed: number, more: Partial<Change> = {}) =>
  ({ path, added, removed, viaBash: false, isTest: false, isDelete: false, outsideRoot: false, addsSkip: false, ...more }) as Change

test('totals: counted lines leave out Bash writes and deletes', async () => {
  expect(changeTotals([ch('a.ts', 3, 1), ch('b.ts', 0, 0, { viaBash: true }), ch('c.ts', 0, 9, { isDelete: true })])).toEqual({ files: 3, added: 3, removed: 1, counted: true })
  expect(changeTotals([ch('a.ts', 0, 0, { viaBash: true })]).counted).toBe(false)
})

test('folders: files group by folder in first-change order, root files under ""', async () => {
  const f = byFolder([ch('src/a.ts', 1, 0), ch('README.md', 2, 0), ch('src/b.ts', 3, 1), ch('/etc/hosts', 0, 0, { viaBash: true })])
  expect(f.map(x => [x.dir, x.changes.length, x.added, x.removed])).toEqual([['src/', 2, 4, 1], ['', 1, 2, 0], ['/etc/', 1, 0, 0]])
})

test('steps: reads merge, repeats stack, a test-file edit is marked', async () => {
  const log = ['Read src/a.ts', 'Read src/b.ts', 'Read src/a.ts', 'Search decode', 'Edit src/a.ts +3 −1', 'Bash pytest -q · ✗ 2 failed', 'Edit tests/t.py +1 −1', 'Bash git status', 'Bash git status', 'Bash pytest -q · ✓ 9 passed', 'Bash wrote out/x.json', 'Bash deleted old.ts']
  const s = stepsOf({ log, changes: [ch('tests/t.py', 1, 1, { isTest: true })] })
  expect(s.map(x => [stepVerb(x.kind), x.text, x.count])).toEqual([
    ['Read', 'src/a.ts, src/b.ts', 1],
    ['Search', 'decode', 1],
    ['Edit', 'src/a.ts +3 −1', 1],
    ['Test', 'pytest -q ✗ 2 failed', 1],
    ['Edit', 'tests/t.py +1 −1', 1],
    ['Ran', 'git status', 2],
    ['Test', 'pytest -q ✓ 9 passed', 1],
    ['Write', 'out/x.json via Bash', 1],
    ['Delete', 'old.ts', 1],
  ])
  expect(s[3]!.ok).toBe(false)
  expect(s[4]!.isTest).toBe(true)
})

test('go test: top-level tests count once, a build error says so', async () => {
  const verbose = '=== RUN   TestA\n=== RUN   TestA/sub\n    --- PASS: TestA/sub (0.00s)\n--- PASS: TestA (0.00s)\n--- FAIL: TestB (0.00s)\nFAIL\nFAIL\tatlas/pkg/fields\t0.4s'
  expect(parseResult('go test', verbose)).toEqual({ passed: 1, failed: 1, skipped: 0, byLine: true })
  expect(parseResult('go test', '# atlas/pkg/fields\nkind.go:24:22: syntax error\nFAIL\tatlas/pkg/fields [build failed]\nFAIL')).toEqual({ passed: null, failed: null, skipped: null, note: 'build failed' })
  expect(parseResult('make test', 'go test ./...\nFAIL\tatlas/pkg/x [setup failed]').note).toBe('build failed')
})

test('steps: a multi-word runner is a Test step, back-to-back code edits merge, a test-file edit stands alone', async () => {
  const run = (command: string, out: Partial<TestRun>) => ({ kind: 'test', run: { command, runner: detectRunner(command), passed: null, failed: null, skipped: null, isError: false, ...out } }) as never
  const log = [
    logLine('Bash', [run('go test ./pkg/fields', { failed: 1, isError: true })], {}),
    logLine('Bash', [run('make test', { isError: true, note: 'build failed' })], {}),
    'Edit pkg/a.go +3 −1', 'Edit pkg/b.go +2 −0', 'Edit pkg/a.go +1 −1', 'Edit pkg/a_test.go +1 −2', 'Edit pkg/c.go +1 −0',
    logLine('mcp__codegraph__codegraph_explore', [{ kind: 'other' }] as never, { query: 'Batcher' }),
    logLine('WebFetch', [{ kind: 'other' }] as never, { url: 'https://duckdb.org/docs', prompt: 'how' }),
  ]
  expect(stepsOf({ log, changes: [ch('pkg/a_test.go', 1, 2, { isTest: true })] }).map(x => [stepVerb(x.kind), x.text])).toEqual([
    ['Test', 'go test ./pkg/fields ✗ 1 failed'],
    ['Test', 'make test ✗ build failed'],
    ['Edit', '2 files +6 −2 · pkg/a.go, pkg/b.go'],
    ['Edit', 'pkg/a_test.go +1 −2'],
    ['Edit', 'pkg/c.go +1 −0'],
    ['Ran', 'codegraph codegraph_explore Batcher'],
    ['Ran', 'WebFetch https://duckdb.org/docs'],
  ])
})

test('summary: more than two edits in one group read as one count', async () => {
  const edit = (f: string) => ({ tool: 'Edit', input: { file_path: f }, output: { structuredPatch: [{ lines: ['+x', '-y'] }] }, isRunning: false, isErrored: false })
  expect(groupSummary([edit('a.go'), edit('b.go')]).map(p => p.text)).toEqual(['a.go +1 −1', 'b.go +1 −1'])
  expect(groupSummary([edit('a.go'), edit('b.go'), edit('c.go')]).map(p => p.text)).toEqual(['edited 3 files +3 −3'])
})

test('changed pane: a big turn opens one line per folder, so it fits', async () => {
  const changes = Array.from({ length: 20 }, (_, i) => ch(`pkg/m${i % 4}/f${i}.go`, 2, 1))
  expect(paneRows({ changes, diffs: [] } as unknown as Turn, 'changed')).toBe(7)
})

test('sandbox: a test run chained with a read counts both; filtered go output drops its counts', async () => {
  const out = (stdout: string) => ({ stdout, stderr: '' })
  expect(classify('Bash', { command: 'go test ./pkg/fields; cat pkg/fields/kind_test.go' }, out('ok  \tatlas/pkg/fields\t0.4s'), false).map(c => c.kind)).toEqual(['test', 'read'])
  const piped = classify('Bash', { command: 'go test -v ./pkg/fields 2>&1 | grep -E "SpanKind|^ok"' }, out('    --- PASS: TestA/x (0.00s)\n    --- PASS: TestA/y (0.00s)\n--- PASS: TestA (0.00s)\nok'), false)[0]
  expect(piped).toMatchObject({ kind: 'test', run: { passed: null, failed: null } })
  const failing = classify('Bash', { command: 'go test ./... | grep FAIL' }, out('--- FAIL: TestB (0.00s)\nFAIL'), true)[0]
  expect(failing).toMatchObject({ kind: 'test', run: { failed: 1 } })
})

test('sandbox: Skill and TodoWrite count nowhere on the main screen', async () => {
  const call = (tool: string, input: unknown) => ({ tool, input, isRunning: false, isErrored: false })
  expect(groupSummary([call('Skill', { skill: 'golang-testing' }), call('TodoWrite', { todos: [] }), call('Read', { file_path: 'a.go' })]).map(p => p.text)).toEqual(['Read a.go'])
})

test('sandbox: a compound command counts each job, and the steps show each one', async () => {
  const out = { stdout: 'ok  \tatlas/pkg/fields\t0.4s', stderr: '' }
  const calls = classify('Bash', { command: 'rm docs/notes/b.md && go test ./pkg/fields | tail -3' }, out, false)
  expect(calls.map(c => c.kind)).toEqual(['test', 'change'])
  expect(calls[1]).toMatchObject({ change: { path: 'docs/notes/b.md', isDelete: true } })
  expect(logLines('Bash', calls, {})).toEqual(['Bash deleted docs/notes/b.md', 'Bash go test ./pkg/fields | tail -3 · ✓ ran'])
  // A write and a read of another file in one command; a heredoc body is not a command.
  expect(classify('Bash', { command: "cat src/a.ts > out/b.ts && head -5 'my notes.md'" }, {}, false).map(c => (c.kind === 'change' ? `w ${c.change.path}` : c.kind === 'read' ? `r ${c.path}` : c.kind))).toEqual(['w out/b.ts', 'r src/a.ts', 'r my notes.md'])
  expect(classify('Bash', { command: "cat > a.md <<'EOF'\ncat secret.txt\nEOF" }, {}, false).map(c => c.kind)).toEqual(['change'])
  // A failing test run still deleted what came before it.
  expect(classify('Bash', { command: 'rm old.go && go test ./...' }, { stdout: '--- FAIL: TestA (0.00s)', stderr: '' }, true).map(c => c.kind)).toEqual(['test', 'change'])
})

test('sandbox: a failing run behind a pipe or a wrapper summary is never green', async () => {
  const rtk = 'Go test: 20 passed, 2 failed in 1 packages\n═══\n\nfields (20 passed, 2 failed)\n  [FAIL] TestExtractSpanKind/present'
  const r = classify('Bash', { command: 'go test ./pkg/fields 2>&1 | tail -20' }, { stdout: rtk, stderr: '' }, false)[0]
  expect(r).toMatchObject({ kind: 'test', run: { passed: 20, failed: 2, isError: true } })
  expect(parseResult('go test', 'okRunning: go test -json ./pkg/fields\nGo test: 22 passed in 1 packages')).toEqual({ passed: 22, failed: 0, skipped: 0 })
  expect(parseResult('go test', 'DONE 22 tests, 1 skipped, 2 failures in 1.20s')).toEqual({ passed: 19, failed: 2, skipped: 1 })
})
