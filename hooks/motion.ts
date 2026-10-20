// Frames for the spinner, as Raster cells. Pure: same inputs, same frame.
// A cell is [codePoint, foreground, background], each a little-endian u32; 0x01000000 is the terminal's default.

export type SpinnerMode = 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use'

const DEFAULT = 0x01000000
const ACCENT = 0xd97757 // Claude Code's orange
const DIM = 0x5a5650
const BARS = [0x2581, 0x2582, 0x2583, 0x2584, 0x2585, 0x2586, 0x2587, 0x2588] // ▁ … █

export const SPINNER_COLUMNS = 9

function mix(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t))
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k) << s
  return ch(16) | ch(8) | ch(0)
}

function bar(level: number): number {
  return BARS[Math.max(0, Math.min(BARS.length - 1, Math.round(level * (BARS.length - 1))))]!
}

/** The spinner: a slow wave while thinking, a running tick while tools run, a stream while writing. */
export function spinnerFrame(mode: SpinnerMode, ms: number, columns = SPINNER_COLUMNS): Uint32Array {
  const cells = new Uint32Array(columns * 3)
  for (let i = 0; i < columns; i++) {
    let level: number
    let glow: number
    if (mode === 'thinking' || mode === 'requesting') {
      const p = Math.sin(ms / 420 - i * 0.55) * 0.5 + 0.5
      level = 0.15 + p * 0.7
      glow = 0.35 + p * 0.65
    } else if (mode === 'tool-use' || mode === 'tool-input') {
      const head = Math.floor(ms / 90) % columns
      const d = (i - head + columns) % columns
      level = d < 3 ? 1 - d * 0.3 : 0.12
      glow = d < 3 ? 1 - d * 0.25 : 0.3
    } else {
      const p = Math.abs(Math.sin(ms / 160 - i * 0.9) * Math.sin(ms / 530 + i * 0.2))
      level = 0.15 + p * 0.8
      glow = 0.5 + p * 0.5
    }
    cells[i * 3] = bar(level)
    cells[i * 3 + 1] = mix(DIM, ACCENT, glow)
    cells[i * 3 + 2] = DEFAULT
  }
  return cells
}

export const FILL_MS = 400 // the plan bar grows to a newly done task over this long
export const PULSE_MS = 900 // a newly done task stays green this long
const SHIMMER_MS = 1400 // one sweep of light across the running task
const TURN = [0x25d0, 0x25d3, 0x25d1, 0x25d2] // ◐ ◓ ◑ ◒
const EIGHTHS = [0, 0x258f, 0x258e, 0x258d, 0x258c, 0x258b, 0x258a, 0x2589] // ▏ … ▉
const FULL = 0x2588
const EMPTY = 0x2591 // ░
const GLINT = 0xf2c9b8

export function easeOutCubic(x: number): number {
  const k = Math.max(0, Math.min(1, x))
  return 1 - (1 - k) ** 3
}

/**
 * The plan's bar: `done` of `total` filled in eighth blocks. For FILL_MS after a task is done (`sinceDoneMs`) it
 * grows from the count before, and while `moving` a glint rides the filled part.
 */
export function planBarFrame(done: number, total: number, sinceDoneMs: number, ms: number, columns: number, moving = true): Uint32Array {
  const cells = new Uint32Array(columns * 3)
  const target = total > 0 ? Math.min(1, done / total) : 0
  const from = total > 0 ? Math.max(0, (done - 1) / total) : 0
  const frac = moving && done > 0 && sinceDoneMs < FILL_MS ? from + (target - from) * easeOutCubic(sinceDoneMs / FILL_MS) : target
  const filled = frac * columns
  const whole = Math.floor(filled)
  const part = Math.round((filled - whole) * 8)
  const glint = (ms / 60) % (columns + 8)
  for (let i = 0; i < columns; i++) {
    let code = EMPTY
    let fg = DIM
    if (i < whole) {
      code = FULL
      fg = moving ? mix(ACCENT, GLINT, Math.max(0, 1 - Math.abs(i - glint) / 3) * 0.6) : ACCENT
    } else if (i === whole && part > 0) {
      code = part === 8 ? FULL : EIGHTHS[part]!
      fg = ACCENT
    }
    cells[i * 3] = code
    cells[i * 3 + 1] = fg
    cells[i * 3 + 2] = DEFAULT
  }
  return cells
}

/** Whether `text` draws one cell per character, so a Raster row can carry it; wide or combining text draws as Text. */
export function fitsCells(text: string): boolean {
  return /^[ -~ -˿Ͱ-ԯ‐-⁯←-⇿]*$/.test(text)
}

/** The running task's row: a turning mark, then its words with a sweep of light; past `columns` it ends in an ellipsis. */
export function shimmerRowFrame(text: string, ms: number, columns: number, moving = true): Uint32Array {
  const full = `  ${String.fromCodePoint(TURN[moving ? Math.floor(ms / 200) % TURN.length : 0]!)} ${text}`
  const chars = [...full]
  const shown = chars.length > columns ? [...chars.slice(0, Math.max(0, columns - 1)), '…'] : chars
  const cells = new Uint32Array(columns * 3)
  for (let i = 0; i < columns; i++) {
    const ch = shown[i] ?? ' '
    const p = Math.sin((ms / SHIMMER_MS) * Math.PI * 2 - i * 0.28) * 0.5 + 0.5
    cells[i * 3] = ch.codePointAt(0)!
    cells[i * 3 + 1] = i < 4 || !moving ? ACCENT : mix(DIM, ACCENT, 0.35 + 0.65 * p)
    cells[i * 3 + 2] = DEFAULT
  }
  return cells
}

const B64 ='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64 of the cells' bytes, as Raster and blit take them. */
export function encodeCells(cells: Uint32Array): string {
  const bytes = new Uint8Array(cells.length * 4)
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i]!
    bytes[i * 4] = v & 255
    bytes[i * 4 + 1] = (v >>> 8) & 255
    bytes[i * 4 + 2] = (v >>> 16) & 255
    bytes[i * 4 + 3] = (v >>> 24) & 255
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (b === undefined ? '=' : B64[(n >> 6) & 63]!) + (c === undefined ? '=' : B64[n & 63]!)
  }
  return out
}
