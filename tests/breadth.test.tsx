import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { bashWrites, classify } from '../hooks/classify'
import { detectRunner, parseResult } from '../hooks/tests-parse'
import { CALL_IDS, engine, play } from './fixtures/login-bug'

const FULL = { columns: 120, rows: 40, isFullscreen: true }
const MAIN = { columns: 120, rows: 40, isFullscreen: false }
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }
const call = (id: string) => ({ tool_use_id: id, tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false })
const group = (surface: 'terminal' | 'desktop' | 'vscode' = 'terminal', ids = CALL_IDS) => ({
  plugin: 'tldr', surface, component: 'ToolGroup' as const, requestId: `group-${ids[0]}`, viewport: FULL,
  props: { calls: ids.map(call), isActive: false, isExpanded: false },
})
const spinner = { plugin: 'tldr', surface: 'terminal' as const, component: 'Spinner' as const, requestId: 'spin', viewport: FULL, props: { word: 'Sautéing', message: null, suffix: '…', mode: 'thinking' } as never }

function engineDraws(on: On) {
  on('ui.render', { component: 'ToolGroup' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine rows</Text>
  })
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Baked for 52s</Text>
  })
  on('ui.render', { component: 'Spinner' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine spinner</Text>
  })
}

// Test runners

test('runners: each test command names its runner', async () => {
  const cases: [string, string | null][] = [
    ['npx jest src', 'jest'],
    ['yarn jest --watch=false', 'jest'],
    ['pnpm vitest run', 'vitest'],
    ['npx vitest', 'vitest'],
    ['go test ./...', 'go test'],
    ['cargo test --all', 'cargo test'],
    ['cargo nextest run', 'cargo test'],
    ['bun test', 'bun test'],
    ['npm test', 'npm test'],
    ['npm run test:unit', 'npm test'],
    ['pnpm test', 'pnpm test'],
    ['yarn test', 'yarn test'],
    ['cd app && uv run pytest -q', 'pytest'],
    ['cat jest.config.js', null],
    ['go build ./...', null],
    ['npm install', null],
  ]
  for (const [command, runner] of cases) expect([command, detectRunner(command)]).toEqual([command, runner])
})

test('runners: jest summary', async () => {
  expect(parseResult('jest', 'PASS a\nTests:       1 failed, 2 skipped, 11 passed, 14 total\nTime: 2s')).toEqual({ passed: 11, failed: 1, skipped: 2 })
})

test('runners: vitest summary', async () => {
  expect(parseResult('vitest', ' Test Files  1 failed | 2 passed (3)\n      Tests  3 failed | 9 passed (12)\n')).toEqual({ passed: 9, failed: 3, skipped: 0 })
})

test('runners: cargo adds up every test binary', async () => {
  const out = 'test result: ok. 12 passed; 0 failed; 1 ignored; 0 measured\n...\ntest result: FAILED. 3 passed; 2 failed; 0 ignored; 0 measured'
  expect(parseResult('cargo test', out)).toEqual({ passed: 15, failed: 2, skipped: 1 })
})

test('runners: go test counts -v lines, and gives no counts without them', async () => {
  expect(parseResult('go test', '=== RUN TestA\n--- PASS: TestA (0.00s)\n--- FAIL: TestB (0.01s)\n--- SKIP: TestC\nFAIL')).toEqual({ passed: 1, failed: 1, skipped: 1 })
  expect(parseResult('go test', 'ok  \texample.com/pkg\t0.12s')).toEqual({ passed: null, failed: null, skipped: null })
})

test('runners: bun test summary', async () => {
  expect(parseResult('bun test', ' 12 pass\n 3 fail\n 1 skip\n 50 expect() calls')).toEqual({ passed: 12, failed: 3, skipped: 1 })
})

test('runners: npm test reads the summary of whatever runner it starts', async () => {
  expect(parseResult('npm test', '> app@1.0.0 test\n> jest\n\nTests:       14 passed, 14 total')).toEqual({ passed: 14, failed: 0, skipped: 0 })
  expect(parseResult('npm test', 'no summary')).toEqual({ passed: null, failed: null, skipped: null })
})

// Bash writes

test('bash writes: redirects, heredocs, tee, sed -i, cp, mv and touch name their targets', async () => {
  const cases: [string, string[]][] = [
    ['echo hi > notes.txt', ['notes.txt']],
    ['echo more >> notes.txt', ['notes.txt']],
    ["cat > src/a.py <<'EOF'\nif a > b:\n    pass\nEOF", ['src/a.py']],
    ['make 2>&1 | tee build.log', ['build.log']],
    ["sed -i '' 's/a/b/' src/x.py", ['src/x.py']],
    ["sed -i 's/a/b/' src/x.py", ['src/x.py']],
    ['cp a.env .env', ['.env']],
    ['mv old.ts new.ts', ['new.ts']],
    ['touch done.flag', ['done.flag']],
    ['ls > /dev/null 2>&1', []],
    ['echo "a > b"', []],
    ['grep -n foo src', []],
    ['cp only-one', []],
  ]
  for (const [command, paths] of cases) expect([command, bashWrites(command)]).toEqual([command, paths])
})

test('bash writes: classify gives a change marked via Bash, and a failed command gives none', async () => {
  expect(classify('Bash', { command: 'echo hi > /repo/notes.txt' }, {}, false, '/repo')).toEqual([
    { kind: 'change', change: { path: 'notes.txt', added: 0, removed: 0, viaBash: true, isTest: false, isDelete: false, outsideRoot: false, addsSkip: false } },
  ])
  expect(classify('Bash', { command: 'echo hi > notes.txt' }, {}, true)[0]?.kind).toBe('other')
})

test('bash writes: the card says via Bash, not +0 −0', async ($, on) => {
  mock.clock(on)
  engineDraws(on)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: 'done' }))
  on('tool.call', async () => ({ result: { stdout: '', stderr: '' } }) as never)
  await $.turn.start({ turnId: 'w', text: 'write notes' } as never)
  await $.tool.call({ tool: 'Bash', command: 'echo hi > notes.txt', tool_use_id: 'w-1' } as never)
  await $.turn.complete({ turnId: 'w', answer: 'done' } as never)
  const text = JSON.stringify(await (await $.ui.mount(group('terminal', ['w-1']))).drawn())
  expect(text).toContain('via Bash')
  expect(text).not.toContain('+0')
})

// Switches

test('switch: card off leaves the tool rows and the closing line to the engine', { options: { card: false } }, async ($, on) => {
  engine(on)
  engineDraws(on)
  await play($)
  expect(JSON.stringify(await (await $.ui.mount(group())).drawn())).toContain('engine rows')
  const end = await $.ui.mount({ plugin: 'tldr', surface: 'terminal', component: 'TurnDuration', requestId: 'd', viewport: MAIN, props: { word: 'Baked', durationMs: 52_000 } })
  expect(JSON.stringify(await end.drawn())).toContain('Baked for 52s')
  expect((await $.command.run({ command: 'tldr', args: 'diff', ...RUN })).text).toContain('turn card is off')
})

test('switch: card on draws the card (the same turn as the switch-off test)', async ($, on) => {
  engine(on)
  engineDraws(on)
  await play($)
  expect(JSON.stringify(await (await $.ui.mount(group())).drawn())).not.toContain('engine rows')
})

test('switch: motion off leaves the spinner to the engine', { options: { motion: false } }, async ($, on) => {
  engine(on)
  engineDraws(on)
  await $.turn.start({ turnId: 't', text: 'go' } as never)
  expect(JSON.stringify(await (await $.ui.mount(spinner)).drawn())).toContain('engine spinner')
})

test('switch: trust off draws no Check row', { options: { trust: false } }, async ($, on) => {
  engine(on)
  engineDraws(on)
  await play($)
  const text = JSON.stringify(await (await $.ui.mount(group())).drawn())
  expect(text).toContain('fix the login bug')
  expect(text).not.toContain('⚠')
})

test('switch: actions off draws no buttons and /tldr diff gives the help', { options: { actions: false } }, async ($, on) => {
  engine(on)
  engineDraws(on)
  await play($)
  expect(await (await $.ui.mount(group())).find({ key: 'tldr-diff:turn-login' })).toBeUndefined()
  expect((await $.command.run({ command: 'tldr', args: 'diff', ...RUN })).text).toContain('TL;DR is on')
})

test('switch: keep off answers /tldr history so', { options: { keep: false } }, async ($, on) => {
  engine(on)
  await play($)
  expect((await $.command.run({ command: 'tldr', args: 'history', ...RUN })).text).toContain('keeping cards is off')
})

// Edge cases

test('edge: an interrupted turn stops saying running when the next turn starts', async ($, on) => {
  engine(on)
  engineDraws(on)
  await $.turn.start({ turnId: 'cut', text: 'long job' } as never)
  await $.tool.call({ tool: 'Read', file_path: 'a.py', tool_use_id: 'c-1' } as never)
  await $.turn.start({ turnId: 'next', text: 'something else' } as never)
  const text = JSON.stringify(await (await $.ui.mount(group('terminal', ['c-1']))).drawn())
  expect(text).toContain('long job')
  expect(text).not.toContain('running')
})

test('edge: a turn with no tool calls keeps the engine closing line on the main screen', async ($, on) => {
  engine(on)
  engineDraws(on)
  await $.turn.start({ turnId: 'chat', text: 'what is a monad' } as never)
  await $.turn.complete({ turnId: 'chat', answer: 'a monoid in the category of endofunctors' } as never)
  const end = await $.ui.mount({ plugin: 'tldr', surface: 'terminal', component: 'TurnDuration', requestId: 'd', viewport: MAIN, props: { word: 'Baked', durationMs: 3_000 } })
  expect(JSON.stringify(await end.drawn())).toContain('Baked for 52s')
})

test('edge: an empty prompt gives an untitled card', async ($, on) => {
  engine(on)
  engineDraws(on)
  await $.turn.start({ turnId: 'e', text: '   ' } as never)
  await $.tool.call({ tool: 'Read', file_path: 'a.py', tool_use_id: 'e-1' } as never)
  expect(JSON.stringify(await (await $.ui.mount(group('terminal', ['e-1']))).drawn())).toContain('untitled turn')
})

test('edge: a failed edit is not counted as a change', async ($, on) => {
  mock.clock(on)
  engineDraws(on)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', async () => ({ result: 'old_string not found', isError: true }) as never)
  await $.turn.start({ turnId: 'f', text: 'edit' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'a.py', old_string: 'x', new_string: 'y', tool_use_id: 'f-1' } as never)
  expect(JSON.stringify(await (await $.ui.mount(group('terminal', ['f-1']))).drawn())).toContain('no files')
})

test('edge: desktop and VS Code keep the engine rows', async ($, on) => {
  engine(on)
  engineDraws(on)
  await play($)
  for (const surface of ['desktop', 'vscode'] as const) expect(JSON.stringify(await (await $.ui.mount(group(surface))).drawn())).toContain('engine rows')
})
