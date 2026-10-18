// The TL;DR line on the band while a turn runs: the card's facts in one line, so a long turn shows how far it got. Pure.
import type { Turn } from '../types'
import { changeTotals } from './steps'
import { testLabel } from './summary'

export type ProgressPart = { key: 'calls' | 'files' | 'tests' | 'now'; text: string; ok?: boolean }

const MINUS = '−'

/** The parts, most expendable first: calls, files, tests, then what Claude does now. */
export function progressParts(t: Pick<Turn, 'toolUseIds' | 'changes' | 'testRuns'>, word: string): ProgressPart[] {
  const out: ProgressPart[] = []
  const calls = t.toolUseIds.length
  if (calls > 0) out.push({ key: 'calls', text: `${calls} call${calls === 1 ? '' : 's'}` })
  if (t.changes.length > 0) {
    const s = changeTotals(t.changes)
    const files = `${s.files} file${s.files === 1 ? '' : 's'}`
    out.push({ key: 'files', text: s.counted ? `${files} +${s.added} ${MINUS}${s.removed}` : files })
  }
  // The last two runs, as the card's Tests row reads them: a rerun of the same runner shows its result only.
  const runs = t.testRuns.slice(-2).map(testLabel)
  if (runs.length > 0) {
    const [a, b] = runs
    const sameRunner = b !== undefined && t.testRuns.at(-1)!.runner === t.testRuns.at(-2)!.runner
    const text = b === undefined ? a!.text : `${a!.text} → ${sameRunner ? b.result : b.text}`
    out.push({ key: 'tests', text, ok: (b ?? a)!.ok })
  }
  if (word !== '') out.push({ key: 'now', text: `now: ${word.charAt(0).toLowerCase()}${word.slice(1)}` })
  return out
}

/** The parts that fit `columns` beside the label: drop calls, then files; tests and now stay (the row truncates). */
export function fitProgress(parts: readonly ProgressPart[], columns: number, label = 'TL;DR'): ProgressPart[] {
  const width = (ps: readonly ProgressPart[]) => label.length + 2 + ps.reduce((n, p) => n + p.text.length + 3, 0)
  let out = [...parts]
  for (const drop of ['calls', 'files'] as const) {
    if (width(out) <= columns) break
    out = out.filter(p => p.key !== drop)
  }
  return out
}
