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

test('main screen: in-between text stays as printed', async ($, on) => {
  engine(on)
  await turnWithNote($)
  const ui = await $.ui.mount(message(NOTE, MAIN))
  expect(JSON.stringify(await ui.drawn())).toContain(`engine: ${NOTE}`)
})

test('/tldr expand brings the in-between text back, in the card and in place', async ($, on) => {
  engine(on)
  await turnWithNote($)
  await $.command.run({ command: 'tldr', args: 'expand', ...RUN })
  const msg = await $.ui.mount(message(NOTE))
  expect(JSON.stringify(await msg.drawn())).toContain(`engine: ${NOTE}`)
  const card = await $.ui.mount({
    plugin: 'tldr', surface: 'terminal', component: 'ToolGroup', requestId: 'g', viewport: FULL,
    props: { calls: [{ tool_use_id: 'r1', tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false }], isActive: false, isExpanded: false },
  })
  const text = JSON.stringify(await card.drawn())
  expect(text).toContain('Notes')
  expect(text).toContain(NOTE)
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
