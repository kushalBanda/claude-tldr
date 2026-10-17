// The context window as one line of colored cells: what fills it, by category, and what is left. Pure.
// Each used category takes a color from the Plotly qualitative palette.
import type { SessionContextBreakdown } from 'claude-code'

const DEFAULT = 0x01000000
const FULL = 0x2588 // █
const FREE = 0x2500 // ─
const BUFFER = 0x254c // ╌
const DIM = 0x5a5650
const BUFFER_TONE = 0x7a756d

// Plotly's default qualitative colors (plotly.colors.qualitative.Plotly).
export const PLOTLY = [0x636efa, 0xef553b, 0x00cc96, 0xab63fa, 0xffa15a, 0x19d3f3, 0xff6692, 0xb6e880, 0xff97ff, 0xfecb52]

// The rows /context lists keep one color each, so a row that shows up mid-session never shifts the others.
// A row it does not name takes the next color left over. Only the color hangs on the name; what counts is `kind`.
const PINNED: Record<string, number> = {
  'System prompt': PLOTLY[0]!,
  'System tools': PLOTLY[1]!,
  'Memory files': PLOTLY[2]!,
  Skills: PLOTLY[3]!,
  Messages: PLOTLY[4]!,
  'MCP tools': PLOTLY[5]!,
  'Custom agents': PLOTLY[6]!,
  'Slash commands': PLOTLY[7]!,
}
const SPARE = PLOTLY.slice(8)

export type Slice = { name: string; tokens: number; rgb: number; kind: 'used' | 'free' | 'buffer' }
export type ContextFill = { slices: Slice[]; used: number; window: number; percent: number }

/** The breakdown as slices in /context order: used rows with a palette color, then free space, then the compaction buffer. */
export function contextFill(b: Pick<SessionContextBreakdown, 'categories' | 'totalTokens' | 'rawMaxTokens' | 'percentage'>): ContextFill {
  const used = b.categories.filter(c => c.kind === 'used' && c.tokens > 0)
  let spare = 0
  const slices: Slice[] = used.map(c => ({ name: c.name, tokens: c.tokens, rgb: PINNED[c.name] ?? SPARE[spare++ % SPARE.length]!, kind: 'used' }))
  for (const c of b.categories) {
    if (c.kind === 'free' && c.tokens > 0) slices.push({ name: c.name, tokens: c.tokens, rgb: DIM, kind: 'free' })
    if (c.kind === 'buffer' && c.tokens > 0) slices.push({ name: c.name, tokens: c.tokens, rgb: BUFFER_TONE, kind: 'buffer' })
  }
  return { slices, used: b.totalTokens, window: b.rawMaxTokens, percent: Math.round(b.percentage) }
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
  slices.forEach((s, i) => { if (s.kind === 'used' && out[i] === 0 && columns >= slices.length) out[i] = 1 })
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
      cells[at * 3] = s.kind === 'used' ? FULL : s.kind === 'free' ? FREE : BUFFER
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

/** The label beside the bar: "62% · 124k/200k", and a pointer to /compact once the window is nearly full. */
export function contextLabel(fill: ContextFill): string {
  const base = `${fill.percent}% · ${tokens(fill.used)}/${tokens(fill.window)}`
  return contextLevel(fill.percent) === 'full' ? `${base} · /compact` : base
}
