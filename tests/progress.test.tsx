// The TL;DR line while a turn runs: the running step against last time, then the last thing that happened.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { commandKey, duration, remember, ring } from '../hooks/durations'
import { doneText, nextJump, runLine } from '../hooks/progress'
import { startTurn } from '../hooks/turn'
import type { Flag, Turn } from '../types'
import { engine } from './fixtures/login-bug'

const working = (isWorking: boolean) => ({
  plugin: 'tldr', surface: 'terminal' as const, component: 'AbovePrompt' as const, requestId: `band-${isWorking}`,
  viewport: { columns: 120, rows: 40, isFullscreen: false }, props: { bodyColumns: 110, hasSurvey: false, isWorking, maxRows: 10 } as never,
})
const base = (on: On) => on('ui.render', { component: 'AbovePrompt' }, async ($, e) => $.ui.resolve(e).Box({ key: 'engine' } as never) as never)
const change = (path: string, added: number, removed: number) => ({ path, added, removed, isTest: false, viaBash: false, isDelete: false, outsideRoot: false, addsSkip: false })
const run = (runner: string, failed: number | null, passed: number | null, isError = false) => ({ runner, command: runner, failed, passed, skipped: null, isError })
const flag: Flag = { kind: 'tests-edited', detail: 'tests/conftest.py changed in the turn that made tests pass' }
const text = (parts: { text: string }[]) => parts.map(p => p.text).join('')
const turn = (over: Partial<Turn>): Turn => ({ ...startTurn('t', 'fix the login bug', 0), ...over })

test('durations: the clock, the command key, and the ring against last time', async () => {
  expect(duration(8_000)).toBe('8s')
  expect(duration(72_000)).toBe('1m 12s')
  expect(commandKey('  pytest   tests/test_auth.py -q\necho done')).toBe('pytest tests/test_auth.py -q')
  expect(ring(10_000, null)).toBe('○')
  expect([10, 30, 50, 70].map(s => ring(s * 1000, 72_000))).toEqual(['◔', '◑', '◕', '●'])
  expect(ring(100_000, 72_000)).toBe('●')
})

test('durations: the newest command moves last, and the oldest drop past the cap', async () => {
  expect(Object.keys(remember({ a: 1, b: 2 }, 'a', 3))).toEqual(['b', 'a'])
  const full = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`c${i}`, i]))
  const next = remember(full, 'new', 1)
  expect(Object.keys(next).length).toBe(100)
  expect(next.c0).toBeUndefined()
  expect(next.new).toBe(1)
})

test('run line: a command with history shows its ring and last time; the jump follows with its age', async () => {
  const jump = { parts: [{ text: 'pytest ✗ 3 failed', tone: 'fail' as const }], at: 0 }
  const parts = runLine({ word: 'Running pytest -q', running: { id: 'x', label: 'Running pytest -q', startedAt: 52_000, isCommand: true, lastMs: 72_000 }, since: 0, now: 90_000, turn: { jump, changes: [] } })
  expect(text(parts)).toBe('◑ Running pytest -q 38s of ~1m 12s · last: pytest ✗ 3 failed 1m 30s ago')
  expect(parts.find(p => p.text === 'pytest ✗ 3 failed')!.tone).toBe('fail')
})

test('run line: a first run says so, a slow one says it is past last time', async () => {
  const at = (lastMs: number | null, now: number) => text(runLine({ word: 'w', running: { id: 'x', label: 'Running pytest', startedAt: 0, isCommand: true, lastMs }, since: 0, now, turn: { jump: null, changes: [] } }))
  expect(at(null, 32_000)).toBe('○ Running pytest 32s · first run')
  expect(at(72_000, 100_000)).toBe('● Running pytest 1m 40s · past ~1m 12s')
  expect(at(72_000, 1_000)).toBe('◔ Running pytest')
})

test('run line: between calls a plain clock; with nothing happened yet, the files so far', async () => {
  const parts = runLine({ word: 'Thinking', running: null, since: 10_000, now: 60_000, turn: { jump: null, changes: [change('a.py', 12, 3)] } })
  expect(text(parts)).toBe('Thinking 50s · 1 file +12 −3')
  expect(text(runLine({ word: 'Reading a.py', running: { id: 'r', label: 'Reading a.py', startedAt: 0, isCommand: false, lastMs: null }, since: 0, now: 3_000, turn: { jump: null, changes: [] } }))).toBe('Reading a.py 3s')
})

test('jump: a new test run and a new flag; a call that adds neither is no jump', async () => {
  const before = { testRuns: [run('pytest', 3, 9, true)], flags: [] }
  const after = { testRuns: [...before.testRuns, run('pytest', 0, 12)], flags: [flag] }
  expect(nextJump(before, after, 5)).toEqual({ parts: [{ text: 'pytest ✓ 12 passed', tone: 'pass' }, { text: `⚠ ${flag.detail}`, tone: 'check' }], at: 5 })
  expect(nextJump(after, after, 6)).toBeNull()
})

test('done: the notification line names the verdict, the tests, what to check, the size and the time', async () => {
  const t = turn({ endedAt: 252_000, changes: [change('a.py', 12, 3), change('b.py', 6, 3)], testRuns: [run('pytest', 3, 9, true), run('pytest', 0, 12)], flags: [flag] })
  expect(doneText(t, 252_000)).toBe('⚠ fix the login bug · ✓ 12 passed · 1 to check · 2 files +18 −6 · 4m 12s')
  expect(doneText(turn({ endedAt: 40_000 }), 40_000)).toBe('fix the login bug · 40s')
})

test('band: while the turn runs, the TL;DR line shows the last test result; when it ends, the line goes', async ($, on) => {
  engine(on)
  base(on)
  await $.turn.start({ turnId: 'turn-login', text: 'fix the login bug' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'src/auth.py', old_string: 'a', new_string: 'b', tool_use_id: 'w1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'pytest -q', tool_use_id: 'w2' } as never)
  const drawn = JSON.stringify(await (await $.ui.mount(working(true))).drawn())
  for (const s of ['TL;DR  ', 'Thinking', ' · last: ', 'pytest ✗ 3 failed', ' just now']) expect(drawn).toContain(s)
  await $.turn.complete({ turnId: 'turn-login', answer: 'done' } as never)
  expect(JSON.stringify(await (await $.ui.mount(working(false))).drawn())).not.toContain('TL;DR  ')
})

test('band: the second run of a command shows its ring against the first', { options: { animation: false } }, async ($, on) => {
  // The engine's clock, moved by each pytest call: the first takes 1m 12s; the band is read 36s into the second.
  let now = 0
  let runs = 0
  let during = ''
  on('clock.now', async () => ({ value: now }) as never)
  mock.store(on, {})
  base(on)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', async () => {
    runs++
    now += 36_000
    if (runs === 2) during = JSON.stringify(await (await $.ui.mount(working(true))).drawn())
    now += 36_000
    return { result: { stdout: '12 passed in 1.6s', stderr: '', interrupted: false } } as never
  })
  await $.turn.start({ turnId: 't', text: 'run the tests' } as never)
  await $.tool.call({ tool: 'Bash', command: 'pytest -q', tool_use_id: 'b1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'pytest  -q', tool_use_id: 'b2' } as never)
  for (const s of ['◑ ', 'Running pytest  -q', ' 36s', ' of ~1m 12s']) expect(during).toContain(s)
})

test('motion off: no TL;DR line', { options: { motion: false } }, async ($, on) => {
  engine(on)
  base(on)
  await $.turn.start({ turnId: 'turn-login', text: 'fix the login bug' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'src/auth.py', old_string: 'a', new_string: 'b', tool_use_id: 'w1' } as never)
  expect(JSON.stringify(await (await $.ui.mount(working(true))).drawn())).not.toContain('TL;DR  ')
})

test('notify: a long turn sends its verdict and leaves it on the status line; a short one does not', async ($, on) => {
  const clock = mock.clock(on)
  const sent: string[] = []
  const status: (string | undefined)[] = []
  on('ui.notify', async (_$, e) => { sent.push(e.text); return { value: { isSent: true, channel: 'terminal' } } as never })
  on('ui.status', async (_$, e) => { status.push(e.text); return { value: undefined } as never })
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }) as never)
  on('tool.call', async () => ({ result: { stdout: '12 passed in 1.6s', stderr: '', interrupted: false } }) as never)
  await $.turn.start({ turnId: 'short', text: 'quick one' } as never)
  await $.tool.call({ tool: 'Bash', command: 'pytest -q', tool_use_id: 's1' } as never)
  await $.turn.complete({ turnId: 'short', answer: 'ok' } as never)
  expect(sent).toEqual([])
  await $.turn.start({ turnId: 'long', text: 'long one' } as never)
  await $.tool.call({ tool: 'Bash', command: 'pytest -q', tool_use_id: 'l1' } as never)
  await clock.advance(45_000)
  await $.turn.complete({ turnId: 'long', answer: 'ok' } as never)
  expect(sent).toEqual(['✓ long one · ✓ 12 passed · 45s'])
  expect(status).toEqual(['TL;DR ✓ done 45s'])
  await $.turn.start({ turnId: 'next', text: 'next' } as never)
  expect(status).toEqual(['TL;DR ✓ done 45s', undefined])
})

test('notify off: nothing sent', { options: { notify: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const sent: string[] = []
  on('ui.notify', async (_$, e) => { sent.push(e.text); return { value: { isSent: true, channel: 'terminal' } } as never })
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }) as never)
  on('tool.call', async () => ({ result: {} }) as never)
  await $.turn.start({ turnId: 'long', text: 'long one' } as never)
  await $.tool.call({ tool: 'Read', file_path: 'a.py', tool_use_id: 'l1' } as never)
  await clock.advance(45_000)
  await $.turn.complete({ turnId: 'long', answer: 'ok' } as never)
  expect(sent).toEqual([])
})
