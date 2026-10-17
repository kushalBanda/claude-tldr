// Short words for tool calls: the main screen's one-line group summary and the /tldr expand log. Pure.
import type { TestRun } from '../types'
import type { ClassifiedCall } from './classify'
import { classify, few, shortPath } from './classify'
import { runPart } from './tests-parse'

const MINUS = '−'

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** A test run in words: `text` names the runner ("go test ✗ 1 failed"), `result` leaves it out ("✗ 1 failed"). */
export function testLabel(r: TestRun): { ok: boolean; text: string; result: string } {
  const name = r.runner ?? 'tests'
  const [ok, result] =
    r.failed !== null && r.failed > 0 ? [false, `✗ ${r.failed} failed`]
    : r.passed !== null && !r.isError ? [true, `✓ ${r.passed} passed`]
    : r.isError ? [false, `✗ ${r.note ?? 'failed'}`]
    : [true, '✓ ran']
  return { ok, text: `${name} ${result}`, result }
}

// An MCP tool reads as its server and tool: mcp__codegraph__codegraph_explore is "codegraph codegraph_explore".
function toolName(tool: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool)
  return m ? `${m[1]} ${m[2]}` : tool
}

// Tools that load instructions or track the plan: they run nothing, so the card counts them nowhere.
const META = /^(Skill|ToolSearch|TodoWrite|Task(Create|Update|List|Get)|EnterPlanMode|ExitPlanMode|AskUserQuestion)$/

export function isMeta(tool: string): boolean {
  return META.test(tool)
}

/** The log lines for one finished call: one per job, so `rm x && go test` logs the delete and the test run. */
export function logLines(tool: string, calls: ClassifiedCall[], input: unknown): string[] {
  const jobs: ClassifiedCall[][] = [
    calls.filter(c => c.kind === 'read'),
    calls.filter(c => c.kind === 'search'),
    calls.filter(c => c.kind === 'change' && !c.change.isDelete),
    calls.filter(c => c.kind === 'change' && c.change.isDelete),
    calls.filter(c => c.kind === 'test'),
  ].filter(g => g.length > 0)
  if (jobs.length <= 1) return [logLine(tool, calls, input)]
  // Reads log one line each, as the Read tool does, so the steps merge them the same way.
  return jobs.flatMap(g => (g[0]!.kind === 'read' ? g.map(c => logLine(tool, [c], input)) : [logLine(tool, g, input)]))
}

/** One log line for one finished call. */
export function logLine(tool: string, calls: ClassifiedCall[], input: unknown): string {
  const c = calls[0]
  if (c === undefined) return toolName(tool)
  if (c.kind === 'read') return `Read ${shortPath(c.path)}`
  if (c.kind === 'search') return `Search ${c.pattern}`
  if (c.kind === 'change' && c.change.viaBash && !c.change.isDelete) return `${tool} wrote ${calls.map(x => (x.kind === 'change' ? shortPath(x.change.path) : '')).join(' ')}`
  if (c.kind === 'change')
    return c.change.isDelete ? `${tool} deleted ${calls.map(x => (x.kind === 'change' ? shortPath(x.change.path) : '')).join(' ')}` : `${tool} ${shortPath(c.change.path)} +${c.change.added} ${MINUS}${c.change.removed}`
  if (c.kind === 'test') return `Bash ${runPart(c.run.command)} · ${testLabel(c.run).result}`
  const i = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const detail = [i.command, i.description, i.url, i.query].find((v): v is string => typeof v === 'string' && v.trim() !== '') ?? ''
  return detail ? `${toolName(tool)} ${detail.split('\n')[0]!.slice(0, 100)}` : toolName(tool)
}

export type GroupCall = { tool: string; input: unknown; output?: unknown; isRunning: boolean; isErrored: boolean }

const SEARCH_MAX = 40

function unique(names: readonly string[]): string[] {
  return [...new Set(names)]
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** The parts of a tool group's one-line summary, in a stable order. */
export function groupSummary(calls: readonly GroupCall[], root?: string): string[] {
  const reads: string[] = []
  const searches: string[] = []
  let others = 0
  let running = 0
  const changes = new Map<string, { added: number; removed: number }>()
  const deleted: string[] = []
  const viaBash: string[] = []
  const tests: string[] = []
  for (const call of calls) {
    if (isMeta(call.tool)) continue
    if (call.isRunning) {
      running++
      continue
    }
    for (const c of classify(call.tool, call.input, call.output, call.isErrored, root)) {
      if (c.kind === 'read') reads.push(shortPath(c.path))
      else if (c.kind === 'search') searches.push(c.pattern)
      else if (c.kind === 'change' && c.change.isDelete) deleted.push(shortPath(c.change.path))
      else if (c.kind === 'change' && c.change.viaBash) viaBash.push(shortPath(c.change.path))
      else if (c.kind === 'change') {
        const old = changes.get(c.change.path) ?? { added: 0, removed: 0 }
        changes.set(c.change.path, { added: old.added + c.change.added, removed: old.removed + c.change.removed })
      } else if (c.kind === 'test') tests.push(testLabel(c.run).text)
      else others++
    }
  }
  const parts: string[] = []
  // Name what was read, searched and written: "Read 1 file" tells you nothing.
  if (reads.length > 0) parts.push(`Read ${few(unique(reads))}`)
  if (searches.length === 1) parts.push(`Searched ${clip(searches[0]!, SEARCH_MAX)}`)
  else if (searches.length > 1) parts.push(plural(searches.length, 'search', 'searches'))
  // Two edits name their files; more read as one count, so a refactor stays one line.
  if (changes.size > 2) {
    const sum = (k: 'added' | 'removed') => [...changes.values()].reduce((n, d) => n + d[k], 0)
    parts.push(`edited ${changes.size} files +${sum('added')} ${MINUS}${sum('removed')}`)
  } else for (const [path, d] of changes) parts.push(`${shortPath(path)} +${d.added} ${MINUS}${d.removed}`)
  if (viaBash.length > 0) parts.push(`wrote ${few(unique(viaBash))}`)
  if (deleted.length > 0) parts.push(`deleted ${few(unique(deleted))}`)
  parts.push(...tests)
  if (others > 0) parts.push(plural(others, 'other call', 'other calls'))
  if (running > 0) parts.push(`${running} running…`)
  return parts
}

// Words before the program a command runs: `cd x && git merge` ran git.
const PRELUDE = /^(cd|export|set|source|\.|sudo|env|time|nohup|[A-Za-z_][A-Za-z0-9_]*=\S*)$/

/** A short name for a call the card counts under Ran: the program a Bash command runs, an MCP server, or the tool. */
export function runName(tool: string, input: unknown): string {
  const i = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  if (tool === 'Bash' && typeof i.command === 'string') {
    for (const seg of i.command.split(/&&|\|\||;|\||\n/)) {
      const words = seg.trim().split(/\s+/).filter(w => w !== '')
      const prog = words.find(w => !PRELUDE.test(w))
      if (words[0] === 'cd' || prog === undefined) continue
      return prog.replace(/^.*\//, '')
    }
    return 'Bash'
  }
  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(tool)
  return mcp ? mcp[1]! : tool
}

/** The card's Ran row: each name once, in first-run order, with a count when it ran more than once. */
export function ranLabel(names: readonly string[], max = 6): string {
  const counts = new Map<string, number>()
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1)
  const parts = [...counts].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n))
  const shown = parts.slice(0, max)
  if (parts.length > max) shown.push(`+${parts.length - max} more`)
  return shown.join(' · ')
}

/** Whether a call says nothing a summary line can: not a read, search, change or test. The card's Ran row counts it. */
export function isQuiet(call: GroupCall, root?: string): boolean {
  return classify(call.tool, call.input, call.output, call.isErrored, root).every(c => c.kind === 'other')
}

/** What Claude is doing now, for the spinner and the band: "Reading src/auth.py". */
export function activityWord(tool: string, input: unknown): string {
  const i = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const path = typeof i.file_path === 'string' ? i.file_path : typeof i.notebook_path === 'string' ? i.notebook_path : undefined
  if (tool === 'Read' && path) return `Reading ${path}`
  if ((tool === 'Edit' || tool === 'MultiEdit' || tool === 'Write' || tool === 'NotebookEdit') && path) return `Editing ${path}`
  if (tool === 'Grep' || tool === 'Glob') return `Searching ${typeof i.pattern === 'string' ? i.pattern : ''}`.trim()
  if (tool === 'Bash' && typeof i.command === 'string') {
    const first = i.command.trim().split('\n')[0]!
    return `Running ${first.length > 40 ? `${first.slice(0, 39)}…` : first}`
  }
  return `Using ${tool}`
}
