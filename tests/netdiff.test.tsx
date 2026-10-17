import { expect, mock, test } from 'claude-code/testing'

import { mergeNet, turnDiff } from '../hooks/actions'
import { unifiedDiff } from '../hooks/netdiff'
import { goalOf, startTurn } from '../hooks/turn'

const BEFORE = ['export function isValid() {', '  return true', '}', ''].join('\n')
const AFTER = ['export function isValid() {', '  return true', '}', '', 'export function timeLeft() {', '  return Math.max(0, 1)', '}', ''].join('\n')

test('netdiff: equal texts give no hunks', async () => {
  expect(unifiedDiff(BEFORE, BEFORE)).toEqual([])
})

test('netdiff: an addition gives one hunk with context and + lines', async () => {
  expect(unifiedDiff(BEFORE, AFTER)).toEqual(['@@ -1,3 +1,7 @@', ' export function isValid() {', '   return true', ' }', '+', '+export function timeLeft() {', '+  return Math.max(0, 1)', '+}'])
})

test('netdiff: a changed line is - then +, and a new file is all +', async () => {
  expect(unifiedDiff('a\nb\nc\n', 'a\nB\nc\n')).toEqual(['@@ -1,3 +1,3 @@', ' a', '-b', '+B', ' c'])
  expect(unifiedDiff('', 'x\ny\n')).toEqual(['@@ -0,0 +1,2 @@', '+x', '+y'])
})

test('netdiff: far-apart changes are separate hunks', async () => {
  const a = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n')
  const b = a.replace('l1\n', 'L1\n').replace('l18', 'L18')
  const hunks = (unifiedDiff(a, b) ?? []).filter(l => l.startsWith('@@'))
  expect(hunks).toEqual(['@@ -1,5 +1,5 @@', '@@ -16,5 +16,5 @@'])
})

test('mergeNet: the net change replaces the patches; unknown keeps them; no net change drops the file', async () => {
  const patches = [{ path: 'a.ts', lines: ['+x', '-x', '+y'] }, { path: 'b.ts', lines: ['+z'] }, { path: 'c.ts', lines: ['+q', '-q'] }]
  expect(mergeNet(patches, [{ path: 'a.ts', lines: ['@@ -1,0 +1,1 @@', '+y'] }, { path: 'b.ts', lines: null }, { path: 'c.ts', lines: [] }])).toEqual([
    { path: 'b.ts', lines: ['+z'] },
    { path: 'a.ts', lines: ['@@ -1,0 +1,1 @@', '+y'] },
  ])
})

test('diff header: a project path gets a/ and b/, an absolute path stays as it is', async () => {
  const text = turnDiff({ ...startTurn('t', 'go', 0), diffs: [{ path: 'src/a.ts', lines: ['+x'] }, { path: '/tmp/demo/b.ts', lines: ['+y'] }] })
  expect(text).toBe(['--- a/src/a.ts', '+++ b/src/a.ts', '+x', '--- /tmp/demo/b.ts', '+++ /tmp/demo/b.ts', '+y'].join('\n'))
})

test('goal: an absolute path in the prompt keeps its last two parts', async () => {
  expect(goalOf('In /private/tmp/claude-501/scratchpad/tldr-demo:\n1. Read auth.ts')).toBe('In …/scratchpad/tldr-demo:')
})

test('turn: two edits of one file give its net change, not both patches', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = { '/repo/auth.ts': BEFORE }
  on('session.root', async () => ({ value: '/repo' }) as never)
  on('fs.read', async (_$, e) => {
    const text = files[(e as { path: string }).path]
    if (text === undefined) throw new Error('ENOENT: no such file')
    return { value: text } as never
  })
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: 'done' }))
  // The engine applies each edit: the first adds timeLeft with the bug, the second fixes it.
  const edits = [
    { text: AFTER.replace('Math.max(0, 1)', '1'), patch: ['+', '+export function timeLeft() {', '+  return 1', '+}'] },
    { text: AFTER, patch: ['-  return 1', '+  return Math.max(0, 1)'] },
  ]
  let n = 0
  on('tool.call', async () => {
    const step = edits[n++]!
    files['/repo/auth.ts'] = step.text
    return { result: { structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: step.patch }] } } as never
  })
  await $.turn.start({ turnId: 'n', text: 'add timeLeft' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/auth.ts', old_string: 'a', new_string: 'b', tool_use_id: 'n-1' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/auth.ts', old_string: 'a', new_string: 'b', tool_use_id: 'n-2' } as never)
  await $.turn.complete({ turnId: 'n', answer: 'done' } as never)
  const r = await $.command.run({ command: 'tldr', args: 'diff', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  expect(r.text).toContain('--- a/auth.ts')
  expect(r.text).toContain('+  return Math.max(0, 1)')
  expect(r.text).not.toContain('return 1\n')
  expect(r.text).not.toContain('-  return')
  expect(r.text?.match(/^@@/gm)?.length).toBe(1)
})
