// The context bar: what fills the window, by category, in Plotly colors, with a label that warns near full.
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { contextCells, contextFill, contextLabel, contextLevel, PLOTLY, sliceWidths, tokens } from '../hooks/context'

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

test('fill: each row keeps its Plotly color; deferred rows are left out; free and buffer follow', async () => {
  const f = contextFill(BREAKDOWN)
  expect(f.slices.map(s => s.name)).toEqual(['System prompt', 'System tools', 'Memory files', 'Messages', 'Free space', 'Autocompact buffer'])
  expect(f.slices.slice(0, 4).map(s => s.rgb)).toEqual([PLOTLY[0], PLOTLY[1], PLOTLY[2], PLOTLY[4]])
  // A row that shows up later leaves the others as they were; an unknown row takes a spare color.
  const later = contextFill({ ...BREAKDOWN, categories: [cat('Skills', 2_000), cat('New thing', 1_000), ...BREAKDOWN.categories] })
  expect(later.slices.find(s => s.name === 'Messages')!.rgb).toBe(PLOTLY[4])
  expect(later.slices.find(s => s.name === 'New thing')!.rgb).toBe(PLOTLY[8])
  expect(f.percent).toBe(62)
})

test('widths: sum to the columns, and a small used row keeps one cell', async () => {
  const f = contextFill({ ...BREAKDOWN, categories: [cat('Tiny', 100), cat('Messages', 150_000), cat('Free space', 49_900, 'free')] })
  const w = sliceWidths(f.slices, 40)
  expect(w.reduce((a, b) => a + b, 0)).toBe(40)
  expect(w[0]).toBe(1)
  expect(contextCells(f, 40).length).toBe(120)
})

test('label: percent and tokens; amber from 75%, red from 90% with a pointer to /compact', async () => {
  expect(contextLabel(contextFill(BREAKDOWN))).toBe('62% · 124k/200k')
  expect(contextLevel(74)).toBe('ok')
  expect(contextLevel(75)).toBe('warn')
  expect(contextLevel(90)).toBe('full')
  expect(contextLabel(contextFill({ ...BREAKDOWN, percentage: 93, totalTokens: 186_000 }))).toBe('93% · 186k/200k · /compact')
  expect(tokens(1_000_000)).toBe('1M')
})

test('band: the bar and its label draw after a measure, and 7 opens the context pane', async ($, on) => {
  const opened: string[] = []
  on('ui.open', async (_$, e) => { opened.push((e as { id: string }).id); return { value: { isPlaced: true } } as never })
  usage(on)
  await $.command.run({ command: 'tldr', args: 'context', origin: { kind: 'composer' } } as never)
  const ui = await $.ui.mount(band)
  const text = JSON.stringify(await ui.drawn())
  for (const s of ['tldr-context-bar', '62% · 124k/200k', '"hotkey":"7"', 'engine band']) expect(text).toContain(s)
  await ui.press({ key: 'tldr-context-open' })
  expect(opened).toEqual(['tldr-context', 'tldr-context'])
  const pane = await $.ui.mount({ plugin: 'tldr', surface: 'terminal', component: 'Pane', requestId: 'tldr-context', viewport: MAIN, props: {} as never })
  const p = JSON.stringify(await pane.drawn())
  for (const s of ['System prompt', 'Messages', '97k', 'Free space', 'Autocompact buffer']) expect(p).toContain(s)
  expect(p).not.toContain('/compact frees')
})

test('band: amber label at 80%', async ($, on) => {
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  usage(on, { ...BREAKDOWN, percentage: 80, totalTokens: 160_000 })
  await $.command.run({ command: 'tldr', args: 'context', origin: { kind: 'composer' } } as never)
  const text = JSON.stringify(await (await $.ui.mount(band)).drawn())
  expect(text).toContain('"color":"warning"')
})

test('context off: no bar, and the command says so', { options: { context: false } }, async ($, on) => {
  usage(on)
  const r = await $.command.run({ command: 'tldr', args: 'context', origin: { kind: 'composer' } } as never)
  expect(r.text).toContain('off')
  expect(JSON.stringify(await (await $.ui.mount(band)).drawn())).not.toContain('tldr-context-bar')
})
