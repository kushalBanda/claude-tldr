// Frames for the spinner and the band, as Raster cells. Pure: same inputs, same frame.
// A cell is [codePoint, foreground, background], each a little-endian u32; 0x01000000 is the terminal's default.

export type SpinnerMode = 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use'
export type BandState = 'working' | 'fail' | 'pass' | 'idle'

const DEFAULT = 0x01000000
const ACCENT = 0xd97757 // Claude Code's orange
const DIM = 0x5a5650
const RED = 0xe46a5e
const GREEN = 0x86b872
const BARS = [0x2581, 0x2582, 0x2583, 0x2584, 0x2585, 0x2586, 0x2587, 0x2588] // ▁ … █
const LINE = 0x2501 // ━
const THIN = 0x2500 // ─

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

/** The band's line: orange with a moving light while working, red on a failure, green on a pass, dim when idle. */
export function bandFrame(state: BandState, ms: number, columns: number, animate: boolean): Uint32Array {
  const cols = Math.max(1, columns)
  const cells = new Uint32Array(cols * 3)
  const base = state === 'working' ? ACCENT : state === 'fail' ? RED : state === 'pass' ? GREEN : DIM
  const sweep = animate && state === 'working' ? ((ms / 1300) % 1) * (cols + 12) - 6 : -100
  for (let i = 0; i < cols; i++) {
    const near = Math.max(0, 1 - Math.abs(i - sweep) / 6)
    cells[i * 3] = state === 'idle' ? THIN : LINE
    cells[i * 3 + 1] = near > 0 ? mix(base, 0xffffff, near * 0.7) : base
    cells[i * 3 + 2] = DEFAULT
  }
  return cells
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

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
