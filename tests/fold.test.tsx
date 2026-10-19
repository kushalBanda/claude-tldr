import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { isInterim, recordStep, startTurn } from '../hooks/turn'

const NOTE = "I'll start by looking at how sessions are verified."
const REPLY = 'Fixed. All 12 auth tests pass.'
const FULL = { columns: 120, rows: 40, isFullscreen: true }
const MAIN = { columns: 120, rows: 40, isFullscreen: false }
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }

function engine(on: On) {
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  mock.clock(on)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', async () => ({ result: {} }) as never)
  on('turn.step', async function* (_$, e) {
    // The test passes the answer it wants through the input's model field.
    const [answer, tools] = e.model.split('|')
    return { turnId: e.turnId, index: e.index, answer: answer ?? '', toolUses: tools ? [{ id: 'x', name: 'Read', input: {} }] : [], stopReason: tools ? 'tool_use' : 'end_turn', usage: null } as never
  })
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`engine: ${e.props.text}`}</Text>
  })
  on('ui.render', { component: 'ToolGroup' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine rows</Text>
  })
}

async function step($: Engine, index: number, answer: string, withTools: boolean) {
  const s = $.turn.step({ turnId: 't1', index, model: `${answer}|${withTools ? 'tools' : ''}`, messageCount: 1 } as never)
  for await (const _ of s) void _
  await s.result
}

async function turnWithNote($: Engine) {
  await $.turn.start({ turnId: 't1', text: 'fix it' } as never)
  await step($, 0, NOTE, true)
  await $.tool.call({ tool: 'Read', file_path: 'a.py', tool_use_id: 'r1' } as never)
  await step($, 1, REPLY, false)
}

const message = (text: string, viewport = FULL) => ({
  plugin: 'tldr', surface: 'terminal' as const, component: 'AssistantMessage' as const, requestId: 'm', viewport,
  props: { text, isFirstOfReply: true },
})

test('turn: text before a tool call is in-between text, text after the last one is the reply', async () => {
  let t = startTurn('t', 'go', 0)
  t = recordStep(t, `  ${NOTE}  `, true)
  t = recordStep(t, '', true)
  t = recordStep(t, REPLY, false)
  expect(t.interim).toEqual([NOTE])
  expect(t.reply).toBe(REPLY)
  expect(isInterim(t, NOTE)).toBe(true)
  expect(isInterim(t, REPLY)).toBe(false)
  expect(isInterim(t, '   ')).toBe(false)
})

test('fullscreen: in-between text folds away', async ($, on) => {
  engine(on)
  await turnWithNote($)
  const ui = await $.ui.mount(message(NOTE))
  expect(JSON.stringify(await ui.drawn())).not.toContain('engine:')
})

test('fullscreen: the reply stays', async ($, on) => {
  engine(on)
  await turnWithNote($)
  const ui = await $.ui.mount(message(REPLY))
  expect(JSON.stringify(await ui.drawn())).toContain(`engine: ${REPLY}`)
})

test('fullscreen: a later reply that repeats earlier in-between text stays', async ($, on) => {
  engine(on)
  const LATER = 'No errors found.'
  await $.turn.start({ turnId: 't1', text: 'check it' } as never)
  await step($, 0, `${LATER} I will check the remaining files.`, true)
  await $.tool.call({ tool: 'Read', file_path: 'a.py', tool_use_id: 'r1' } as never)
  await step($, 1, 'Done.', false)
  await $.turn.start({ turnId: 't2', text: 'check again' } as never)
  const s = $.turn.step({ turnId: 't2', index: 0, model: `${LATER}|`, messageCount: 1 } as never)
  for await (const _ of s) void _
  await s.result
  const ui = await $.ui.mount(message(LATER))
  expect(JSON.stringify(await ui.drawn())).toContain(`engine: ${LATER}`)
})

test('main screen: in-between text stays as printed', async ($, on) => {
  engine(on)
  await turnWithNote($)
  const ui = await $.ui.mount(message(NOTE, MAIN))
  expect(JSON.stringify(await ui.drawn())).toContain(`engine: ${NOTE}`)
})

test('/tldr show notes brings the in-between text back', async ($, on) => {
  engine(on)
  await turnWithNote($)
  await $.command.run({ command: 'tldr', args: 'show notes', ...RUN })
  const pane = await $.ui.mount({ plugin: 'tldr', surface: 'terminal', component: 'Pane', requestId: 'tldr-detail', viewport: FULL, props: {} as never })
  expect(JSON.stringify(await pane.drawn())).toContain(NOTE)
})

test('a subagent response is left out', async ($, on) => {
  engine(on)
  await $.turn.start({ turnId: 't1', text: 'fix it' } as never)
  const s = $.turn.step({ turnId: 't1', index: 0, model: `${NOTE}|tools`, messageCount: 1, agentId: 'a1' } as never)
  for await (const _ of s) void _
  await s.result
  const ui = await $.ui.mount(message(NOTE))
  expect(JSON.stringify(await ui.drawn())).toContain(`engine: ${NOTE}`)
})
