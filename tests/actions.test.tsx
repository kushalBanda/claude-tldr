import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cleanCopy, diffOf, turnDiff } from '../hooks/actions'
import { readFeatures } from '../hooks/features'
import { startTurn, toKept } from '../hooks/turn'
import type { Turn } from '../types'
import { CALL_IDS, engine, play } from './fixtures/login-bug'

const FULL = { columns: 120, rows: 40, isFullscreen: true }
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }
const call = (id: string) => ({ tool_use_id: id, tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false })
const group = { plugin: 'tldr', surface: 'terminal' as const, component: 'ToolGroup' as const, requestId: 'group-tu-1', viewport: FULL, props: { calls: CALL_IDS.map(call), isActive: false, isExpanded: false } }

function turn(over: Partial<Turn>): Turn {
  return { ...startTurn('t', 'fix the login bug, users get logged out after refresh', 0), ...over }
}

/** The clipboard and the panes, as the engine beneath the plugin answers them. */
function host(on: On) {
  const copied: string[] = []
  const opened: string[] = []
  on('ui.copy', async (_$, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } } as never
  })
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  return { copied, opened }
}

test('actions: cleanCopy removes shared indentation, trailing spaces, CRs and extra blank lines', async () => {
  expect(cleanCopy('  Fixed.   \r\n\r\n\r\n\r\n    - one\r\n  - two  ')).toBe('Fixed.\n\n  - one\n- two')
})

test('actions: diffOf takes the engine patch, or a new file as added lines', async () => {
  const patch = { structuredPatch: [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ['-a', '+b'] }] }
  expect(diffOf('Edit', { file_path: 'x.py' }, patch, false)).toEqual({ path: 'x.py', lines: ['@@ -3,1 +3,1 @@', '-a', '+b'] })
  expect(diffOf('Write', { file_path: 'n.md', content: 'one\ntwo\n' }, {}, false)).toEqual({ path: 'n.md', lines: ['@@ -0,0 +1,2 @@', '+one', '+two'] })
  expect(diffOf('Edit', { file_path: 'x.py' }, patch, true)).toBeNull()
  expect(diffOf('Read', { file_path: 'x.py' }, {}, false)).toBeNull()
})

test('actions: turnDiff shows each file with its - and + lines', async () => {
  const text = turnDiff(turn({ diffs: [{ path: 'x.py', lines: ['@@ -1,1 +1,1 @@', '-a', '+b'] }] }))
  expect(text).toBe(['--- a/x.py', '+++ b/x.py', '@@ -1,1 +1,1 @@', '-a', '+b'].join('\n'))
  expect(turnDiff(turn({}))).toBe('')
})

test('features: card off turns trust, keep and actions off', async () => {
  expect(readFeatures({ card: false })).toMatchObject({ trust: false, keep: false, actions: false })
  expect(readFeatures({ actions: false }).actions).toBe(false)
  expect(readFeatures({}).actions).toBe(true)
})

test('turn: toKept drops the diff lines', async () => {
  expect(toKept(turn({ diffs: [{ path: 'x', lines: ['+a'] }] })).diffs).toEqual([])
})

test('command: /tldr copy writes the clean reply to the clipboard', async ($, on) => {
  engine(on)
  const h = host(on)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '  Done.  \r\n  All good.', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  await $.turn.start({ turnId: 'r', text: 'explain' } as never)
  await $.tool.call({ tool: 'Read', file_path: 'a.py', tool_use_id: 'r-1' } as never)
  const s = $.turn.step({ turnId: 'r', index: 1, model: 'm', messageCount: 1 } as never)
  for await (const _ of s) void _
  await s.result
  const r = await $.command.run({ command: 'tldr', args: 'copy', ...RUN })
  expect(h.copied).toEqual(['Done.\nAll good.'])
  expect(r.text).toBe('TL;DR: reply copied.')
})

test('command: /tldr diff shows the turn edits', async ($, on) => {
  engine(on)
  host(on)
  await play($)
  const r = await $.command.run({ command: 'tldr', args: 'diff', ...RUN })
  for (const s of ['--- a/src/auth.py', '+++ b/src/auth.py', '@@ -1,3 +1,12 @@', '-old', '+new', '+++ b/tests/conftest.py']) expect(r.text).toContain(s)
})
