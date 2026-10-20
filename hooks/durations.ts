// How long things take: the clock text, and how long each command took last time in this project,
// so the band can say "38s of ~1m 12s" while it runs again. Pure; the store reads and writes live in register.tsx.

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

export const DURATIONS_MAX = 100 // commands remembered per project; the oldest drop
export const REMEMBER_MS = 2000 // shorter runs are not worth a ring

export type Durations = Record<string, number>

export function durationsKey(root: string | undefined): string {
  return `durations:${root ?? ''}`
}

/** The command as one line, so `pytest  -q` and `pytest -q` are the same run. */
export function commandKey(command: string): string {
  return command.trim().split('\n')[0]!.replace(/\s+/g, ' ').slice(0, 200)
}

export function isDurations(v: unknown): v is Durations {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(x => typeof x === 'number')
}

/** The map with `key` set to `ms`, moved to the newest place, the oldest dropped past DURATIONS_MAX. */
export function remember(d: Durations, key: string, ms: number): Durations {
  const entries = Object.entries(d).filter(([k]) => k !== key)
  return Object.fromEntries([...entries, [key, ms]].slice(-DURATIONS_MAX))
}

const RING = ['◔', '◑', '◕', '●'] as const

/** How far a run is against last time: ○ with nothing to compare, then ◔ ◑ ◕, and ● at or past it. */
export function ring(elapsedMs: number, lastMs: number | null): string {
  if (lastMs === null || lastMs <= 0) return '○'
  const f = elapsedMs / lastMs
  return f >= 0.875 ? RING[3] : f >= 0.625 ? RING[2] : f >= 0.375 ? RING[1] : RING[0]
}
