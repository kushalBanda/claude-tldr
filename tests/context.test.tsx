// The context bar: the conversation (what /compact frees), the setup, and the room left, with a label that names each color.
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CONVERSATION_RGB, contextCells, conversationRgb, FULL_RGB, WARN_RGB, contextFill, contextLevel, SETUP_RGB, sliceWidths, tokens } from '../hooks/context'

const MAIN = { columns: 120, rows: 40, isFullscreen: false }
const band = { plugin: 'tldr', surface: 'terminal' as const, component: 'AbovePrompt' as const, requestId: 'band', viewport: MAIN, props: { bodyColumns: 100, hasSurvey: false, isWorking: false, maxRows: 10 } as never }

const cat = (name: string, tokens: number, kind: 'used' | 'free' | 'buffer' | 'deferred' = 'used') => ({ name, tokens, kind, color: 'inactive', isDeferred: kind === 'deferred' })
const BREAKDOWN = {
  categories: [cat('System prompt', 9_000), cat('System tools', 14_000), cat('MCP tools', 6_000, 'deferred'), cat('Memory files', 4_000), cat('Messages', 97_000), cat('Free space', 43_000, 'free'), cat('Autocompact buffer', 33_000, 'buffer')],
  totalTokens: 124_000, rawMaxTokens: 200_000, percentage: 62,
}

function usage(on: On, b: unknown = BREAKDOWN) {
  on('session.usage', async () => ({ value: { startedAt: 0, rateLimits: [], cost: {}, context: { tokens: 124_000, window: 200_000, percent: 62, breakdown: b } } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => $.ui.resolve(e).Text({ children: 'engine band' } as never) as never)
}

test('fill: Messages is the conversation; every other used row is setup; deferred rows are left out', async () => {
  const f = contextFill(BREAKDOWN)
  expect(f.slices.map(s => [s.kind, s.tokens])).toEqual([['conversation', 97_000], ['setup', 27_000], ['free', 43_000], ['buffer', 33_000]])
  expect(f.slices.slice(0, 2).map(s => s.rgb)).toEqual([WARN_RGB, SETUP_RGB])
  expect(f.setup.map(r => r.name)).toEqual(['System prompt', 'System tools', 'Memory files'])
  expect(f.percent).toBe(62)
})

test('widths: sum to the columns, and a small used row keeps one cell', async () => {
  const f = contextFill({ ...BREAKDOWN, categories: [cat('Messages', 150_000), cat('Tiny', 100), cat('Free space', 49_900, 'free')] })
  const w = sliceWidths(f.slices, 40)
  expect(w.reduce((a, b) => a + b, 0)).toBe(40)
  expect(w[1]).toBe(1)
  expect(contextCells(f, 40).length).toBe(120)
})

test('level: amber from 60%, red from 80%', async () => {
  expect(contextLevel(59)).toBe('ok')
  expect(contextLevel(60)).toBe('warn')
  expect(contextLevel(80)).toBe('full')
  expect(tokens(1_000_000)).toBe('1M')
  expect([59, 60, 80].map(conversationRgb)).toEqual([CONVERSATION_RGB, WARN_RGB, FULL_RGB])
  expect(contextFill({ ...BREAKDOWN, percentage: 93 }).slices[0]!.rgb).toBe(FULL_RGB)
})

test('band: the bar and its label draw after a measure, and a click on the label opens the context pane', async ($, on) => {
  const opened: string[] = []
  on('ui.open', async (_$, e) => { opened.push((e as { id: string }).id); return { value: { isPlaced: true } } as never })
  usage(on)
  await $.command.run({ command: 'tldr', args: 'context', origin: { kind: 'composer' } } as never)
  const ui = await $.ui.mount(band)
  const text = JSON.stringify(await ui.drawn())
  for (const s of ['tldr-context-bar', '62% full', 'conversation 97k', 'setup 27k', '"color":"warning"', '"color":"#f5a623"', 'engine band']) expect(text).toContain(s)
  await ui.press({ key: 'tldr-context-open' })
  expect(opened).toEqual(['tldr-context', 'tldr-context'])
  const pane = await $.ui.mount({ plugin: 'tldr', surface: 'terminal', component: 'Pane', requestId: 'tldr-context', viewport: MAIN, props: {} as never })
  const p = JSON.stringify(await pane.drawn())
  for (const s of ['62% full · 124k of 200k', 'conversation', '/compact frees this', 'setup', 'loaded on every request', '  System prompt', 'free', 'reserved for auto-compact']) expect(p).toContain(s)
  expect(p).toContain('/compact shrinks')
})

test('context off: no bar, and the command says so', { options: { context: false } }, async ($, on) => {
  usage(on)
  const r = await $.command.run({ command: 'tldr', args: 'context', origin: { kind: 'composer' } } as never)
  expect(r.text).toContain('off')
  expect(JSON.stringify(await (await $.ui.mount(band)).drawn())).not.toContain('tldr-context-bar')
})
