// The detail: what sits behind one card row (what Claude read, changed, tested, ran or should be checked).
// Fullscreen draws it inside the card, a press on the row toggling it; the main screen and /tldr show open it as a pane.
// The card stays the TL;DR; this is the "read it anyway".
import type { Elements, RenderInput, RenderSurface } from 'claude-code'

import type { Turn } from '../../types'
import { shortPath } from '../classify'
import { byFolder, changeTotals, stepsOf, stepVerb } from '../steps'
import type { Step } from '../steps'
import { testLabel } from '../summary'
import { runPart } from '../tests-parse'
import { countParts } from './tint'
import { color, glyph } from './theme'

export const DETAIL_PANE = 'tldr-detail'

export type Section = 'looked' | 'changed' | 'tests' | 'ran' | 'check' | 'notes'

const TITLE: Record<Section, string> = { looked: 'Looked at', changed: 'Changed', tests: 'Tests', ran: 'Ran', check: 'Check', notes: 'Notes' }
const DIFF_PEEK = 6 // diff lines shown per file; /tldr diff has the rest
const PEEK_FILES = 4 // more files than this: the pane lists them without diff lines, so it fits
const FOLDERS_ONLY = 12 // more files than this: one line per folder, so a big refactor still fits the pane
const STEPS_SHOWN = 16 // the newest steps; older ones fold into one line
const VERB_WIDTH = 8

export function sectionOf(word: string): Section | 'all' | null {
  const w = word.trim().toLowerCase()
  if (w === '' || w === 'all' || w === 'steps' || w === 'turn') return 'all'
  if (w === 'looked' || w === 'read' || w === 'reads' || w === 'search' || w === 'searches') return 'looked'
  if (w === 'changed' || w === 'changes' || w === 'files' || w === 'wrote') return 'changed'
  if (w === 'tests' || w === 'test') return 'tests'
  if (w === 'ran' || w === 'commands') return 'ran'
  if (w === 'check' || w === 'flags') return 'check'
  if (w === 'notes' || w === 'text') return 'notes'
  return null
}

export function sectionTitle(s: Section | 'all'): string {
  return s === 'all' ? 'Steps' : TITLE[s]
}

export function paneTitle(t: Turn, s: Section | 'all'): string {
  return s === 'all' ? `TL;DR · ${t.goal}` : `TL;DR · ${TITLE[s]}`
}

/** The commands behind the Ran row: log lines of calls that were not a read, search, change or test. */
export function ranCommands(t: Turn): string[] {
  return (t.ranLog ?? []).map(l => l.replace(/^Bash /, ''))
}

/** Rows the pane wants for a section, so a short list opens a short pane. */
export function paneRows(t: Turn, s: Section | 'all'): number {
  const count = (x: Section): number => {
    if (x === 'looked') return t.reads.length + t.searches.length + 2
    if (x === 'changed') {
      const folders = byFolder(t.changes).length
      if (t.changes.length > FOLDERS_ONLY) return 2 + folders
      return 1 + t.changes.length + folders + (t.changes.length > PEEK_FILES ? 1 : (t.diffs ?? []).reduce((n, d) => n + Math.min(d.lines.length, DIFF_PEEK), 0))
    }
    if (x === 'tests') return t.testRuns.length
    if (x === 'ran') return ranCommands(t).length
    if (x === 'notes') return t.interim.reduce((n, s) => n + s.split('\n').length, 0)
    return t.flags.reduce((n, f) => n + 1 + (f.items ?? []).length, 0)
  }
  const n = s === 'all' ? Math.min(stepsOf(t).length, STEPS_SHOWN + 1) + (t.flags.length > 0 ? count('check') + 2 : 0) : count(s)
  return Math.max(3, Math.min(18, n + 1))
}

function diffColor(l: string): string | undefined {
  if (l.startsWith('+')) return color.added
  if (l.startsWith('-')) return color.removed
  return color.dim
}

export function drawDetail(ui: Elements[RenderSurface], e: RenderInput<'Pane'> | RenderInput<'ToolGroup'> | RenderInput<'ToolUse'> | RenderInput<'AbovePrompt'>, t: Turn | null, s: Section | 'all') {
  const { Box, Text } = ui
  if (t === null) return <Box key="tldr-detail"><Text color={color.dim}>No turn yet.</Text></Box>

  const empty = (what: string) => <Text color={color.dim}>{what}</Text>
  // A text with its line counts in green and red; the rest keeps the given color.
  const tinted = (text: string, base?: string) => (
    <Text color={base}>{countParts(text).map(p => (p.tone === undefined ? p.text : <Text color={p.tone === 'added' ? color.added : color.removed}>{p.text}</Text>))}</Text>
  )
  // One list row: the name on the left, its fact dim on the right.
  const line = (name: string, fact?: string, factColor: string = color.dim) => (
    <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
      <Text wrap="truncate-end">{name}</Text>
      {fact !== undefined ? tinted(fact, factColor) : null}
    </Box>
  )
  const heading = (text: string) => tinted(text, color.label)

  const looked = () => (
    <Box flexDirection="column">
      {t.reads.length === 0 && t.searches.length === 0 ? empty('Read and searched nothing.') : null}
      {t.reads.length > 0 ? heading(`Read · ${t.reads.length}`) : null}
      {t.reads.map(p => line(`  ${shortPath(p)}`))}
      {t.searches.length > 0 ? heading(`Searched · ${t.searches.length}`) : null}
      {t.searches.map(p => line(`  ${p}`))}
    </Box>
  )

  // Files by folder, so ten files read as two or three places. One folder, or one file, stays a flat list.
  const changed = () => {
    if (t.changes.length === 0) return empty('No files changed that the card could see.')
    const diffs = new Map(t.changes.length > PEEK_FILES ? [] : (t.diffs ?? []).map(d => [d.path, d.lines]))
    const total = changeTotals(t.changes)
    const folders = byFolder(t.changes)
    const grouped = folders.length > 1
    const counts = (added: number, removed: number) => `+${added} ${glyph.minus}${removed}`
    const file = (c: Turn['changes'][number], indent: string) => {
      const fact = c.isDelete ? 'deleted' : c.viaBash ? 'via Bash' : counts(c.added, c.removed)
      const name = grouped ? shortPath(c.path).slice(dirLength(c.path)) : shortPath(c.path)
      const lines = (diffs.get(c.path) ?? []).filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
      return (
        <Box flexDirection="column">
          {line(`${indent}${name}`, fact, c.isDelete ? color.check : color.dim)}
          {lines.slice(0, DIFF_PEEK).map(l => <Text color={diffColor(l)} wrap="truncate-end">{`${indent}  ${l}`}</Text>)}
          {lines.length > DIFF_PEEK ? <Text color={color.dim}>{`${indent}  +${lines.length - DIFF_PEEK} more lines · /tldr diff`}</Text> : null}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {heading(`${total.files} file${total.files === 1 ? '' : 's'}${total.counted ? ` · ${counts(total.added, total.removed)}` : ''}`)}
        {t.changes.length > FOLDERS_ONLY
          ? folders.map(f => line(`${f.dir || './'}  ${f.changes.length} file${f.changes.length === 1 ? '' : 's'}`, f.added + f.removed > 0 ? counts(f.added, f.removed) : undefined))
          : grouped
          ? folders.map(f => (
              <Box flexDirection="column">
                {f.dir !== '' ? line(f.dir, f.added + f.removed > 0 ? counts(f.added, f.removed) : undefined) : null}
                {f.changes.map(c => file(c, f.dir !== '' ? '  ' : ''))}
              </Box>
            ))
          : t.changes.map(c => file(c, ''))}
        {t.changes.length > FOLDERS_ONLY ? <Text color={color.dim}>{'Each file and its lines: /tldr diff'}</Text>
          : t.changes.length > PEEK_FILES && (t.diffs ?? []).length > 0 ? <Text color={color.dim}>{'Diff lines: /tldr diff'}</Text> : null}
      </Box>
    )
  }

  const tests = () =>
    t.testRuns.length === 0 ? empty('No tests ran.') : (
      <Box flexDirection="column">
        {t.testRuns.map(r => {
          const l = testLabel(r)
          return line(runPart(r.command).split('\n')[0]!, l.result, l.ok ? color.pass : color.fail)
        })}
      </Box>
    )

  const ran = () => {
    const cmds = ranCommands(t)
    return cmds.length === 0 ? empty('No other commands ran.') : <Box flexDirection="column">{cmds.map(c => line(c))}</Box>
  }

  const check = () =>
    t.flags.length === 0 ? empty('Nothing to check.') : (
      <Box flexDirection="column">
        {t.flags.map(f => (
          <Box flexDirection="column">
            <Text color={color.check} wrap="truncate-end">{`⚠ ${f.detail}`}</Text>
            {(f.items ?? []).map(i => <Text color={color.dim} wrap="truncate-end">{`  ${i}`}</Text>)}
          </Box>
        ))}
      </Box>
    )

  // What Claude wrote between tool calls: folded off the transcript, kept here.
  const notes = () =>
    t.interim.length === 0 ? empty('No notes between tool calls.') : (
      <Box flexDirection="column" rowGap={1}>{t.interim.map(n => <Text color={color.dim} wrap="wrap">{n}</Text>)}</Box>
    )

  // The turn in order: how it got from the prompt to the result. A failing test is red, an edited test file amber.
  const steps = () => {
    const all = stepsOf(t)
    if (all.length === 0) return empty('No tool calls in this turn.')
    const shown = all.slice(-STEPS_SHOWN)
    const first = all.length - shown.length
    const flagged = t.flags.some(f => f.kind === 'tests-edited')
    const tone = (s: Step) =>
      s.kind === 'test' ? (s.ok ? color.pass : color.fail) : s.kind === 'delete' || (s.isTest && flagged) ? color.check : undefined
    return (
      <Box flexDirection="column">
        {first > 0 ? <Text color={color.dim}>{`… ${first} earlier step${first === 1 ? '' : 's'}`}</Text> : null}
        {shown.map((s, i) => (
          <Box flexDirection="row" columnGap={1}>
            <Box width={3} flexShrink={0}><Text color={color.dim}>{String(first + i + 1).padStart(2)}</Text></Box>
            <Box width={VERB_WIDTH} flexShrink={0}><Text color={color.label}>{stepVerb(s.kind)}</Text></Box>
            {tone(s) === undefined ? <Text wrap="truncate-end">{tinted(s.text)}</Text> : <Text color={tone(s)} wrap="truncate-end">{s.text}</Text>}
            {s.count > 1 ? <Text color={color.dim}>{`×${s.count}`}</Text> : null}
            {s.isTest ? <Text color={flagged ? color.check : color.dim}>test file</Text> : null}
          </Box>
        ))}
      </Box>
    )
  }

  const body: Record<Section, () => unknown> = { looked, changed, tests, ran, check, notes }
  if (s !== 'all') return <Box key="tldr-detail" flexDirection="column">{body[s]() as never}</Box>
  return (
    <Box key="tldr-detail" flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        <Text bold>Steps</Text>
        {steps() as never}
      </Box>
      {t.flags.length > 0 ? (
        <Box flexDirection="column">
          <Text bold color={color.check}>Check</Text>
          {check() as never}
        </Box>
      ) : null}
    </Box>
  )
}

/** Characters of the folder part of a path as the pane shows it, so a grouped file shows its name only. */
function dirLength(path: string): number {
  const p = shortPath(path)
  return p.lastIndexOf('/') + 1
}
