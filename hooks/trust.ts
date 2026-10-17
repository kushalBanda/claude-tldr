// What to check before trusting a turn. Facts only: each flag names what happened, never blocks anything. Pure.
import type { Flag, Turn } from '../types'
import { few, shortPath } from './classify'

function failed(r: Turn['testRuns'][number]): boolean {
  return r.isError || (r.failed ?? 0) > 0
}

function paths(changes: Turn['changes']): string[] {
  return changes.map(c => shortPath(c.path))
}

// One risky act per rule, named the way you'd say it. Matched per sub-command, with quoted text and heredoc
// bodies dropped first, so a command that only mentions `git push --force` in a string is not flagged.
const BYPASS: [RegExp, string][] = [
  [/\s--no-verify\b|^\s*git\s+commit\b.*\s-[a-zA-Z]*n[a-zA-Z]*\b/, 'skipped hooks'],
  [/^\s*git\s+push\b.*\s(--force(-with-lease)?\b|-[a-zA-Z]*f[a-zA-Z]*\b|\+\S)/, 'force push'],
  [/^\s*git\s+reset\b.*\s--hard\b/, 'git reset --hard'],
]
// Deletes the command text can't name file by file.
const BULK_DELETE: [RegExp, string][] = [
  [/^\s*find\b.*\s(-delete\b|-exec(dir)?\s+rm\b)/, 'find -delete'],
  [/^\s*git\s+clean\b.*\s-[a-zA-Z]*f/, 'git clean'],
  [/^\s*xargs\b.*\brm\b/, 'xargs rm'],
]

const ITEM_MAX = 100

function subCommands(command: string): string[] {
  return command
    .replace(/<<-?\s*['"]?(\w+)['"]?([^\n]*)\n[\s\S]*?\n\s*\1\s*(?=\n|$)/g, '$2')
    .replace(/'[^'\n]*'|"(?:[^"\\\n]|\\.)*"/g, '"…"')
    .split(/\s*(?:&&|;|\|\||\||\n)\s*/)
    .map(p => p.replace(/^\s*sudo\s+/, ''))
}

/** The risky acts the turn's Bash calls did, by label, and the sub-commands that did them. */
function risky(t: Turn, rules: readonly [RegExp, string][]): { labels: string[]; items: string[] } {
  const labels = new Set<string>()
  const items: string[] = []
  for (const l of t.log) {
    if (!l.startsWith('Bash ')) continue
    for (const part of subCommands(l.slice(5).split(' · ')[0]!)) {
      const hit = rules.filter(([re]) => re.test(` ${part}`))
      if (hit.length === 0) continue
      for (const [, label] of hit) labels.add(label)
      items.push(part.length > ITEM_MAX ? `${part.slice(0, ITEM_MAX - 1)}…` : part)
    }
  }
  return { labels: [...labels], items }
}

export function checkTurn(t: Turn): Flag[] {
  const flags: Flag[] = []
  const runs = t.testRuns
  const last = runs.at(-1)
  const wentGreen = last !== undefined && !failed(last) && runs.slice(0, -1).some(failed)
  const testEdits = t.changes.filter(c => c.isTest && !c.isDelete)
  if (wentGreen && testEdits.length > 0)
    flags.push({ kind: 'tests-edited', detail: `${few(paths(testEdits))} changed in the turn that made tests pass` })

  const outside = t.changes.filter(c => c.outsideRoot)
  if (outside.length > 0) flags.push({ kind: 'outside-root', detail: `wrote outside the project: ${few(paths(outside))}` })

  const deleted = t.changes.filter(c => c.isDelete)
  const bulk = risky(t, BULK_DELETE)
  const gone = [...(deleted.length > 0 ? [`deleted ${few(paths(deleted))}`] : []), ...(bulk.labels.length > 0 ? [`ran ${bulk.labels.join(', ')}`] : [])]
  if (gone.length > 0) flags.push({ kind: 'deleted', detail: gone.join(' · '), ...(bulk.items.length > 0 ? { items: bulk.items } : {}) })

  const skips = t.changes.filter(c => c.addsSkip)
  if (skips.length > 0) flags.push({ kind: 'skipped-tests', detail: `added a skip or only marker in ${few(paths(skips))}` })

  const bypass = risky(t, BYPASS)
  if (bypass.labels.length > 0) flags.push({ kind: 'bypass', detail: bypass.labels.join(', '), items: bypass.items })

  return flags
}
