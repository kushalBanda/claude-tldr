// All $.state access for TL;DR goes through here.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Kept, Live, Turn } from '../types'

const MAX_TURNS = 200 // a session's cards held in memory; older ones drop

export const turns = atom({ plugin: 'tldr', key: 'turns' } as const, [] as Turn[])
export const live = atom({ plugin: 'tldr', key: 'live' } as const, { phase: 'idle', word: '', last: null, flagged: false } as Live)
export const kept = atom({ plugin: 'tldr', key: 'kept' } as const, { count: 0, note: false } as Kept)
export const current = atom({ plugin: 'tldr', key: 'current' } as const, null as string | null)

export async function openTurn($: EngineInterface, t: Turn): Promise<void> {
  // A turn that never completed (interrupted) ends where the next one starts, so its card stops saying "running".
  await update($, turns, list => [...(list ?? []).filter(x => x.id !== t.id).map(x => (x.endedAt === null ? { ...x, endedAt: t.startedAt } : x)), t].slice(-MAX_TURNS))
  await update($, current, () => t.id)
}

export async function updateCurrent($: EngineInterface, fn: (t: Turn) => Turn): Promise<void> {
  const id = await read($, current)
  if (id === null) return
  await update($, turns, list => (list ?? []).map(t => (t.id === id ? fn(t) : t)))
}

export async function updateTurn($: EngineInterface, id: string, fn: (t: Turn) => Turn): Promise<void> {
  await update($, turns, list => (list ?? []).map(t => (t.id === id ? fn(t) : t)))
}

export async function closeCurrent($: EngineInterface, fn: (t: Turn) => Turn): Promise<void> {
  await updateCurrent($, fn)
  await update($, current, () => null)
}

/** The turn a tool group belongs to, found by its calls' tool_use_ids; isFirst when the group holds the turn's first call. */
export function turnForCalls(list: readonly Turn[], callIds: readonly string[]): { turn: Turn; isFirst: boolean } | null {
  for (const turn of list) {
    if (callIds.some(id => turn.toolUseIds.includes(id))) {
      return { turn, isFirst: turn.toolUseIds[0] !== undefined && callIds.includes(turn.toolUseIds[0]) }
    }
  }
  return null
}

export async function latestTurn($: EngineInterface): Promise<Turn | null> {
  const list = await read($, turns)
  return list.at(-1) ?? null
}

export async function allTurns($: EngineInterface): Promise<Turn[]> {
  return read($, turns)
}

export async function readLive($: EngineInterface): Promise<Live> {
  return read($, live)
}

export async function setLive($: EngineInterface, fn: (l: Live) => Live): Promise<void> {
  await update($, live, l => fn(l ?? { phase: 'idle', word: '', last: null, flagged: false }))
}

const KEPT_MAX = 50 // cards kept on disk per session

function keptKey(sessionId: string): string {
  return `cards:${sessionId}`
}

function isTurnList(v: unknown): v is Turn[] {
  return Array.isArray(v) && v.every(x => x !== null && typeof x === 'object' && typeof (x as Turn).id === 'string' && Array.isArray((x as Turn).changes))
}

export async function loadKept($: EngineInterface): Promise<Turn[]> {
  const v = await $.store.get(keptKey(await $.session.id()))
  return isTurnList(v) ? v : []
}

export async function saveKept($: EngineInterface, t: Turn): Promise<number> {
  const list = (await loadKept($)).filter(x => x.id !== t.id)
  const next = [...list, t].slice(-KEPT_MAX)
  await $.store.set(keptKey(await $.session.id()), next)
  return next.length
}

export async function readKept($: EngineInterface): Promise<Kept> {
  return read($, kept)
}

export async function setKept($: EngineInterface, fn: (k: Kept) => Kept): Promise<void> {
  await update($, kept, k => fn(k ?? { count: 0, note: false }))
}
