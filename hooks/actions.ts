// What the card's actions put on the clipboard or the screen: clean reply text, the turn's diff. Pure.
import type { FileDiff, Turn } from '../types'
import { patchesOf } from './classify'

/** Claude's reply as plain text to paste: no CRs, no trailing spaces, no shared indentation, at most one blank line in a row. */
export function cleanCopy(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t]+$/, ''))
  const indents = lines.filter(l => l !== '').map(l => /^[ \t]*/.exec(l)![0].length)
  const shared = indents.length > 0 ? Math.min(...indents) : 0
  return lines
    .map(l => l.slice(shared))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

const EDIT_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']

/** One finished edit as diff lines: the engine's structured patch, or a new file's content as added lines. */
export function diffOf(tool: string, input: unknown, result: unknown, isError: boolean): FileDiff | null {
  if (isError || !EDIT_TOOLS.includes(tool)) return null
  const i = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const path = str(i.file_path) ?? str(i.notebook_path)
  if (path === undefined) return null
  const patches = patchesOf(result)
  if (patches.length > 0) {
    const lines: string[] = []
    for (const p of patches) {
      if (p.oldStart !== undefined && p.newStart !== undefined) lines.push(`@@ -${p.oldStart},${p.oldLines ?? 0} +${p.newStart},${p.newLines ?? 0} @@`)
      lines.push(...p.lines)
    }
    return { path, lines }
  }
  const content = str(i.content)
  if (tool !== 'Write' || content === undefined) return null
  const added = content.split('\n')
  if (added.at(-1) === '') added.pop()
  return { path, lines: [`@@ -0,0 +1,${added.length} @@`, ...added.map(l => `+${l}`)] }
}

export const DIFF_FILE_MAX = 400 // lines kept per file per turn

/** Adds one edit's lines to the turn's diffs, merged per file. */
export function addDiff(diffs: readonly FileDiff[], d: FileDiff): FileDiff[] {
  const i = diffs.findIndex(x => x.path === d.path)
  if (i < 0) return [...diffs, { path: d.path, lines: d.lines.slice(0, DIFF_FILE_MAX) }]
  return diffs.map((x, j) => (j === i ? { path: x.path, lines: [...x.lines, ...d.lines].slice(0, DIFF_FILE_MAX) } : x))
}

/**
 * The turn's diffs with each file's net change in place of its edit-by-edit patches.
 * A file with no net result (lines null: too large, or not read) keeps its patches; a file back to where it was drops out.
 */
export function mergeNet(diffs: readonly FileDiff[], net: readonly { path: string; lines: string[] | null }[]): FileDiff[] {
  let out = [...diffs]
  for (const n of net) {
    if (n.lines === null) continue
    out = out.filter(d => d.path !== n.path)
    if (n.lines.length > 0) out.push({ path: n.path, lines: n.lines.slice(0, DIFF_FILE_MAX) })
  }
  return out
}

/** The turn's edits as one unified-style diff; empty when the turn edited nothing. */
export function turnDiff(t: Turn): string {
  const out: string[] = []
  for (const d of t.diffs ?? []) {
    // A path outside the project stays absolute, so it takes no a/ and b/ prefix.
    const isAbsolute = d.path.startsWith('/') || d.path.startsWith('~')
    out.push(isAbsolute ? `--- ${d.path}` : `--- a/${d.path}`, isAbsolute ? `+++ ${d.path}` : `+++ b/${d.path}`, ...d.lines)
    if (d.lines.length >= DIFF_FILE_MAX) out.push(`… cut at ${DIFF_FILE_MAX} lines`)
  }
  return out.join('\n')
}
