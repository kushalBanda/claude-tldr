// Turn one tool call and its result into facts for the card. Pure.
import type { Change, TestRun } from '../types'
import { detectRunner, parseResult } from './tests-parse'

export type ClassifiedCall =
  | { kind: 'read'; path: string }
  | { kind: 'search'; pattern: string }
  | { kind: 'change'; change: Change }
  | { kind: 'test'; run: TestRun }
  | { kind: 'other'; tool: string }

export type Patch = { lines: string[]; oldStart?: number; oldLines?: number; newStart?: number; newLines?: number }

const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|(^|\/)(test_[^/]*|[^/]*_test\.[a-z]+|[^/]*\.(test|spec)\.[a-z]+|conftest\.py)$/

export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path)
}

/** Lines added and removed, from the engine's structured patch. */
export function patchDelta(patches: readonly Patch[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const p of patches)
    for (const l of p.lines) {
      if (l.startsWith('+')) added++
      else if (l.startsWith('-')) removed++
    }
  return { added, removed }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

export function patchesOf(result: unknown): Patch[] {
  const p = obj(result).structuredPatch
  return Array.isArray(p) ? p.filter((x): x is Patch => Array.isArray(obj(x).lines)) : []
}

// A test marked to be skipped, run alone or expected to fail, in the common frameworks.
const SKIP = /(@pytest\.mark\.(skip|xfail)|pytest\.skip\(|\b(it|test|describe)\.(skip|only)\(|\bx(it|describe|test)\(|\bt\.Skip\(|#\[ignore\]|@Disabled\b|@Ignore\b|\bskip\()/

/** Whether the patch adds a skip/only/xfail marker that the removed lines did not have. */
export function addsSkipMarker(patches: readonly Patch[]): boolean {
  const removed = new Set<string>()
  const added: string[] = []
  for (const p of patches)
    for (const l of p.lines) {
      if (l.startsWith('-')) removed.add(l.slice(1).trim())
      else if (l.startsWith('+')) added.push(l.slice(1).trim())
    }
  return added.some(l => SKIP.test(l) && !removed.has(l))
}

/** A path as the card shows it: relative inside the project root, absolute outside it. */
export function placePath(path: string, root: string | undefined): { path: string; outsideRoot: boolean } {
  if (root === undefined || root === '') return { path, outsideRoot: false }
  const base = root.endsWith('/') ? root : `${root}/`
  if (path.startsWith(base)) return { path: path.slice(base.length), outsideRoot: false }
  if (path === root) return { path: '.', outsideRoot: false }
  if (!path.startsWith('/') && !path.startsWith('~')) return { path, outsideRoot: path.startsWith('..') }
  return { path, outsideRoot: true }
}

/** "a, b +3 more": the first two names, so a list stays on one line. */
export function few(names: readonly string[]): string {
  const shown = names.slice(0, 2).join(', ')
  return names.length > 2 ? `${shown} +${names.length - 2} more` : shown
}

/** A path as it fits on a card row: an absolute path outside the project keeps its last two parts. */
export function shortPath(path: string): string {
  if (!path.startsWith('/') && !path.startsWith('~')) return path
  const parts = path.split('/').filter(p => p !== '')
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : path
}

// Heredoc bodies and quoted strings hold text, not commands. Heredocs are dropped; each quoted string
// becomes a placeholder that `unquote` turns back into its text once a path has been picked out.
type Words = { text: string; quoted: string[] }

function shellWords(command: string): Words {
  const quoted: string[] = []
  const text = command
    .replace(/<<-?\s*['"]?(\w+)['"]?([^\n]*)\n[\s\S]*?\n\s*\1\s*(?=\n|$)/g, '$2')
    .replace(/'([^'\n]*)'|"((?:[^"\\\n]|\\.)*)"/g, (_, a: string | undefined, b: string | undefined) => `\x01${quoted.push(a ?? (b ?? '').replace(/\\(.)/g, '$1')) - 1}\x01`)
  return { text, quoted }
}

function unquote(word: string, w: Words): string {
  return word.replace(/\x01(\d+)\x01/g, (_, i: string) => w.quoted[Number(i)] ?? '')
}

// A path the text names: not empty, and no variable, command substitution or glob to expand.
function named(path: string): boolean {
  return path !== '' && !/[$`*?[\]]/.test(path)
}

/** `path` as seen from `dir`, both relative to where the command started. */
function joinPath(dir: string, path: string): string {
  if (dir === '' || path.startsWith('/') || path.startsWith('~')) return path
  const out: string[] = []
  for (const part of `${dir}/${path}`.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..' && out.length > 0 && out.at(-1) !== '..') out.pop()
    else out.push(part)
  }
  const joined = out.join('/') || '.'
  return dir.startsWith('/') ? `/${joined}` : path.endsWith('/') ? `${joined}/` : joined
}

function baseName(path: string): string {
  return path.replace(/\/+$/, '').split('/').at(-1) ?? path
}

const CD_CMD = /^\s*cd(?:\s+(\S+))?\s*$/

/**
 * The command's parts in order (split at && ; || | and newlines, but not the `>|` redirect), each with the
 * folder a `cd` before it moved to. `dir` is null after a `cd` the text cannot follow.
 */
function partsOf(w: Words): { part: string; dir: string | null }[] {
  const out: { part: string; dir: string | null }[] = []
  let dir: string | null = ''
  for (const part of w.text.split(/\s*(?:&&|;|\|\||(?<!>)\||\n)\s*/)) {
    const cd = CD_CMD.exec(part)
    if (cd) {
      const to = cd[1] === undefined ? '' : unquote(cd[1], w)
      dir = dir === null || !named(to) || to === '-' || to === '~' ? null : joinPath(dir, to)
      continue
    }
    out.push({ part, dir })
  }
  return out
}

function place(path: string, dir: string | null): string | null {
  if (!named(path)) return null
  if (dir === null) return path.startsWith('/') || path.startsWith('~') ? path : null
  return joinPath(dir, path)
}

const RM_CMD = /^\s*(?:sudo\s+)?(?:git\s+)?rm\s+(.+)$/

/** Paths a plain `rm` or `git rm` command deletes; none for anything more complex. */
export function rmTargets(command: string): string[] {
  const w = shellWords(command)
  const out: string[] = []
  for (const { part, dir } of partsOf(w)) {
    const m = RM_CMD.exec(part)
    if (!m) continue
    let flags = true
    for (const word of m[1]!.split(/\s+/)) {
      if (word === '') continue
      if (flags && word === '--') { flags = false; continue }
      if (flags && word.startsWith('-')) continue
      const path = place(unquote(word, w), dir)
      if (path !== null) out.push(path)
    }
  }
  return out
}

const REDIRECT = /(?:^|[^\d&>])>>?\|?\s*([^\s;&|<>()]+)/g
const LAST_ARG_CMD = /^\s*(?:sudo\s+)?(?:sed\s+(?:-[a-zA-Z]*\s+)*-i|perl\s+-[a-z]*i|cp|mv|touch|install)\b(.*)$/
const TEE_CMD = /^\s*(?:sudo\s+)?tee\s+(.+)$/
// `git checkout -- <paths>` and `git restore <paths>` put files back. `restore --staged` alone touches only the index.
const CHECKOUT_CMD = /^\s*git\s+checkout\b.*?\s--\s+(.+)$/
const RESTORE_CMD = /^\s*git\s+restore\s+(.+)$/

function restorePaths(args: string): string[] {
  const words = args.split(/\s+/).filter(x => x !== '')
  if (words.some(x => x === '--staged' || x === '-S') && !words.some(x => x === '--worktree' || x === '-W')) return []
  const out: string[] = []
  let flags = true
  for (let k = 0; k < words.length; k++) {
    const word = words[k]!
    if (flags && word === '--') { flags = false; continue }
    if (flags && (word === '-s' || word === '--source')) { k++; continue }
    if (flags && word.startsWith('-')) continue
    out.push(word)
  }
  return out
}

/** Paths a Bash command writes by plain means: a redirect, tee, sed -i, perl -i, cp, mv, touch, git restore. */
export function bashWrites(command: string): string[] {
  const w = shellWords(command)
  const out = new Set<string>()
  const add = (word: string, dir: string | null) => {
    const path = place(unquote(word, w), dir)
    if (path !== null && !path.startsWith('/dev/')) out.add(path)
  }
  for (const { part, dir } of partsOf(w)) {
    for (const m of part.matchAll(REDIRECT)) if (!m[1]!.startsWith('&')) add(m[1]!, dir)
    const bare = part.replace(/\s*\d?>>?.*$/, '') // the command without its redirects
    const tee = TEE_CMD.exec(bare)
    if (tee) for (const word of tee[1]!.split(/\s+/)) if (word !== '' && !word.startsWith('-')) add(word, dir)
    const back = CHECKOUT_CMD.exec(part)?.[1] ?? RESTORE_CMD.exec(part)?.[1]
    if (back !== undefined) for (const word of restorePaths(back)) add(word, dir)
    const last = LAST_ARG_CMD.exec(bare)
    if (last) {
      const args = last[1]!.trim().split(/\s+/).filter(x => x !== '' && !x.startsWith('-')).map(x => unquote(x, w)).filter(x => x !== '')
      const target = args.at(-1)
      if (target === undefined) continue
      if (!/^\s*(?:sudo\s+)?(?:cp|mv|install)\b/.test(part)) { add(target, dir); continue }
      // A source, then the target. More than one source, or a target ending in `/`, means a folder.
      const sources = args.slice(0, -1)
      if (sources.length === 0) continue
      if (sources.length > 1 || target.endsWith('/')) for (const s of sources) add(joinPath(target, baseName(s)), dir)
      else add(target, dir)
    }
  }
  return [...out]
}

// `sed -n` takes its script first (`sed -n 28,100p file`), so the path is the word after it.
const READ_CMD = /^\s*(cat|head|tail|less|bat|sed\s+-n\s+(?:'[^']*'|"[^"]*"|\S+))\s+(?:-\S+\s+)*([^\s|;&>]+)/
const SEARCH_CMD = /^\s*(rg|grep|egrep|ag|find|fd|ls)\b(.*)$/

const PATTERN_MAX = 80

// A search as the card names it: the first sub-command only, on one line.
function searchPattern(command: string): string {
  const first = command.trim().split(/\s*(?:&&|;|\|\||\||\n)\s*/)[0] ?? ''
  return first.length > PATTERN_MAX ? `${first.slice(0, PATTERN_MAX - 1)}…` : first
}

export function classify(tool: string, input: unknown, result: unknown, isError: boolean, root?: string): ClassifiedCall[] {
  const i = obj(input)
  const rawPath = str(i.file_path) ?? str(i.notebook_path) ?? str(i.path)
  const placed = rawPath === undefined ? undefined : placePath(rawPath, root)
  const path = placed?.path

  if (tool === 'Read' && path) return [{ kind: 'read', path }]
  if (tool === 'Grep' || tool === 'Glob') return [{ kind: 'search', pattern: str(i.pattern) ?? '' }]

  if ((tool === 'Edit' || tool === 'MultiEdit' || tool === 'Write' || tool === 'NotebookEdit') && path) {
    if (isError) return [{ kind: 'other', tool }]
    let patches = patchesOf(result)
    if (patches.length === 0 && tool === 'Write') patches = [{ lines: (str(i.content) ?? '').split('\n').filter((l, k, all) => k < all.length - 1 || l !== '').map(l => `+${l}`) }]
    const delta = patchDelta(patches)
    const change: Change = { path, ...delta, viaBash: false, isTest: isTestPath(path), isDelete: false, outsideRoot: placed!.outsideRoot, addsSkip: addsSkipMarker(patches) }
    return [{ kind: 'change', change }]
  }

  if (tool === 'Bash') {
    const command = str(i.command) ?? ''
    const runner = detectRunner(command)
    if (runner !== null) {
      const r = obj(result)
      const output = `${str(r.stdout) ?? ''}\n${str(r.stderr) ?? ''}`
      return [{ kind: 'test', run: { command, runner, ...parseResult(runner, output), isError } }]
    }
    const gone = isError ? [] : rmTargets(command)
    if (gone.length > 0)
      return gone.map(p => {
        const at = placePath(p, root)
        return { kind: 'change', change: { path: at.path, added: 0, removed: 0, viaBash: true, isTest: isTestPath(at.path), isDelete: true, outsideRoot: at.outsideRoot, addsSkip: false } }
      })
    const written = isError ? [] : bashWrites(command)
    if (written.length > 0)
      return written.map(p => {
        const at = placePath(p, root)
        return { kind: 'change', change: { path: at.path, added: 0, removed: 0, viaBash: true, isTest: isTestPath(at.path), isDelete: false, outsideRoot: at.outsideRoot, addsSkip: false } }
      })
    const read = READ_CMD.exec(command)
    if (read) return [{ kind: 'read', path: read[2]! }]
    const search = SEARCH_CMD.exec(command)
    if (search) return [{ kind: 'search', pattern: searchPattern(command) }]
  }

  return [{ kind: 'other', tool }]
}
