// The stepper: Claude's own task list on the band while the turn runs, the bar filling as tasks are done.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { easeOutCubic, FILL_MS, fitsCells, planBarFrame, shimmerRowFrame } from '../hooks/motion'
import { applyTaskCall, EMPTY_PLAN, planView, taskLabel } from '../hooks/plan'
import type { Plan } from '../hooks/plan'

const T = 'turn-plan'

function plan(...subjects: string[]): Plan {
  return subjects.reduce((p, s, i) => applyTaskCall(p, 'TaskCreate', { subject: s, activeForm: `Doing ${s}` }, { task: { id: String(i + 1), subject: s } }, T, 0), EMPTY_PLAN)
}
const update = (p: Plan, taskId: string, status: string, at = 10) => applyTaskCall(p, 'TaskUpdate', { taskId, status }, { success: true, taskId }, T, at)

test('TaskCreate adds pending tasks; TaskUpdate moves them and marks the one just done', async () => {
  let p = plan('Read the auth flow', 'Fix token expiry', 'Run pytest')
  expect(p.tasks.map(t => t.status)).toEqual(['pending', 'pending', 'pending'])
  p = update(p, '1', 'in_progress')
  p = update(p, '1', 'completed', 42)
  expect(p.done).toEqual({ id: '1', at: 42 })
  p = update(p, '2', 'in_progress')
  const v = planView(p, T)!
  expect([v.done, v.total, v.current?.subject]).toEqual([1, 3, 'Fix token expiry'])
  expect(taskLabel(v.current!)).toBe('Doing Fix token expiry')
  expect(update(p, '3', 'deleted').tasks.length).toBe(2)
})

test('a failed update, an unknown id or another tool leaves the plan as it was', async () => {
  const p = plan('A', 'B')
  expect(applyTaskCall(p, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: false }, T, 1)).toBe(p)
  expect(update(p, '9', 'completed')).toBe(p)
  expect(applyTaskCall(p, 'Bash', { command: 'ls' }, {}, T, 1)).toBe(p)
  expect(applyTaskCall(p, 'TaskCreate', { subject: 'C' }, {}, T, 1)).toBe(p)
})

test('TodoWrite replaces the list, and the task that newly reads completed is the one done', async () => {
  const todo = (statuses: string[]) => ({ todos: ['Read', 'Fix', 'Test'].map((content, i) => ({ content, status: statuses[i], activeForm: `${content}ing` })) })
  let p = applyTaskCall(EMPTY_PLAN, 'TodoWrite', todo(['in_progress', 'pending', 'pending']), {}, T, 0)
  expect(p.done).toBe(null)
  p = applyTaskCall(p, 'TodoWrite', todo(['completed', 'in_progress', 'pending']), {}, T, 5)
  expect(p.done).toEqual({ id: 'todo-0', at: 5 })
  expect(taskLabel(planView(p, T)!.current!)).toBe('Fixing')
})

test('a new list in a later turn starts over once the old one is finished; an open one carries on', async () => {
  const finished = update(plan('A'), '1', 'completed')
  const next = applyTaskCall(finished, 'TaskCreate', { subject: 'B' }, { task: { id: '2' } }, 'turn-2', 1)
  expect(next.tasks.map(t => t.subject)).toEqual(['B'])
  const open = applyTaskCall(plan('A'), 'TaskCreate', { subject: 'B' }, { task: { id: '2' } }, 'turn-2', 1)
  expect(open.tasks.map(t => t.subject)).toEqual(['A', 'B'])
})

test('view: shown only while the turn that touched the list runs; a long list windows around the running task', async () => {
  let p = plan('1', '2', '3', '4', '5', '6', '7', '8')
  expect(planView(p, 'other-turn')).toBe(null)
  for (const id of ['1', '2', '3', '4']) p = update(p, id, 'completed')
  p = update(p, '5', 'in_progress')
  const v = planView(p, T, 5)!
  expect(v.rows.map(t => t.subject)).toEqual(['4', '5', '6', '7', '8'])
  expect([v.before, v.after]).toEqual([3, 0])
  expect(planView(plan('1', '2', '3', '4', '5', '6', '7'), T, 5)!.after).toBe(2)
})

test('bar: fills by tasks done, grows from the count before, and holds still with motion off', async () => {
  const filled = (cells: Uint32Array) => Array.from({ length: cells.length / 3 }, (_, i) => cells[i * 3]).filter(c => c === 0x2588).length
  expect(filled(planBarFrame(2, 4, Infinity, 0, 20))).toBe(10)
  expect(filled(planBarFrame(2, 4, 0, 0, 20))).toBe(5)
  expect(filled(planBarFrame(2, 4, FILL_MS / 2, 0, 20))).toBeGreaterThan(5)
  expect(filled(planBarFrame(4, 4, Infinity, 0, 20))).toBe(20)
  expect(Array.from(planBarFrame(2, 4, 0, 0, 20, false)).join()).toBe(Array.from(planBarFrame(2, 4, Infinity, 900, 20, false)).join())
  expect(easeOutCubic(0)).toBe(0)
  expect(easeOutCubic(1)).toBe(1)
})

test('running row: a turning mark and the words, cut with an ellipsis; the light moves over time', async () => {
  const chars = (cells: Uint32Array) => Array.from({ length: cells.length / 3 }, (_, i) => String.fromCodePoint(cells[i * 3]!)).join('')
  expect(chars(shimmerRowFrame('Running pytest', 0, 18))).toBe('  ◐ Running pytest')
  expect(chars(shimmerRowFrame('Running pytest', 0, 10))).toBe('  ◐ Runni…')
  expect(Array.from(shimmerRowFrame('Running pytest', 0, 18)).join()).not.toBe(Array.from(shimmerRowFrame('Running pytest', 700, 18)).join())
  expect(fitsCells('Fix token expiry → retry')).toBe(true)
  expect(fitsCells('修复登录')).toBe(false)
})

// A stand-in for Claude Code beneath the plugin: TaskCreate answers with an id, as the real tool does.
function engine(on: On) {
  mock.clock(on)
  let next = 0
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: 'done' }))
  on('tool.call', async (_$, e) => {
    if (e.tool === 'TaskCreate') return { result: { task: { id: String(++next), subject: (e as { subject: string }).subject } } } as never
    if (e.tool === 'TaskUpdate') return { result: { success: true, taskId: (e as { taskId: string }).taskId, updatedFields: ['status'] } } as never
    return { result: { ok: true } } as never
  })
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => $.ui.resolve(e).Box({ key: 'engine' } as never) as never)
}

const band = (isWorking: boolean) => ({
  plugin: 'tldr', surface: 'terminal' as const, component: 'AbovePrompt' as const, requestId: `band-plan-${isWorking}`,
  viewport: { columns: 120, rows: 40, isFullscreen: true }, props: { bodyColumns: 110, hasSurvey: false, isWorking, maxRows: 12 } as never,
})

async function playPlan($: Engine) {
  await $.turn.start({ turnId: T, text: 'fix the login bug' } as never)
  const call = (tool: string, input: Record<string, unknown>, id: string) => $.tool.call({ tool, ...input, tool_use_id: id } as never)
  await call('TaskCreate', { subject: 'Read the auth flow', description: '', activeForm: 'Reading the auth flow' }, 'p1')
  await call('TaskCreate', { subject: 'Fix token expiry', description: '', activeForm: 'Fixing token expiry' }, 'p2')
  await call('TaskCreate', { subject: 'Run pytest', description: '', activeForm: 'Running pytest' }, 'p3')
  await call('TaskUpdate', { taskId: '1', status: 'completed' }, 'p4')
  await call('TaskUpdate', { taskId: '2', status: 'in_progress' }, 'p5')
}

test('band: the stepper shows the count, the done, running and pending tasks; it goes when the turn ends', async ($, on) => {
  engine(on)
  await playPlan($)
  const text = JSON.stringify(await (await $.ui.mount(band(true))).drawn())
  for (const s of ['1/3 tasks', 'Read the auth flow', '○ Run pytest', 'tldr-plan-bar', 'tldr-plan-now']) expect(text).toContain(s)
  await $.turn.complete({ turnId: T, answer: 'done' } as never)
  expect(JSON.stringify(await (await $.ui.mount(band(false))).drawn())).not.toContain('tasks')
})

test('animation off: the running task is plain text, no moving row', { options: { animation: false } }, async ($, on) => {
  engine(on)
  await playPlan($)
  const text = JSON.stringify(await (await $.ui.mount(band(true))).drawn())
  expect(text).toContain('◐ Fixing token expiry')
  expect(text).not.toContain('tldr-plan-now')
})

test('motion off: no stepper', { options: { motion: false } }, async ($, on) => {
  engine(on)
  await playPlan($)
  expect(JSON.stringify(await (await $.ui.mount(band(true))).drawn())).not.toContain('tasks')
})
