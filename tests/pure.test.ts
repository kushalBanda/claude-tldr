import { expect, test } from 'claude-code/testing'
import { countParts } from '../hooks/draw/tint'

import { classify, isTestPath, patchDelta } from '../hooks/classify'
import { detectRunner, parseResult } from '../hooks/tests-parse'
import { goalOf, recordCall, startTurn } from '../hooks/turn'

test('classify: Read gives a read with its path', async () => {
  expect(classify('Read', { file_path: 'src/auth.py' }, {}, false)).toEqual([{ kind: 'read', path: 'src/auth.py' }])
})

test('classify: Edit counts added and removed lines from the structured patch', async () => {
  const result = { structuredPatch: [{ lines: [' a', '-b', '-c', '+d', '+e', '+f', ' g'] }] }
  const [c] = classify('Edit', { file_path: 'src/x.ts' }, result, false)
  expect(c).toEqual({ kind: 'change', change: { path: 'src/x.ts', added: 3, removed: 2, viaBash: false, isTest: false, isDelete: false, outsideRoot: false, addsSkip: false } })
})

test('classify: Write of a new file with no patch counts every line as added', async () => {
  const [c] = classify('Write', { file_path: 'notes.md', content: 'one\ntwo\nthree\n' }, {}, false)
  expect(c).toEqual({ kind: 'change', change: { path: 'notes.md', added: 3, removed: 0, viaBash: false, isTest: false, isDelete: false, outsideRoot: false, addsSkip: false } })
})

test('classify: a failed Edit records no change', async () => {
  expect(classify('Edit', { file_path: 'a.ts' }, undefined, true)).toEqual([{ kind: 'other', tool: 'Edit' }])
})

test('classify: pytest in Bash is a test run with its counts', async () => {
  const [c] = classify('Bash', { command: 'pytest -q' }, { stdout: '3 failed, 9 passed in 1.84s', stderr: '' }, true)
  expect(c).toEqual({ kind: 'test', run: { command: 'pytest -q', runner: 'pytest', passed: 9, failed: 3, skipped: 0, isError: true } })
})

test('classify: cat in Bash counts as a read, rg as a search', async () => {
  expect(classify('Bash', { command: 'cat src/a.py' }, {}, false)).toEqual([{ kind: 'read', path: 'src/a.py' }])
  expect(classify('Bash', { command: 'rg decode src' }, {}, false)).toEqual([{ kind: 'search', pattern: 'rg decode src' }])
})

test('classify: test paths are recognized', async () => {
  for (const p of ['tests/test_auth.py', 'src/a.test.ts', 'pkg/x_test.go', 'conftest.py', '__tests__/b.js']) expect(isTestPath(p)).toBe(true)
  for (const p of ['src/auth.py', 'src/testing.ts', 'latest.md']) expect(isTestPath(p)).toBe(false)
})

test('patchDelta ignores context lines', async () => {
  expect(patchDelta([{ lines: [' x', '+y'] }, { lines: ['-z'] }])).toEqual({ added: 1, removed: 1 })
})

test('tests-parse: pytest commands are detected, others are not', async () => {
  expect(detectRunner('pytest tests/ -q')).toBe('pytest')
  expect(detectRunner('python -m pytest')).toBe('pytest')
  expect(detectRunner('ls tests')).toBeNull()
})

test('tests-parse: pytest summary lines', async () => {
  expect(parseResult('pytest', 'x\n=== 3 failed, 9 passed in 1.84s ===')).toEqual({ passed: 9, failed: 3, skipped: 0 })
  expect(parseResult('pytest', '12 passed, 2 skipped in 0.5s')).toEqual({ passed: 12, failed: 0, skipped: 2 })
  expect(parseResult('pytest', 'no summary here')).toEqual({ passed: null, failed: null, skipped: null })
})

test('turn: the goal is the first line of the prompt, cut at 72 characters', async () => {
  expect(goalOf('\n  fix the bug\nmore detail')).toBe('fix the bug')
  expect(goalOf('')).toBe('untitled turn')
  expect(goalOf('x'.repeat(100)).length).toBe(72)
})

test('turn: edits to one file add up into one change', async () => {
  let t = startTurn('t1', 'go', 0)
  t = recordCall(t, 'a', [{ kind: 'change', change: { path: 'f.ts', added: 2, removed: 1, viaBash: false, isTest: false, isDelete: false, outsideRoot: false, addsSkip: false } }])
  t = recordCall(t, 'b', [{ kind: 'change', change: { path: 'f.ts', added: 3, removed: 0, viaBash: false, isTest: false, isDelete: false, outsideRoot: false, addsSkip: false } }])
  expect(t.changes).toEqual([{ path: 'f.ts', added: 5, removed: 1, viaBash: false, isTest: false, isDelete: false, outsideRoot: false, addsSkip: false }])
  expect(t.toolUseIds).toEqual(['a', 'b'])
})

test('countParts: +N and −N words take the added and removed tones; flags and hyphens stay plain', async () => {
  expect(countParts('src/auth.py +12 −3')).toEqual([{ text: 'src/auth.py ' }, { text: '+12', tone: 'added' }, { text: ' ' }, { text: '−3', tone: 'removed' }])
  expect(countParts('go test -v ./pkg a+1')).toEqual([{ text: 'go test -v ./pkg a+1' }])
  expect(countParts('+4 −0')).toEqual([{ text: '+4', tone: 'added' }, { text: ' ' }, { text: '−0', tone: 'removed' }])
})
