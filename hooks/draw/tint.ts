// Line counts inside a text, as in "src/auth.py +12 −3": the parts to draw green and red. Pure.

export type Part = { text: string; tone?: 'added' | 'removed' }

// "+12" or "−3" (the minus sign, not a hyphen) standing alone as a word, so a flag like "-v" or "a+1" stays plain.
const COUNT = /(^|\s)(\+\d+|−\d+)(?=\s|$)/g

export function countParts(text: string): Part[] {
  const out: Part[] = []
  let at = 0
  for (const m of text.matchAll(COUNT)) {
    const start = m.index! + m[1]!.length
    if (start > at) out.push({ text: text.slice(at, start) })
    out.push({ text: m[2]!, tone: m[2]!.startsWith('+') ? 'added' : 'removed' })
    at = start + m[2]!.length
  }
  if (at < text.length) out.push({ text: text.slice(at) })
  return out
}
