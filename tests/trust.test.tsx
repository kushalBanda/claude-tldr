import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Change, TestRun, Turn } from '../types'
import { addsSkipMarker, classify, placePath, rmTargets } from '../hooks/classify'
import { groupSummary } from '../hooks/summary'
import { checkTurn } from '../hooks/trust'
import { startTurn } from '../hooks/turn'
import { CALL_IDS, engine, play } from './fixtures/login-bug'

const change = (path: string, more: Partial<Change> = {}): Change => ({ path, added: 1, removed: 0, viaBash: false, isTest: false, isDelete: false, outsideRoot: false, addsSkip: false, ...more })
const run = (failed: number, isError = failed > 0): TestRun => ({ command: 'pytest', runner: 'pytest', passed: 5, failed, skipped: 0, isError })
const turn = (more: Partial<Turn>): Turn => ({ ...startTurn('t', 'go', 0), ...more })
const kinds = (t: Turn) => checkTurn(t).map(f => f.kind)

test('trust: a test file changed in the turn that made tests pass is flagged', async () => {
  const flags = checkTurn(turn({ changes: [change('src/a.py'), change('tests/conftest.py', { isTest: true })], testRuns: [run(3), run(0)] }))
  expect(flags).toEqual([{ kind: 'tests-edited', detail: 'tests/conftest.py changed in the turn that made tests pass' }])
})

test('trust: a test file changed while tests never failed is not flagged', async () => {
  expect(kinds(turn({ changes: [change('tests/test_a.py', { isTest: true })], testRuns: [run(0)] }))).toEqual([])
})

test('trust: tests still failing at the end are not "made to pass"', async () => {
  expect(kinds(turn({ changes: [change('tests/test_a.py', { isTest: true })], testRuns: [run(0), run(2)] }))).toEqual([])
})

test('trust: a write outside the project is flagged, inside is not', async () => {
  expect(kinds(turn({ changes: [change('/etc/hosts', { outsideRoot: true })] }))).toEqual(['outside-root'])
  expect(kinds(turn({ changes: [change('src/a.py')] }))).toEqual([])
})

test('trust: a deleted file is flagged', async () => {
  expect(checkTurn(turn({ changes: [change('src/old.py', { isDelete: true, viaBash: true })] }))).toEqual([{ kind: 'deleted', detail: 'deleted src/old.py' }])
})

test('trust: an added skip marker is flagged', async () => {
  expect(kinds(turn({ changes: [change('tests/a.test.ts', { isTest: true, addsSkip: true })] }))).toEqual(['skipped-tests'])
})

test('trust: --no-verify and a force push are flagged, a plain push is not', async () => {
  expect(kinds(turn({ log: ['Bash git commit --no-verify -m wip'] }))).toEqual(['bypass'])
  expect(kinds(turn({ log: ['Bash git push --force origin main'] }))).toEqual(['bypass'])
  expect(kinds(turn({ log: ['Bash git push -f'] }))).toEqual(['bypass'])
  expect(kinds(turn({ log: ['Bash git push origin main'] }))).toEqual([])
})

test('skip markers: added ones count, ones already there do not', async () => {
  expect(addsSkipMarker([{ lines: ['+  it.skip("works", () => {'] }])).toBe(true)
  expect(addsSkipMarker([{ lines: ['+@pytest.mark.xfail'] }])).toBe(true)
  expect(addsSkipMarker([{ lines: ['-  it.skip("works", () => {', '+  it.skip("works", () => {'] }])).toBe(false)
  expect(addsSkipMarker([{ lines: ['+  it("works", () => {'] }])).toBe(false)
})

test('paths: relative inside the root, absolute and flagged outside it', async () => {
  expect(placePath('/repo/src/a.py', '/repo')).toEqual({ path: 'src/a.py', outsideRoot: false })
  expect(placePath('/etc/hosts', '/repo')).toEqual({ path: '/etc/hosts', outsideRoot: true })
  expect(placePath('/repo-other/a.py', '/repo')).toEqual({ path: '/repo-other/a.py', outsideRoot: true })
  expect(placePath('src/a.py', undefined)).toEqual({ path: 'src/a.py', outsideRoot: false })
})

test('rm: plain rm and git rm give their targets; flags are skipped', async () => {
  expect(rmTargets('rm -rf build dist')).toEqual(['build', 'dist'])
  expect(rmTargets('git rm src/old.py && git commit -m x')).toEqual(['src/old.py'])
  expect(rmTargets('npm run rm-cache')).toEqual([])
})

test('classify: rm in Bash is a delete', async () => {
  const [c] = classify('Bash', { command: 'rm /repo/src/old.py' }, {}, false, '/repo')
  expect(c).toEqual({ kind: 'change', change: { path: 'src/old.py', added: 0, removed: 0, viaBash: true, isTest: false, isDelete: true, outsideRoot: false, addsSkip: false } })
})

function engineRows(on: On) {
  on('ui.render', { component: 'ToolGroup' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine rows</Text>
  })
  on('ui.render', { component: 'AbovePrompt' }, async () => null as never)
}

test('card: the login-bug turn shows the Check row and an amber border', async ($, on) => {
  engine(on)
  engineRows(on)
  await play($)
  const ui = await $.ui.mount({
    plugin: 'tldr', surface: 'terminal', component: 'ToolGroup', requestId: 'g', viewport: { columns: 120, rows: 40, isFullscreen: true },
    props: { calls: [{ tool_use_id: CALL_IDS[0], tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false }], isActive: false, isExpanded: false },
  })
  const text = JSON.stringify(await ui.drawn())
  expect(text).toContain('"borderColor":"warning"')
  expect(text).toContain('Check')
  expect(text).toContain('⚠ tests/conftest.py changed in the turn that made tests pass')
})

test('summary: a deleted file reads as deleted, not +0 −0', async () => {
  expect(groupSummary([{ tool: 'Bash', input: { command: 'rm src/old.py' }, isRunning: false, isErrored: false }])).toEqual(['deleted src/old.py'])
})
