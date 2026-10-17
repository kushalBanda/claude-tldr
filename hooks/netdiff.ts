// A file's net change over a turn: unified diff hunks between its text before the turn's first edit and after the turn. Pure.

const CONTEXT = 3
const MAX_CELLS = 4_000_000 // the line table's size limit; past it there is no net diff

type Op = { kind: ' ' | '-' | '+'; text: string; a: number; b: number } // a, b: 1-based line numbers in before/after

function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/** The edit script between two line lists: common prefix and suffix, then a longest-common-subsequence table for the middle. */
function script(a: string[], b: string[]): Op[] | null {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const n = endA - start
  const m = endB - start
  if ((n + 1) * (m + 1) > MAX_CELLS) return null
  // lcs[i][j]: the common run length of a[start+i..endA) and b[start+j..endB).
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] = a[start + i] === b[start + j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  const ops: Op[] = []
  for (let k = 0; k < start; k++) ops.push({ kind: ' ', text: a[k]!, a: k + 1, b: k + 1 })
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      ops.push({ kind: ' ', text: a[start + i]!, a: start + i + 1, b: start + j + 1 })
      i++
      j++
    } else if (i < n && (j === m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      // On a tie the removed line goes first, as a unified diff writes a changed line.
      ops.push({ kind: '-', text: a[start + i]!, a: start + i + 1, b: start + j + 1 })
      i++
    } else {
      ops.push({ kind: '+', text: b[start + j]!, a: start + i + 1, b: start + j + 1 })
      j++
    }
  }
  for (let k = 0; k < a.length - endA; k++) ops.push({ kind: ' ', text: a[endA + k]!, a: endA + k + 1, b: endB + k + 1 })
  return ops
}

/** Unified diff hunks (`@@ -a,n +b,m @@` then lines) from `before` to `after`; [] when equal, null when too large to compare. */
export function unifiedDiff(before: string, after: string): string[] | null {
  const ops = script(splitLines(before), splitLines(after))
  if (ops === null) return null
  const changed = ops.map((o, k) => (o.kind !== ' ' ? k : -1)).filter(k => k >= 0)
  if (changed.length === 0) return []
  // Group changes whose context windows touch into one hunk.
  const groups: [number, number][] = []
  for (const k of changed) {
    const last = groups.at(-1)
    if (last !== undefined && k - last[1] <= CONTEXT * 2) last[1] = k
    else groups.push([k, k])
  }
  const out: string[] = []
  for (const [first, last] of groups) {
    const from = Math.max(0, first - CONTEXT)
    const to = Math.min(ops.length - 1, last + CONTEXT)
    const slice = ops.slice(from, to + 1)
    const oldLines = slice.filter(o => o.kind !== '+').length
    const newLines = slice.filter(o => o.kind !== '-').length
    const head = slice[0]!
    const oldStart = oldLines === 0 ? head.a - 1 : head.a
    const newStart = newLines === 0 ? head.b - 1 : head.b
    out.push(`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`, ...slice.map(o => `${o.kind}${o.text}`))
  }
  return out
}
