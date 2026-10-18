// The TL;DR line: while a long turn runs, the band says how far it got, in the card's own words.
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { fitProgress, progressParts } from '../hooks/progress'
import { engine } from './fixtures/login-bug'

const working = (isWorking: boolean, bodyColumns = 110) => ({
  plugin: 'tldr', surface: 'terminal' as const, component: 'AbovePrompt' as const, requestId: `band-${isWorking}-${bodyColumns}`,
  viewport: { columns: 120, rows: 40, isFullscreen: false }, props: { bodyColumns, hasSurvey: false, isWorking, maxRows: 10 } as never,
})
const base = (on: On) => on('ui.render', { component: 'AbovePrompt' }, async ($, e) => $.ui.resolve(e).Box({ key: 'engine' } as never) as never)
const change = (path: string, added: number, removed: number) => ({ path, added, removed, isTest: false, viaBash: false, isDelete: false }) as never
const run = (runner: string, failed: number | null, passed: number | null, isError = false) => ({ runner, command: runner, failed, passed, skipped: null, isError }) as never

test('parts: calls, files with counts, the last two test runs, and the current job', async () => {
  const parts = progressParts({ toolUseIds: ['a', 'b', 'c'], changes: [change('a.py', 12, 3), change('b.py', 4, 1)], testRuns: [run('pytest', 3, 9, true), run('pytest', 0, 12)] }, 'Running pytest -q')
  expect(parts.map(p => p.text)).toEqual(['3 calls', '2 files +16 −4', 'pytest ✗ 3 failed → ✓ 12 passed', 'now: running pytest -q'])
  expect(parts[2]!.ok).toBe(true)
  expect(progressParts({ toolUseIds: ['a'], changes: [], testRuns: [] }, '').map(p => p.text)).toEqual(['1 call'])
})

test('fit: a narrow band drops calls, then files; tests and the current job stay', async () => {
  const parts = progressParts({ toolUseIds: ['a', 'b'], changes: [change('a.py', 1, 1)], testRuns: [run('go test', 2, 20, true)] }, 'Editing a.py')
  expect(fitProgress(parts, 200).map(p => p.key)).toEqual(['calls', 'files', 'tests', 'now'])
  expect(fitProgress(parts, 66).map(p => p.key)).toEqual(['files', 'tests', 'now'])
  expect(fitProgress(parts, 40).map(p => p.key)).toEqual(['tests', 'now'])
})

test('band: while the turn runs, the TL;DR line shows its facts; when it ends, the line goes', async ($, on) => {
  engine(on)
  base(on)
  await $.turn.start({ turnId: 'turn-login', text: 'fix the login bug' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'src/auth.py', old_string: 'a', new_string: 'b', tool_use_id: 'w1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'pytest -q', tool_use_id: 'w2' } as never)
  const text = JSON.stringify(await (await $.ui.mount(working(true))).drawn())
  for (const s of ['TL;DR  ', '2 calls', '"1 file "', '"+12"', 'pytest ✗ 3 failed', 'now: running pytest -q']) expect(text).toContain(s)
  await $.turn.complete({ turnId: 'turn-login', answer: 'done' } as never)
  expect(JSON.stringify(await (await $.ui.mount(working(false))).drawn())).not.toContain('TL;DR  ')
})

test('motion off: no TL;DR line', { options: { motion: false } }, async ($, on) => {
  engine(on)
  base(on)
  await $.turn.start({ turnId: 'turn-login', text: 'fix the login bug' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'src/auth.py', old_string: 'a', new_string: 'b', tool_use_id: 'w1' } as never)
  expect(JSON.stringify(await (await $.ui.mount(working(true))).drawn())).not.toContain('TL;DR  ')
})
