// A turn's record: what Claude looked at, changed and ran. Pure functions, no engine access.
import type { Change, TestRun, Turn } from '../types'
import type { ClassifiedCall } from './classify'
import { shortPath } from './classify'

export type { Change, TestRun, Turn }

const GOAL_MAX = 72

// Wrapper tags the prompt box adds around pasted text; they are not what the person asked.
const WRAPPER = /<\/?pasted_content\b[^>]*>/g

export function goalOf(prompt: string): string {
  const line = prompt.replace(WRAPPER, '').trim().split('\n').find(l => l.trim() !== '')?.trim() ?? ''
  if (line === '') return 'untitled turn'
  return shortGoal(line)
}

// An absolute path in the goal keeps its last two parts, so the goal says what, not where.
function shortGoal(raw: string): string {
  const line = raw.replace(/(?:~|\/)[^\s:'"`]*\/[^\s:'"`]*/g, p => shortPath(p))
  if (line.length <= GOAL_MAX) return line
  // Cut at the last word that fits, so the goal never ends mid-word.
  const cut = line.slice(0, GOAL_MAX - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > GOAL_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`
}

export function startTurn(id: string, prompt: string, now: number): Turn {
  return {
    id,
    startedAt: now,
    endedAt: null,
    goal: goalOf(prompt),
    reads: [],
    searches: [],
    changes: [],
    testRuns: [],
    toolUseIds: [],
    log: [],
    ran: [],
    interim: [],
    reply: null,
    pulse: null,
    flags: [],
    diffs: [],
  }
}

function addChange(changes: Change[], c: Change): Change[] {
  const i = changes.findIndex(x => x.path === c.path)
  if (i < 0) return [...changes, c]
  const old = changes[i]!
  const merged: Change = {
    ...old,
    added: old.added + c.added,
    removed: old.removed + c.removed,
    viaBash: old.viaBash && c.viaBash,
    isDelete: c.isDelete,
    addsSkip: old.addsSkip || c.addsSkip,
  }
  return changes.map((x, j) => (j === i ? merged : x))
}

const LOG_MAX = 300 // lines kept per turn

export function recordCall(t: Turn, toolUseId: string, calls: ClassifiedCall[], line?: string, ran?: string): Turn {
  let next: Turn = t.toolUseIds.includes(toolUseId) ? t : { ...t, toolUseIds: [...t.toolUseIds, toolUseId] }
  if (line !== undefined) next = { ...next, log: [...next.log, line].slice(-LOG_MAX) }
  if (ran !== undefined && calls.length > 0 && calls.every(c => c.kind === 'other')) {
    next = { ...next, ran: [...(next.ran ?? []), ran].slice(-LOG_MAX) }
    if (line !== undefined) next = { ...next, ranLog: [...(next.ranLog ?? []), line].slice(-LOG_MAX) }
  }
  for (const c of calls) {
    if (c.kind === 'read') next = { ...next, reads: next.reads.includes(c.path) ? next.reads : [...next.reads, c.path] }
    else if (c.kind === 'search') next = { ...next, searches: [...next.searches, c.pattern] }
    else if (c.kind === 'change') next = { ...next, changes: addChange(next.changes, c.change) }
    else if (c.kind === 'test') next = { ...next, testRuns: [...next.testRuns, c.run] }
  }
  return next
}

const INTERIM_MAX = 50 // in-between texts kept per turn

/** A finished model response: text before a tool call is in-between text; text with no tool call is the reply. */
export function recordStep(t: Turn, answer: string, hasToolUses: boolean): Turn {
  if (answer.trim() === '') return t
  if (hasToolUses) return { ...t, interim: [...t.interim, answer.trim()].slice(-INTERIM_MAX) }
  // The reply keeps its first line's indent: a clean copy takes off the indent all lines share.
  return { ...t, reply: answer.replace(/^\s*\n/, '').trimEnd() }
}

/** Whether a drawn assistant block is in-between text of this turn. */
export function isInterim(t: Turn, blockText: string): boolean {
  const text = blockText.trim()
  return text !== '' && t.interim.some(a => a.includes(text))
}

export function endTurn(t: Turn, now: number): Turn {
  return { ...t, endedAt: now }
}

const KEPT_REPLY_MAX = 2000
const KEPT_LOG_MAX = 40

/** A finished turn trimmed for disk: no folded text, no diff lines, a capped reply and log, no live state. */
export function toKept(t: Turn): Turn {
  const reply = t.reply === null ? null : t.reply.length > KEPT_REPLY_MAX ? `${t.reply.slice(0, KEPT_REPLY_MAX - 1)}…` : t.reply
  return { ...t, interim: [], reply, log: t.log.slice(-KEPT_LOG_MAX), ranLog: (t.ranLog ?? []).slice(-KEPT_LOG_MAX), pulse: null, diffs: [] }
}
