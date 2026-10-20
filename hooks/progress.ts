// The band's line while a turn runs: what runs now and how far it is against last time, then the last thing that happened.
// Also the one line a finished long turn sends as a notification. Pure.
import type { Jump, Running, Tone, Turn } from '../types'
import { glyph } from './draw/theme'
import { duration, ring } from './durations'
import { changeTotals, verdictOf } from './steps'
import { testLabel } from './summary'

export type RunPart = { text: string; tone: Tone | 'accent' | 'dim' | 'text' }

const CLOCK_FROM_MS = 2000 // under this a clock says nothing worth reading
const MINUS = '−'

/** "pytest ✗ 3 failed" and "⚠ tests/conftest.py changed …" from one call: the runs and flags `after` has that `before` did not. */
export function nextJump(before: Pick<Turn, 'testRuns' | 'flags'>, after: Pick<Turn, 'testRuns' | 'flags'>, now: number): Jump | null {
  const parts: Jump['parts'] = []
  const run = after.testRuns.length > before.testRuns.length ? after.testRuns.at(-1) : undefined
  if (run !== undefined) {
    const l = testLabel(run)
    parts.push({ text: l.text, tone: l.ok ? 'pass' : 'fail' })
  }
  for (const f of after.flags) {
    if (!before.flags.some(g => g.kind === f.kind && g.detail === f.detail)) parts.push({ text: `${glyph.check} ${f.detail}`, tone: 'check' })
  }
  return parts.length > 0 ? { parts, at: now } : null
}

/** " · last: ✗ pytest 3 failed 1m 30s ago": the jump and its age, as the band and the stepper's head end. */
export function jumpParts(jump: Jump | null, now: number): RunPart[] {
  if (jump === null) return []
  const age = now - jump.at
  return [
    { text: ' · last: ', tone: 'dim' },
    ...jump.parts.flatMap((p, i): RunPart[] => (i > 0 ? [{ text: ' · ', tone: 'dim' }, p] : [p])),
    { text: age < CLOCK_FROM_MS ? ' just now' : ` ${duration(age)} ago`, tone: 'dim' },
  ]
}

function filesText(t: Pick<Turn, 'changes'>): string | null {
  if (t.changes.length === 0) return null
  const s = changeTotals(t.changes)
  const files = `${s.files} file${s.files === 1 ? '' : 's'}`
  return s.counted ? `${files} +${s.added} ${MINUS}${s.removed}` : files
}

export type RunInput = { word: string; running: Running | null; since: number; now: number; turn: Pick<Turn, 'jump' | 'changes'> }

/**
 * The line: "◑ Running pytest -q 38s of ~1m 12s · last: ✗ pytest 3 failed 1m 30s ago".
 * A command gets a ring against last time; anything else, and Claude thinking between calls, gets a plain clock.
 * With nothing happened yet, the files changed so far stand in for the jump.
 */
export function runLine(o: RunInput): RunPart[] {
  const out: RunPart[] = []
  const r = o.running
  if (r !== null) {
    const ms = o.now - r.startedAt
    if (r.isCommand) out.push({ text: `${ring(ms, r.lastMs)} `, tone: 'accent' })
    out.push({ text: r.label, tone: 'text' })
    if (ms >= CLOCK_FROM_MS) {
      out.push({ text: ` ${duration(ms)}`, tone: 'text' })
      if (r.isCommand) out.push({ text: r.lastMs === null ? ' · first run' : ms > r.lastMs ? ` · past ~${duration(r.lastMs)}` : ` of ~${duration(r.lastMs)}`, tone: 'dim' })
    }
  } else {
    const ms = o.now - o.since
    out.push({ text: o.word, tone: 'text' })
    if (ms >= CLOCK_FROM_MS) out.push({ text: ` ${duration(ms)}`, tone: 'text' })
  }
  const jump = o.turn.jump ?? null
  if (jump !== null) return [...out, ...jumpParts(jump, o.now)]
  const files = filesText(o.turn)
  return files === null ? out : [...out, { text: ` · ${files}`, tone: 'dim' }]
}

/** The finished turn in one line, for a notification: "⚠ fix the login bug · ✓ 12 passed · 1 to check · 3 files +18 −6 · 4m 12s". */
export function doneText(t: Turn, ms: number): string {
  const v = verdictOf(t)
  const mark = v === 'pass' || v === 'fail' || v === 'check' ? `${glyph[v]} ` : ''
  const last = t.testRuns.at(-1)
  const parts = [
    `${mark}${t.goal}`,
    last !== undefined ? testLabel(last).result : null,
    t.flags.length > 0 ? `${t.flags.length} to check` : null,
    filesText(t),
    duration(ms),
  ]
  return parts.filter((p): p is string => p !== null).join(' · ')
}
