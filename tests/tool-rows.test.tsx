// A call the transcript does not fold into a group (Bash, Edit, Write) draws as a ToolUse row and a ToolResult block.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { shortPath } from '../hooks/classify'
import { groupSummary } from '../hooks/summary'
import { goalOf } from '../hooks/turn'
import { engine, play } from './fixtures/login-bug'

const FULL = { columns: 120, rows: 40, isFullscreen: true }
const MAIN = { columns: 120, rows: 40, isFullscreen: false }
const RUN = { args: 'expand', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }
const PYTEST = { stdout: '3 failed, 9 passed in 1.84s', stderr: '', interrupted: false }

function row(id: string, viewport = FULL, surface: 'terminal' | 'desktop' = 'terminal') {
  return {
    plugin: 'tldr', surface, component: 'ToolUse' as const, requestId: id, viewport,
    props: { tool_use_id: id, tool: 'Bash', input: { command: 'pytest tests/test_auth.py -q' }, isRunning: false, isErrored: true, isInterrupted: false, output: PYTEST },
  }
}
const result = (id: string, viewport = FULL) => ({
  plugin: 'tldr', surface: 'terminal' as const, component: 'ToolResult' as const, requestId: id, viewport,
  props: { tool_use_id: id, tool: 'Bash', output: PYTEST, isErrored: true },
})

function engineRows(on: On) {
  on('ui.render', { component: 'ToolUse' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`engine row ${e.props.tool_use_id}`}</Text>
  })
  on('ui.render', { component: 'ToolResult' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine result</Text>
  })
}

const drawn = async ($: Engine, input: Parameters<Engine['ui']['mount']>[0]) => JSON.stringify(await (await $.ui.mount(input)).drawn())

test('fullscreen: the row of the turn first call draws the card', async ($, on) => {
  engine(on)
  engineRows(on)
  await play($)
  const text = await drawn($, row('tu-1'))
  for (const s of ['fix the login bug', 'src, tests', '"✓ 12 passed"']) expect(text).toContain(s)
  expect(text).not.toContain('engine row')
})

test('fullscreen: later rows of the turn and their results draw nothing', async ($, on) => {
  engine(on)
  engineRows(on)
  await play($)
  expect(await drawn($, row('tu-5'))).not.toContain('engine row')
  expect(await drawn($, result('tu-5'))).not.toContain('engine result')
})

test('main screen: each row is one summary line, and its result is folded', async ($, on) => {
  engine(on)
  engineRows(on)
  await play($)
  const text = await drawn($, row('tu-5', MAIN))
  expect(text).toContain('pytest ✗ 3 failed')
  expect(text).not.toContain('engine row')
  expect(await drawn($, result('tu-5', MAIN))).not.toContain('engine result')
})

test('/tldr show tests lists each run with its result', async ($, on) => {
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  engine(on)
  engineRows(on)
  await play($)
  await $.command.run({ command: 'tldr', ...RUN, args: 'show tests' })
  const text = await drawn($, { plugin: 'tldr', surface: 'terminal', component: 'Pane', requestId: 'tldr-detail', viewport: FULL, props: {} as never })
  for (const s of ['pytest tests/test_auth.py -q', '3 failed', '12 passed']) expect(text).toContain(s)
  // The card stays the TL;DR: rows stay folded.
  expect(await drawn($, row('tu-5'))).not.toContain('engine row tu-5')
})

test('a row that belongs to no turn, and a desktop row, stay the engine own', async ($, on) => {
  engine(on)
  engineRows(on)
  await play($)
  expect(await drawn($, row('someone-else'))).toContain('engine row someone-else')
  expect(await drawn($, row('tu-1', FULL, 'desktop'))).toContain('engine row tu-1')
})

test('card off: rows and results stay the engine own', { options: { card: false } }, async ($, on) => {
  engine(on)
  engineRows(on)
  await play($)
  expect(await drawn($, row('tu-1'))).toContain('engine row tu-1')
  expect(await drawn($, result('tu-5'))).toContain('engine result')
})

test('goal: the paste wrapper tag is not the goal', async () => {
  expect(goalOf('<pasted_content id="d09b">\nIn the demo:\n1. Read auth.ts\n</pasted_content id="d09b">')).toBe('In the demo:')
})

test('paths: a path outside the project keeps its last two parts; a project path is unchanged', async () => {
  expect(shortPath('/private/tmp/scratchpad/tldr-demo/auth.ts')).toBe('…/tldr-demo/auth.ts')
  expect(shortPath('src/auth.py')).toBe('src/auth.py')
  expect(shortPath('/etc/hosts')).toBe('/etc/hosts')
})

test('main screen: an edit line shows the path inside the project, not the absolute path', async () => {
  const edit = { tool: 'Edit', input: { file_path: '/repo/src/auth.py' }, output: { structuredPatch: [{ lines: ['-a', '+b'] }] }, isRunning: false, isErrored: false }
  expect(groupSummary([edit], '/repo').map(p => p.text)).toEqual(['src/auth.py +1 −1'])
  expect(groupSummary([{ ...edit, input: { file_path: '/elsewhere/deep/demo/auth.ts' } }], '/repo').map(p => p.text)).toEqual(['…/demo/auth.ts +1 −1'])
})

test('card: a file outside the project shows its short path, in the row and in the flag', async ($, on) => {
  engine(on)
  engineRows(on)
  on('session.root', async () => ({ value: '/repo' }) as never)
  await $.turn.start({ turnId: 'o', text: 'edit elsewhere' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/private/tmp/x/tldr-demo/auth.ts', old_string: 'a', new_string: 'b', tool_use_id: 'o-1' } as never)
  await $.turn.complete({ turnId: 'o', answer: 'done' } as never)
  const text = await drawn($, row('o-1'))
  expect(text).toContain('"…/tldr-demo/auth.ts "')
  expect(text).toContain('wrote outside the project: …/tldr-demo/auth.ts')
  expect(text).not.toContain('/private/tmp/x')
})
