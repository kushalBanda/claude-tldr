// The context window as one line of cells, in two colors you can read without a legend:
// the conversation, which /compact frees, and the setup, which every request loads. Then the free space. Pure.
import type { SessionContextBreakdown } from 'claude-code'

const DEFAULT = 0x01000000
const FULL = 0x2588 // █
const FREE = 0x2500 // ─
const BUFFER = 0x254c // ╌
const DIM = 0x5a5650
const BUFFER_TONE = 0x7a756d

export const CONVERSATION_RGB = 0x636efa // Plotly blue: the part /compact frees
export const SETUP_RGB = 0x9aa0a6 // neutral gray: loaded on every request
export const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`

export type SliceKind = 'conversation' | 'setup' | 'free' | 'buffer'
export type Slice = { name: string; tokens: number; rgb: number; kind: SliceKind }
export type Row = { name: string; tokens: number }
// slices: the bar, left to right. setup: the rows the setup slice stands for, for the pane.
export type ContextFill = { slices: Slice[]; setup: Row[]; used: number; window: number; percent: number }

// The one row /compact shrinks. Every other used row is setup.
const CONVERSATION_ROW = 'Messages'

/** The breakdown as conversation, setup, free space and the compaction buffer. Deferred tool schemas sit outside the window. */
export function contextFill(b: Pick<SessionContextBreakdown, 'categories' | 'totalTokens' | 'rawMaxTokens' | 'percentage'>): ContextFill {
  const used = b.categories.filter(c => c.kind === 'used' && c.tokens > 0)
  const setup = used.filter(c => c.name !== CONVERSATION_ROW).map(c => ({ name: c.name, tokens: c.tokens }))
  const sum = (kind: string, pick = (_: string) => true) => b.categories.filter(c => c.kind === kind && pick(c.name)).reduce((n, c) => n + c.tokens, 0)
  const slices: Slice[] = [
    { name: 'conversation', tokens: sum('used', n => n === CONVERSATION_ROW), rgb: CONVERSATION_RGB, kind: 'conversation' },
    { name: 'setup', tokens: sum('used', n => n !== CONVERSATION_ROW), rgb: SETUP_RGB, kind: 'setup' },
    { name: 'free', tokens: sum('free'), rgb: DIM, kind: 'free' },
    { name: 'reserved for auto-compact', tokens: sum('buffer'), rgb: BUFFER_TONE, kind: 'buffer' },
  ]
  return { slices: slices.filter(s => s.tokens > 0), setup, used: b.totalTokens, window: b.rawMaxTokens, percent: Math.round(b.percentage) }
}

/**
 * Cells per slice, summing to `columns`: largest remainder, and a used slice with tokens never drops to zero
 * while there is room, so a small category stays visible.
 */
export function sliceWidths(slices: readonly Slice[], columns: number): number[] {
  const total = slices.reduce((n, s) => n + s.tokens, 0)
  if (total <= 0 || columns <= 0) return slices.map(() => 0)
  const exact = slices.map(s => (s.tokens / total) * columns)
  const out = exact.map(Math.floor)
  slices.forEach((s, i) => { if ((s.kind === 'conversation' || s.kind === 'setup') && out[i] === 0 && columns >= slices.length) out[i] = 1 })
  let left = columns - out.reduce((n, w) => n + w, 0)
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r)
  for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length, left--) out[order[k]!.i]!++
  // Taking a cell back from the widest slice when the minimums overshot.
  while (left < 0) {
    const widest = out.indexOf(Math.max(...out))
    out[widest]!--
    left++
  }
  return out
}

/** The bar as Raster cells: full blocks for what is used, a thin line for free space, a dashed one for the buffer. */
export function contextCells(fill: ContextFill, columns: number): Uint32Array {
  const cols = Math.max(1, columns)
  const cells = new Uint32Array(cols * 3)
  const widths = sliceWidths(fill.slices, cols)
  let at = 0
  fill.slices.forEach((s, i) => {
    for (let k = 0; k < widths[i]! && at < cols; k++, at++) {
      cells[at * 3] = s.kind === 'free' ? FREE : s.kind === 'buffer' ? BUFFER : FULL
      cells[at * 3 + 1] = s.rgb
      cells[at * 3 + 2] = DEFAULT
    }
  })
  for (; at < cols; at++) {
    cells[at * 3] = FREE
    cells[at * 3 + 1] = DIM
    cells[at * 3 + 2] = DEFAULT
  }
  return cells
}

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

export type Level = 'ok' | 'warn' | 'full'
export const WARN_AT = 75
export const FULL_AT = 90

export function contextLevel(percent: number): Level {
  return percent >= FULL_AT ? 'full' : percent >= WARN_AT ? 'warn' : 'ok'
}

/** The short figure: "62% · 124k/200k", and a pointer to /compact once the window is nearly full. */
export function contextLabel(fill: ContextFill): string {
  const base = `${fill.percent}% · ${tokens(fill.used)}/${tokens(fill.window)}`
  return contextLevel(fill.percent) === 'full' ? `${base} · /compact` : base
}

/** The tokens of one slice kind, 0 when absent. */
export function sliceTokens(fill: ContextFill, kind: SliceKind): number {
  return fill.slices.find(s => s.kind === kind)?.tokens ?? 0
}
