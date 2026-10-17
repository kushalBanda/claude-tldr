import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CALL_IDS, engine, play } from './fixtures/login-bug'

const call = (id: string, tool = 'Read') => ({ tool_use_id: id, tool, input: {}, isRunning: false, isErrored: false, isInterrupted: false })
const group = (ids: string[], isExpanded = false) => ({
  plugin: 'tldr',
  component: 'ToolGroup' as const,
  requestId: `group-${ids[0]}`,
  props: { calls: ids.map(id => call(id)), isActive: false, isExpanded },
})
const FULL = { columns: 120, rows: 40, isFullscreen: true }
const RUN = { args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }

function engineRows(on: On) {
  on('ui.render', { component: 'ToolGroup' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine rows</Text>
  })
}

test('tool.call hands the engine result back unchanged', async ($, on) => {
  engine(on)
  await $.turn.start({ turnId: 't', text: 'go' } as never)
  const ran = await $.tool.call({ tool: 'Bash', command: 'pytest -q', tool_use_id: 'x' } as never)
  expect(ran).toEqual({ result: { stdout: expect.stringContaining('3 failed'), stderr: '', interrupted: false }, isError: true })
})

test('the first tool group of a turn draws the card with the turn facts', async ($, on) => {
  engine(on)
  engineRows(on)
  await play($)
  const ui = await $.ui.mount({ ...group(CALL_IDS.slice(0, 4)), surface: 'terminal' })
  const text = JSON.stringify(await ui.drawn())
  for (const s of ['fix the login bug, users get logged out after refresh', '3 files ', '+18', '−6', 'src/auth.py', 'src/middleware.py', 'tests/conftest.py', 'pytest ✗ 3 failed', '"✓ 12 passed"', '2 files, 1 search'])
    expect(text).toContain(s)
  expect(text).not.toContain('engine rows')
})

test('later tool groups of the same turn draw nothing while collapsed', async ($, on) => {
  engine(on)
  engineRows(on)
  await play($)
  const ui = await $.ui.mount({ ...group(CALL_IDS.slice(4)), surface: 'terminal' })
  const text = JSON.stringify(await ui.drawn())
  expect(text).not.toContain('engine rows')
  expect(text).not.toContain('fix the login bug')
})

test('ctrl+o (isExpanded) shows the engine rows under the card', async ($, on) => {
  engine(on)
  engineRows(on)
  await play($)
  const ui = await $.ui.mount({ ...group(CALL_IDS.slice(0, 4), true), surface: 'terminal' })
  const text = JSON.stringify(await ui.drawn())
  expect(text).toContain('fix the login bug')
  expect(text).toContain('engine rows')
})

test('/tldr show opens the detail behind a row', async ($, on) => {
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  engine(on)
  engineRows(on)
  await play($)
  const r = await $.command.run({ command: 'tldr', ...RUN, args: 'show changed' })
  expect(r.text).toContain('Changed opened')
  const pane = await $.ui.mount({ plugin: 'tldr', surface: 'terminal', component: 'Pane', requestId: 'tldr-detail', viewport: FULL, props: {} as never })
  const text = JSON.stringify(await pane.drawn())
  // Grouped by folder: each folder with its total, each file by name under it.
  for (const s of ['"3 files · "', '"+18"', '"−6"', '"src/"', '"+16"', '"  auth.py"', '"+12"', '"color":"success"', '"color":"error"', '"tests/"', '"  conftest.py"']) expect(text).toContain(s)
  expect((await $.command.run({ command: 'tldr', ...RUN, args: 'show nonsense' })).text).toContain('no row "nonsense"')
})

test('fullscreen: each card row is one plain press target', async ($, on) => {
  engine(on)
  engineRows(on)
  await play($)
  const text = JSON.stringify(await (await $.ui.mount({ ...group(CALL_IDS.slice(0, 1)), surface: 'terminal' })).drawn())
  for (const s of ['tldr-show:all:', 'tldr-show:changed:', 'tldr-show:tests:', 'tldr-show:check:', 'tldr-show:looked:', 'click a row']) expect(text).toContain(s)
})

test('a subagent tool call is left out of the card', async ($, on) => {
  engine(on)
  engineRows(on)
  await $.turn.start({ turnId: 't', text: 'go' } as never)
  await $.tool.call({ tool: 'Read', file_path: 'a.py', tool_use_id: 'sub-1', agentId: 'agent-1' } as never)
  const ui = await $.ui.mount({ ...group(['sub-1']), surface: 'terminal' })
  expect(JSON.stringify(await ui.drawn())).toContain('engine rows')
})

test('a tool group on desktop is left to the engine', async ($, on) => {
  engine(on)
  engineRows(on)
  await play($)
  const ui = await $.ui.mount({ ...group(CALL_IDS.slice(0, 4)), surface: 'desktop' })
  expect(JSON.stringify(await ui.drawn())).toContain('engine rows')
})

test('/tldr with no argument shows help', async $ => {
  const r = await $.command.run({ command: 'tldr', ...RUN })
  expect(r.text).toContain('TL;DR is on')
})

test('a running call already draws the card, before its result is in', async ($, on) => {
  mock.clock(on)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  engineRows(on)
  let seen = ''
  // The engine draws the group while the call runs: mount it from inside the running call.
  on('tool.call', async () => {
    const ui = await $.ui.mount({ ...group(['run-1']), surface: 'terminal' })
    seen = JSON.stringify(await ui.drawn())
    return { result: {} } as never
  })
  await $.turn.start({ turnId: 't', text: 'look around' } as never)
  await $.tool.call({ tool: 'Read', file_path: 'a.py', tool_use_id: 'run-1' } as never)
  expect(seen).toContain('look around')
})
