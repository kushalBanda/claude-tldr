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
  expect(parts).toEqual(['Read a.py, b.py', 'Searched x', 'a.py +2 −1', 'pytest ✗ 1 failed'])
})

test('summary: running calls are counted, not guessed', async () => {
  expect(groupSummary([{ tool: 'Bash', input: { command: 'pytest' }, isRunning: true, isErrored: false }])).toEqual(['1 running…'])
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
  expect(text).not.toContain('Changed')
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
  for (const s of ['fix the login bug', '52s', 'src/auth.py', 'pytest ✓ 12 passed', '/tldr expand']) expect(text).toContain(s)
  expect(text).not.toContain('Baked for 52s')
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

test('main screen: /tldr expand prints the turn calls', async ($, on) => {
  engine(on)
  engineRows(on)
  await play($)
  const r = await $.command.run({ command: 'tldr', args: 'expand', ...RUN, presentation: { isFullscreen: false, columns: 120 } })
  expect(r.text).toContain('TL;DR · fix the login bug')
  expect(r.text).toContain('⏺ Read src/auth.py')
  expect(r.text).toContain('⏺ Edit src/auth.py +12 −3')
  expect(r.text).toContain('⏺ Bash pytest tests/test_auth.py -q · ✗ 3 failed')
})
