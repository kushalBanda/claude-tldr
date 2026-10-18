// Pure lookups on TL;DR's turns. The atoms and every read and write of them live in register.tsx.
import type { Turn } from '../types'

export const MAX_TURNS = 200 // a session's cards held in memory; older ones drop

/** The turn a tool group belongs to, found by its calls' tool_use_ids; isFirst when the group holds the turn's first call. */
export function turnForCalls(list: readonly Turn[], callIds: readonly string[]): { turn: Turn; isFirst: boolean } | null {
  for (const turn of list) {
    if (callIds.some(id => turn.toolUseIds.includes(id))) {
      return { turn, isFirst: turn.toolUseIds[0] !== undefined && callIds.includes(turn.toolUseIds[0]) }
    }
  }
  return null
}

const DURATION_SLACK_MS = 10_000

/**
 * The turn a main-screen "Baked for" line closes. The engine redraws old lines too, so a line keeps the turn it
 * first drew (`pins`: line requestId to turn id). A new line takes the free turn whose length is nearest its
 * `durationMs`, else the newest turn when it is free.
 */
export function turnForDuration(list: readonly Turn[], pins: ReadonlyMap<string, string>, site: string, durationMs: number, now: number): Turn | null {
  const pinned = pins.get(site)
  if (pinned !== undefined) return list.find(t => t.id === pinned) ?? null
  const taken = new Set(pins.values())
  const free = list.filter(t => !taken.has(t.id) && t.toolUseIds.length > 0)
  let best: Turn | null = null
  let bestGap = Infinity
  for (const t of free) {
    const gap = Math.abs((t.endedAt ?? now) - t.startedAt - durationMs)
    if (gap <= bestGap) [best, bestGap] = [t, gap]
  }
  if (best !== null && bestGap <= Math.max(DURATION_SLACK_MS, durationMs / 4)) return best
  // No length matches (clocks differ): the line that just printed closes the newest turn, if that turn is free.
  const newest = list.at(-1)
  return newest !== undefined && free.includes(newest) ? newest : null
}

export const KEPT_MAX = 50 // cards kept on disk per session

export function keptKey(sessionId: string): string {
  return `cards:${sessionId}`
}

export function isTurnList(v: unknown): v is Turn[] {
  return Array.isArray(v) && v.every(x => x !== null && typeof x === 'object' && typeof (x as Turn).id === 'string' && Array.isArray((x as Turn).changes))
}
