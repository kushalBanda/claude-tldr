import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { groupSummary } from '../hooks/summary'
import { CALL_IDS, engine, play } from './fixtures/login-bug'

const MAIN = { columns: 120, rows: 40, isFullscreen: false }
const FULL = { columns: 120, rows: 40, isFullscreen: true }
const RUN = { origin: { kind: 'composer' as const } }

const done = (tool: string, input: unknown, output?: unknown, isErrored = false) => ({ tool, input, output, isRunning: false, isErrored, isInterrupted: false })

function engineRows(on: On) {
  on('ui.render', { component: 'ToolGroup' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine rows</Text>
  })
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Baked for 52s</Text>
  })
}

test('summary: a group of reads, a search, an edit and a failing pytest', async () => {
  const parts = groupSummary([
    done('Read', { file_path: 'a.py' }),
    done('Read', { file_path: 'b.py' }),
    done('Grep', { pattern: 'x' }),
    done('Edit', { file_path: 'a.py' }, { structuredPatch: [{ lines: ['+x', '+y', '-z'] }] }),
    done('Bash', { command: 'pytest -q' }, { stdout: '1 failed, 4 passed in 0.2s', stderr: '' }, true),
  ])
  expect(parts).toEqual([{ text: 'Read a.py, b.py' }, { text: 'Searched x' }, { text: 'a.py +2 −1' }, { text: 'pytest ✗ 1 failed', ok: false }])
})

test('summary: running calls are counted, not guessed', async () => {
  expect(groupSummary([{ tool: 'Bash', input: { command: 'pytest' }, isRunning: true, isErrored: false }]).map(p => p.text)).toEqual(['1 running…'])
})

test('main screen: a tool group draws one compact line', async ($, on) => {
  engine(on)
  engineRows(on)
  await play($)
  const ui = await $.ui.mount({
    plugin: 'tldr', surface: 'terminal', component: 'ToolGroup', requestId: 'g1', viewport: MAIN,
    props: { calls: [{ ...done('Read', { file_path: 'src/auth.py' }), tool_use_id: CALL_IDS[0] }], isActive: false, isExpanded: false },
  })
  const text = JSON.stringify(await ui.drawn())
  expect(text).toContain('Read src/auth.py')
  expect(text).not.toContain('engine rows')
  expect(text).not.toContain('TL;DR')
})

test('main screen: a line that ran tests shows the result and its dot in green or red', async ($, on) => {
  engine(on)
  engineRows(on)
  await play($)
  const line = async (id: string, output: unknown, isErrored: boolean) => JSON.stringify(await (await $.ui.mount({
    plugin: 'tldr', surface: 'terminal', component: 'ToolUse', requestId: id, viewport: MAIN,
    props: { tool_use_id: id, tool: 'Bash', input: { command: 'pytest tests/test_auth.py -q' }, isRunning: false, isErrored, isInterrupted: false, output },
  })).drawn())
  const red = await line('tu-5', { stdout: '3 failed, 9 passed in 1.84s', stderr: '' }, true)
  expect(red).toContain('{"type":"Text","props":{"color":"error"},"children":["⏺ "]}')
  expect(red).toContain('{"type":"Text","props":{"color":"error"},"children":["pytest ✗ 3 failed"]}')
  const green = await line('tu-8', { stdout: '12 passed in 1.62s', stderr: '' }, false)
  expect(green).toContain('{"type":"Text","props":{"color":"success"},"children":["⏺ "]}')
})

test('main screen: the full card takes the place of the closing line', async ($, on) => {
  engine(on)
  engineRows(on)
  await play($)
  const ui = await $.ui.mount({
    plugin: 'tldr', surface: 'terminal', component: 'TurnDuration', requestId: 'd1', viewport: MAIN,
    props: { word: 'Baked', durationMs: 52_000 },
  })
  const text = JSON.stringify(await ui.drawn())
  // One of Claude Code's own rows: the dot in the verdict's color (amber: a flag), TL;DR, the goal and the time, then ⎿ lines.
  for (const s of ['"color":"warning"},"children":["⏺ "]', '"TL;DR "', 'fix the login bug', ' · 52s', '  ⎿  ', '3 files ', ' in ', 'src, tests', '"pytest ✗ 3 failed"', '"✓ 12 passed"', '⚠ tests/conftest.py changed in the turn that made tests pass']) expect(text).toContain(s)
  for (const s of ['borderStyle', 'Changed', 'Looked at', 'open a row']) expect(text).not.toContain(s)
  expect(text).not.toContain('Baked for 52s')
})

test('main screen: the hint under an empty prompt says the last card opens by digit', async ($, on) => {
  engine(on)
  on('ui.render', { component: 'PromptHint' }, async ($, e) => $.ui.resolve(e).Text({ children: `${e.props.hint}${e.props.tail ?? ''}` } as never) as never)
  let n = 0
  const hint = async (viewport: typeof MAIN, isDraft = false) => JSON.stringify(await (await $.ui.mount({
    plugin: 'tldr', surface: 'terminal', component: 'PromptHint', requestId: `hint-${n++}`, viewport,
    props: { isDraft, isWorking: false, hint: '? for shortcuts' },
  })).drawn())
  expect(await hint(MAIN)).not.toContain('to open the last card')
  await play($)
  expect(await hint(MAIN)).toContain('? for shortcuts · type 1–6 to open the last card')
  expect(await hint(MAIN, true)).not.toContain('to open the last card')
  expect(await hint(FULL)).not.toContain('to open the last card')
})

test('fullscreen: the closing line is left to the engine', async ($, on) => {
  engine(on)
  engineRows(on)
  await play($)
  const ui = await $.ui.mount({
    plugin: 'tldr', surface: 'terminal', component: 'TurnDuration', requestId: 'd1', viewport: FULL,
    props: { word: 'Baked', durationMs: 52_000 },
  })
  expect(JSON.stringify(await ui.drawn())).toContain('Baked for 52s')
})

test('main screen: /tldr show opens the whole turn as steps in order', async ($, on) => {
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  engine(on)
  engineRows(on)
  await play($)
  const r = await $.command.run({ command: 'tldr', args: 'show', ...RUN, presentation: { isFullscreen: false, columns: 120 } })
  expect(r.text).toContain('the whole turn "fix the login bug')
  const pane = await $.ui.mount({ plugin: 'tldr', surface: 'terminal', component: 'Pane', requestId: 'tldr-detail', viewport: MAIN, props: {} as never })
  const text = JSON.stringify(await pane.drawn())
  for (const s of ['Steps', 'src/middleware.py', '"src/auth.py ",{"type":"Text","props":{"color":"success"},"children":["+12"]}', 'pytest tests/test_auth.py -q ✗ 3 failed', 'tests/conftest.py +2 −2', 'test file', 'Check']) expect(text).toContain(s)
  // In order: the failing run comes before the test-file edit, which comes before the passing run.
  const at = (s: string) => text.indexOf(s)
  expect(at('✗ 3 failed')).toBeLessThan(at('tests/conftest.py +2'))
  expect(at('tests/conftest.py +2')).toBeLessThan(at('✓ 12 passed'))
})
