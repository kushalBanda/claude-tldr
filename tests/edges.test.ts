import { expect, test } from 'claude-code/testing'

import type { Turn } from '../types'
import { bashWrites, classify, rmTargets } from '../hooks/classify'
import { detectRunner, parseResult } from '../hooks/tests-parse'
import { checkTurn } from '../hooks/trust'
import { goalOf } from '../hooks/turn'
import { groupSummary } from '../hooks/summary'

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
    ['mv old.ts new.ts', ['new.ts']],
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

test('classify: a compound search keeps only its first sub-command', async () => {
  expect(classify('Bash', { command: 'ls ~/.claude/skills | grep -i writ; cat docs/status.md' }, {}, false)).toEqual([{ kind: 'search', pattern: 'ls ~/.claude/skills' }])
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
  expect(groupSummary([call('Read', { file_path: 'src/a.ts' })])).toEqual(['Read src/a.ts'])
  expect(groupSummary(['a', 'b', 'c', 'a'].map(n => call('Read', { file_path: `src/${n}.ts` })))).toEqual(['Read src/a.ts, src/b.ts +1 more'])
  expect(groupSummary([call('Grep', { pattern: 'decodeToken' }), call('Grep', { pattern: 'x' })])).toEqual(['2 searches'])
  expect(groupSummary([call('Bash', { command: 'echo a > out/a.txt && echo b > out/b.txt && echo c > out/c.txt' })])).toEqual(['wrote out/a.txt, out/b.txt +1 more'])
})
