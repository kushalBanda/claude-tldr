import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { startTurn, toKept } from '../hooks/turn'
import { engine, play } from './fixtures/login-bug'

const FULL = { columns: 120, rows: 40, isFullscreen: true }
const band = { plugin: 'tldr', surface: 'terminal' as const, component: 'AbovePrompt' as const, requestId: 'band', viewport: FULL, props: { bodyColumns: 100, hasSurvey: false, isWorking: false, maxRows: 10 } as never }
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }

function host(on: On, stored: Record<string, unknown> = {}) {
  mock.store(on, stored)
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.compact', async (_$, e) => ({ messages: e.messages }) as never)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
}

test('toKept drops folded text and live state, caps the reply and the log', async () => {
  const t = { ...startTurn('t', 'go', 0), interim: ['note'], reply: 'x'.repeat(3000), log: Array.from({ length: 100 }, (_, i) => `line ${i}`), pulse: { kind: 'change' as const, key: 'a', at: 1 } }
  const k = toKept(t)
  expect(k.interim).toEqual([])
  expect(k.reply?.length).toBe(2000)
  expect(k.log.length).toBe(40)
  expect(k.log.at(-1)).toBe('line 99')
  expect(k.pulse).toBeNull()
})

test('a finished turn is kept on disk under its session', async ($, on) => {
  engine(on)
  host(on)
  await play($)
  const r = await $.command.run({ command: 'tldr', args: 'history', ...RUN })
  expect(r.text).toContain('1 card kept')
})

test('after /compact the band points to the kept cards', async ($, on) => {
  engine(on)
  host(on)
  await play($)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary of earlier work', toolUses: [] }] } as never)
  const text = JSON.stringify(await (await $.ui.mount(band)).drawn())
  expect(text).toContain('1 earlier turn kept · /tldr history')
})

test('the note goes away when the next turn starts', async ($, on) => {
  engine(on)
  host(on)
  await play($)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary of earlier work', toolUses: [] }] } as never)
  await $.turn.start({ turnId: 'next', text: 'more' } as never)
  expect(JSON.stringify(await (await $.ui.mount(band)).drawn())).not.toContain('kept · /tldr history')
})

test('a resumed session with kept cards shows the note at start', async ($, on) => {
  engine(on)
  host(on, { 'cards:sess-1': [toKept(startTurn('old-1', 'earlier work', 0)), toKept(startTurn('old-2', 'more earlier work', 0))] })
  await $.session.start({ source: 'resume', cwd: '/repo' } as never)
  expect(JSON.stringify(await (await $.ui.mount(band)).drawn())).toContain('2 earlier turns kept · /tldr history')
})

test('/tldr history opens the pane, and the pane lists the kept cards', async ($, on) => {
  engine(on)
  host(on)
  await play($)
  const r = await $.command.run({ command: 'tldr', args: 'history', ...RUN })
  expect(r.text).toContain('history opened, 1 card kept')
  const pane = await $.ui.mount({ plugin: 'tldr', surface: 'terminal', component: 'Pane', requestId: 'tldr-history', viewport: FULL, props: {} as never })
  const text = JSON.stringify(await pane.drawn())
  expect(text).toContain('fix the login bug')
  expect(text).toContain('src/auth.py +12 −3')
  expect(text).toContain('pytest ✓ 12 passed')
  expect(text).toContain('⚠ tests/conftest.py changed in the turn that made tests pass')
})

test('a resumed session draws its old rows as cards again, from the kept cards', async ($, on) => {
  engine(on)
  host(on, { 'cards:sess-1': [toKept({ ...startTurn('old-1', 'earlier work', 0), endedAt: 1000, toolUseIds: ['tu-old'] })] })
  on('ui.render', { component: 'ToolGroup' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine rows</Text>
  })
  await $.session.start({ source: 'resume', cwd: '/repo' } as never)
  const call = { tool_use_id: 'tu-old', tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false }
  const site = await $.ui.mount({ plugin: 'tldr', surface: 'terminal', component: 'ToolGroup', requestId: 'group-old', viewport: FULL, props: { calls: [call], isActive: false, isExpanded: false } } as never)
  const text = JSON.stringify(await site.drawn())
  expect(text).toContain('earlier work')
  expect(text).not.toContain('engine rows')
})
