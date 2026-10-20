// The turn read four ways for the card and its pane: its verdict, totals, files by folder, and the steps in order. Pure.
import type { Change, Tone, Turn } from '../types'
import { few, shortPath } from './classify'
import { testLabel } from './summary'

export type Verdict = Tone | 'none' | 'running'

/** How the turn went, in one word: tests that end red first, then a flag to check, then green; `none` with no test run. */
export function verdictOf(t: Pick<Turn, 'endedAt' | 'flags' | 'testRuns'>): Verdict {
  if (t.endedAt === null) return 'running'
  const last = t.testRuns.at(-1)
  if (last !== undefined && !testLabel(last).ok) return 'fail'
  if (t.flags.length > 0) return 'check'
  return last === undefined ? 'none' : 'pass'
}

export type Totals = { files: number; added: number; removed: number; counted: boolean }

/** The size of the turn: files touched, and lines added and removed where the card could count them. */
export function changeTotals(changes: readonly Change[]): Totals {
  const counted = changes.filter(c => !c.viaBash && !c.isDelete)
  return {
    files: changes.length,
    added: counted.reduce((n, c) => n + c.added, 0),
    removed: counted.reduce((n, c) => n + c.removed, 0),
    counted: counted.length > 0,
  }
}

export type Folder = { dir: string; changes: Change[]; added: number; removed: number }

function dirOf(path: string): string {
  const p = shortPath(path)
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i + 1)
}

/** Changes grouped by folder, in the order each folder first changed. Files at the root sit under ''. */
export function byFolder(changes: readonly Change[]): Folder[] {
  const out: Folder[] = []
  for (const c of changes) {
    const dir = dirOf(c.path)
    let f = out.find(x => x.dir === dir)
    if (f === undefined) out.push((f = { dir, changes: [], added: 0, removed: 0 }))
    f.changes.push(c)
    if (!c.viaBash && !c.isDelete) {
      f.added += c.added
      f.removed += c.removed
    }
  }
  return out
}

export type StepKind = 'read' | 'search' | 'edit' | 'write' | 'delete' | 'test' | 'ran'
export type Step = { kind: StepKind; text: string; count: number; ok?: boolean; isTest?: boolean }

const VERB: Record<StepKind, string> = { read: 'Read', search: 'Search', edit: 'Edit', write: 'Write', delete: 'Delete', test: 'Test', ran: 'Ran' }
export const stepVerb = (k: StepKind): string => VERB[k]

const EDIT = /^(\S+) (.+) \+(\d+) −(\d+)$/
const TEST = /^Bash ([\s\S]*) · ([✓✗]) (.+)$/
const CMD_MAX = 48

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// A step while it is built: the names or edits a merged step stands for.
type Draft = Step & { names?: string[]; edits?: { path: string; added: number; removed: number }[] }

/** One log line as a step. The log keeps one line per tool call, in order (see summary.ts logLine). */
function stepOf(line: string, tests: ReadonlySet<string>): Draft {
  let m: RegExpMatchArray | null
  if (line.startsWith('Read ')) return { kind: 'read', text: line.slice(5), count: 1, names: [line.slice(5)] }
  if (line.startsWith('Search ')) return { kind: 'search', text: line.slice(7), count: 1, names: [line.slice(7)] }
  if ((m = line.match(TEST)) !== null) return { kind: 'test', text: `${clip(m[1]!.split('\n')[0]!, CMD_MAX)} ${m[2]} ${m[3]}`, count: 1, ok: m[2] === '✓' }
  if ((m = line.match(/^\S+ deleted (.+)$/)) !== null) return { kind: 'delete', text: m[1]!, count: 1 }
  if ((m = line.match(/^\S+ wrote (.+)$/)) !== null) return { kind: 'write', text: `${m[1]} via Bash`, count: 1, isTest: m[1]!.split(' ').some(p => tests.has(p)) }
  if ((m = line.match(EDIT)) !== null) {
    const isTest = tests.has(m[2]!)
    const edits = m[1] === 'Write' || isTest ? undefined : [{ path: m[2]!, added: Number(m[3]), removed: Number(m[4]) }]
    return { kind: m[1] === 'Write' ? 'write' : 'edit', text: `${m[2]} +${m[3]} −${m[4]}`, count: 1, isTest, edits }
  }
  return { kind: 'ran', text: clip(line.replace(/^Bash /, '').split('\n')[0]!, CMD_MAX + 20), count: 1 }
}

// Back-to-back edits of different files read as one step: "3 files +9 −3 · a.go, b.go +1 more".
function editText(edits: readonly { path: string; added: number; removed: number }[]): string {
  const files = [...new Set(edits.map(e => e.path))]
  const sum = (k: 'added' | 'removed') => edits.reduce((n, e) => n + e[k], 0)
  if (files.length === 1) return `${files[0]} +${sum('added')} −${sum('removed')}`
  return `${files.length} files +${sum('added')} −${sum('removed')} · ${few(files)}`
}

/**
 * The turn as steps in order. Back-to-back reads, searches, or edits of code merge into one step, so a
 * refactor of 15 files is one line and the story stays on screen. A repeated step stacks as ×N. An edit
 * to a test file never merges: it is the step to look at.
 */
export function stepsOf(t: Pick<Turn, 'log' | 'changes'>): Step[] {
  const tests = new Set(t.changes.filter(c => c.isTest).map(c => shortPath(c.path)))
  const out: Draft[] = []
  for (const line of t.log) {
    const s = stepOf(line, tests)
    const last = out[out.length - 1]
    if (last?.edits !== undefined && s.edits !== undefined) {
      last.edits.push(...s.edits)
      last.text = editText(last.edits)
      continue
    }
    if (last !== undefined && last.names !== undefined && s.names !== undefined && last.kind === s.kind) {
      if (!last.names.includes(s.names[0]!)) last.names.push(s.names[0]!)
      last.text = few(last.names)
      continue
    }
    if (last !== undefined && last.kind === s.kind && last.text === s.text) {
      last.count++
      continue
    }
    out.push(s)
  }
  return out.map(({ names: _n, edits: _e, ...s }) => s)
}
