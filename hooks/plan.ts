// Claude's own task list (TaskCreate and TaskUpdate, or TodoWrite in older builds), kept for the band's stepper. Pure.
import type { Plan, PlanTask } from '../types'

export type { Plan, PlanTask }

export const EMPTY_PLAN: Plan = { tasks: [], turnId: null, done: null }
export const TASK_TOOLS = ['TaskCreate', 'TaskUpdate', 'TodoWrite']

const STATUSES = ['pending', 'in_progress', 'completed'] as const

function statusOf(v: unknown): PlanTask['status'] | null {
  return STATUSES.find(s => s === v) ?? null
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/** The plan after a task tool's call: the same plan when the call is not one, failed, or says nothing usable. */
export function applyTaskCall(plan: Plan, tool: string, input: unknown, result: unknown, turnId: string, now: number): Plan {
  const i = (input ?? {}) as Record<string, unknown>
  if (tool === 'TodoWrite') {
    if (!Array.isArray(i.todos)) return plan
    // TodoWrite sends the whole list each time; a task that newly reads completed is the one just done.
    const tasks: PlanTask[] = i.todos.flatMap((raw: unknown, n): PlanTask[] => {
      const t = (raw ?? {}) as Record<string, unknown>
      const subject = text(t.content)
      const status = statusOf(t.status)
      return subject !== null && status !== null ? [{ id: `todo-${n}`, subject, activeForm: text(t.activeForm), status }] : []
    })
    const justDone = tasks.find(t => t.status === 'completed' && !plan.tasks.some(p => p.subject === t.subject && p.status === 'completed'))
    return { tasks, turnId, done: justDone !== undefined ? { id: justDone.id, at: now } : plan.done }
  }
  if (tool === 'TaskCreate') {
    const id = text((result as { task?: { id?: unknown } } | undefined)?.task?.id)
    const subject = text(i.subject)
    if (id === null || subject === null) return plan
    // A new list in a later turn, after the old one finished: the old tasks are history, not steps of this turn.
    const finished = plan.turnId !== turnId && plan.tasks.every(t => t.status === 'completed')
    const kept = finished ? [] : plan.tasks.filter(t => t.id !== id)
    return { tasks: [...kept, { id, subject, activeForm: text(i.activeForm), status: 'pending' }], turnId, done: finished ? null : plan.done }
  }
  if (tool === 'TaskUpdate') {
    if ((result as { success?: unknown } | undefined)?.success === false) return plan
    const old = plan.tasks.find(t => t.id === text(i.taskId))
    if (old === undefined) return plan
    if (i.status === 'deleted') return { ...plan, tasks: plan.tasks.filter(t => t !== old), turnId }
    const status = statusOf(i.status) ?? old.status
    const next: PlanTask = { ...old, subject: text(i.subject) ?? old.subject, activeForm: text(i.activeForm) ?? old.activeForm, status }
    const done = status === 'completed' && old.status !== 'completed' ? { id: old.id, at: now } : plan.done
    return { tasks: plan.tasks.map(t => (t === old ? next : t)), turnId, done }
  }
  return plan
}

export type PlanView = {
  done: number
  total: number
  rows: PlanTask[] // the window the band shows, in order
  before: number // tasks above the window
  after: number // tasks below it
  current: PlanTask | null
}

export const PLAN_ROWS = 5

/** What the band shows of the plan while `turnId` runs; null when that turn has not touched a list. */
export function planView(plan: Plan, turnId: string, max = PLAN_ROWS): PlanView | null {
  if (plan.turnId !== turnId || plan.tasks.length === 0) return null
  const tasks = plan.tasks
  const done = tasks.filter(t => t.status === 'completed').length
  const current = tasks.find(t => t.status === 'in_progress') ?? null
  // The window keeps one task above the one running (or the first one left), and fills the rest below.
  const focus = current !== null ? tasks.indexOf(current) : Math.max(0, tasks.findIndex(t => t.status !== 'completed'))
  const start = Math.max(0, Math.min(focus - 1, tasks.length - max))
  const rows = tasks.slice(start, start + max)
  return { done, total: tasks.length, rows, before: start, after: tasks.length - start - rows.length, current }
}

/** A row's words: the running task says what it does now, the others name the task. */
export function taskLabel(t: PlanTask): string {
  return t.status === 'in_progress' && t.activeForm !== null ? t.activeForm : t.subject
}
