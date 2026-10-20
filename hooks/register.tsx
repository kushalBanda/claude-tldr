// TL;DR for Claude Code: each turn folds into one card.
// This file wires hooks and holds every function that takes $; the logic lives in the modules it imports.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput, Timer } from 'claude-code'

import type { Kept, Live, Plan, Turn } from '../types'

import { addDiff, cleanCopy, diffOf, mergeNet, turnDiff } from './actions'
import { classify, placePath } from './classify'
import { unifiedDiff } from './netdiff'
import { drawCard } from './draw/card'
import { drawBand, keptNote, PLAN_BAR_KEY, PLAN_ROW_KEY, revealKeys } from './draw/band'
import { CONTEXT_PANE, drawContextPane } from './draw/context'
import { contextFill } from './context'
import { doneText, jumpParts, nextJump, runLine } from './progress'
import type { ContextFill } from './context'
import { drawCompactLine } from './draw/compact-line'
import { DETAIL_PANE, drawDetail, paneRows, paneTitle, sectionOf } from './draw/detail'
import type { Section } from './draw/detail'
import { drawHistory, HISTORY_PANE } from './draw/history'
import { drawSpinner, SPINNER_KEY } from './draw/spinner'
import { glyph } from './draw/theme'
import { commandKey, duration, durationsKey, isDurations, remember, REMEMBER_MS } from './durations'
import type { Durations } from './durations'
import { readFeatures } from './features'
import { encodeCells, fitsCells, planBarFrame, PULSE_MS, shimmerRowFrame, spinnerFrame } from './motion'
import { applyTaskCall, EMPTY_PLAN, planView, TASK_TOOLS, taskLabel } from './plan'
import type { SpinnerMode } from './motion'
import { isTurnList, KEPT_MAX, keptKey, MAX_TURNS, turnForCalls, turnForDuration } from './state'
import { activityWord, isMeta, logLines, runName } from './summary'
import { verdictOf } from './steps'
import { checkTurn } from './trust'
import { endTurn, isInterim, isReply, recordCall, recordStep, startTurn, toKept } from './turn'

const HELP = 'TL;DR is on. Click a line of the TL;DR row for its detail, or type its digit at the empty prompt, or /tldr show [changed|tests|check|ran|looked] · /tldr context · /tldr history · /tldr copy · /tldr diff'

// The frame loop repaints the spinner between renders (module state: a reload restarts it).
const FRAME_MS = 80
let frameMs = 0
let loop: Timer | undefined
let spinnerSite: { requestId: string; mode: SpinnerMode } | null = null
// The band's stepper as last drawn, for the loop to repaint its bar and running row; doneFrame is when the last task was done.
let planSite: { requestId: string; done: number; total: number; barColumns: number; row: string | null; rowColumns: number } | null = null
let doneFrame = -Infinity
// The band's clock: once a second while a turn runs, so the running step's time and the ring move between calls.
const TICK_MS = 1000
let tick: Timer | undefined
// A finished turn at least this long sends a notification and leaves its verdict on the status line.
const LONG_TURN_MS = 30_000
let statusShown = false
// What the detail pane shows: the turn and the row pressed last (or /tldr show).
let detailFor: { turnId: string; section: Section | 'all' } | null = null
// Fullscreen: the row whose detail is open inside its card. One at a time; the same press closes it.
let inlineFor: { turnId: string; section: Section | 'all' } | null = null
// The context window by category, as the band's bar draws it: measured after each request (a local estimate).
let contextNow: ContextFill | null = null
let measuring = false
// Each edited file's text before the open turn's first edit of it, for the turn's net diff (null: too large).
let openTurnId: string | null = null
let befores = new Map<string, string | null>()
const BEFORE_MAX = 256 * 1024
const EDIT_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']

function startLoop($: EngineInterface) {
  if (loop !== undefined) return
  loop = $.clock.every(FRAME_MS, () => {
    frameMs += FRAME_MS
    const spin = spinnerSite
    if (spin !== null)
      void $.ui.blit({ requestId: spin.requestId, key: SPINNER_KEY, cells: encodeCells(spinnerFrame(spin.mode, frameMs)) })
        .then(r => { if (r.deny !== undefined && spinnerSite === spin) spinnerSite = null })
        .catch(() => {})
    const p = planSite
    if (p !== null) {
      void $.ui.blit({ requestId: p.requestId, key: PLAN_BAR_KEY, cells: encodeCells(planBarFrame(p.done, p.total, frameMs - doneFrame, frameMs, p.barColumns)) })
        .then(r => { if (r.deny !== undefined && planSite === p) planSite = null })
        .catch(() => {})
      if (p.row !== null) void $.ui.blit({ requestId: p.requestId, key: PLAN_ROW_KEY, cells: encodeCells(shimmerRowFrame(p.row, frameMs, p.rowColumns)) }).catch(() => {})
    }
  })
}

function endLoop() {
  loop?.cancel()
  loop = undefined
  spinnerSite = null
  planSite = null
}

export const register: Register = (on, options) => {
  const f = readFeatures(options)

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command
      .register({ name: 'tldr', description: 'TL;DR for Claude Code: turn cards', argumentHint: '[show|context|history|copy|diff]' })
      .catch(() => {})
    if (f.context) await measureContext($)
    // A resumed session: its earlier cards are on disk. They also stand in for the turns, so rows redrawn after a restart find their card.
    if (f.keep) {
      const list = await loadKept($).catch(() => [])
      if (list.length > 0) {
        await seedTurns($, list).catch(() => {})
        await setKept($, () => ({ count: list.length, note: true })).catch(() => {})
      }
    }
    return r
  })

  // A turn of the main conversation opens a card; subagents fill their own windows and are left out.
  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      openTurnId = e.turnId
      befores = new Map()
      const now = await $.clock.now()
      await openTurn($, startTurn(e.turnId, e.text, now))
      if (f.keep) await setKept($, k => ({ ...k, note: false })).catch(() => {})
      // The last long turn's verdict stays on the status line until the next prompt.
      if (statusShown) {
        $.ui.status(undefined)
        statusShown = false
      }
      if (f.motion) {
        await setLive($, () => ({ phase: 'working', word: 'Thinking', running: null, since: now })).catch(() => {})
        if (f.animation) {
          startLoop($)
          tick ??= $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
        }
      }
    }
    return r
  })

  // Observe only: the engine's result goes back unchanged.
  on('tool.call', async ($, e, next) => {
    // Link the call to the turn first: the engine draws its group while the call still runs.
    const startedAt = await $.clock.now()
    const command = e.tool === 'Bash' ? commandKey(String((e as { command?: unknown }).command ?? '')) : null
    if (e.agentId === undefined) {
      await updateCurrent($, t => recordCall(t, e.tool_use_id, [])).catch(() => {})
      if (f.motion) {
        // The band's TL;DR line names the new job, and a command it has timed before gets a ring against last time.
        const lastMs = command !== null ? (await loadDurations($))[command] ?? null : null
        const running = { id: e.tool_use_id, label: activityWord(e.tool, e), startedAt, isCommand: command !== null, lastMs }
        await setLive($, l => ({ ...l, word: running.label, running })).catch(() => {})
        $.ui.invalidate('ui.render')
      }
      const path = editPath(e.tool, e)
      if (f.actions && path !== undefined && !befores.has(path)) {
        // Missing (ENOENT) is a new file, empty before; any other failure leaves the net diff unknown.
        const text = await $.fs.read(path).catch((err: unknown) => (/ENOENT|not found|no such file/i.test(String(err)) ? '' : null))
        befores.set(path, typeof text === 'string' && text.length <= BEFORE_MAX ? text : null)
      }
    }
    const ran = await next(e).finally(async () => {
      if (e.agentId !== undefined || !f.motion) return
      const endedAt = await $.clock.now()
      await setLive($, l => (l.running?.id === e.tool_use_id ? { ...l, word: 'Thinking', running: null, since: endedAt } : l)).catch(() => {})
    })
    if (e.agentId !== undefined || ran.deny !== undefined) return ran
    // How long this command took, for the ring next time it runs.
    if (command !== null && command !== '' && f.motion) {
      const ms = (await $.clock.now()) - startedAt
      if (ms >= REMEMBER_MS) await saveDuration($, command, ms).catch(() => {})
    }
    // Claude's own task list feeds the band's stepper.
    if (f.card && f.motion && TASK_TOOLS.includes(e.tool) && ran.isError !== true && openTurnId !== null) {
      const before = await readPlan($)
      const after = applyTaskCall(before, e.tool, e, ran.result, openTurnId, await $.clock.now())
      if (after !== before) {
        await setPlan($, () => after).catch(() => {})
        if (after.done !== before.done) {
          doneFrame = frameMs
          // The done task's highlight ends on the next draw after it runs out.
          $.clock.after(PULSE_MS + 50, () => $.ui.invalidate('ui.render'))
        }
        $.ui.invalidate('ui.render')
      }
    }
    const root = await $.session.root().catch(() => undefined)
    const calls = classify(e.tool, e, ran.result, ran.isError === true, root)
    const meta = isMeta(e.tool)
    const lines = meta ? [] : logLines(e.tool, calls, e)
    const edit = f.actions ? diffOf(e.tool, e, ran.result, ran.isError === true) : null
    const diff = edit === null ? null : { ...edit, path: placePath(edit.path, root).path }
    const now = await $.clock.now()
    await updateCurrent($, t => {
      const called = recordCall(t, e.tool_use_id, calls, lines, meta ? undefined : runName(e.tool, e))
      const recorded = diff === null ? called : { ...called, diffs: addDiff(called.diffs, diff) }
      const done = f.trust ? { ...recorded, flags: checkTurn(recorded) } : recorded
      // A test result or a new flag is the band's "last" until the next one.
      return { ...done, jump: nextJump(t, done, now) ?? t.jump }
    }).catch(() => {})
    // The band's TL;DR line counts the finished call.
    if (f.motion) $.ui.invalidate('ui.render')
    return ran
  }).catch((_$, e, next) => next(e)) // a failure here must never stop or change a tool call

  // A finished response: text before a tool call folds into the card; text with no tool call is the reply.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (e.agentId === undefined) {
      await updateTurn($, r.turnId, t => recordStep(t, r.answer, r.toolUses.length > 0)).catch(() => {})
      if (f.context) void measureContext($)
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      const net = f.actions && openTurnId === e.turnId ? await netDiffs($) : []
      await closeCurrent($, t => endTurn({ ...t, diffs: mergeNet(t.diffs, net) }, now)).catch(() => {})
      openTurnId = null
      befores = new Map()
      if (f.keep) {
        const t = await latestTurn($)
        if (t !== null && (t.toolUseIds.length > 0 || t.reply !== null)) {
          const count = await saveKept($, toKept(t)).catch(() => null)
          if (count !== null) await setKept($, k => ({ ...k, count })).catch(() => {})
        }
      }
      if (f.motion) await setLive($, () => ({ phase: 'idle', word: '', running: null, since: now })).catch(() => {})
      endLoop()
      tick?.cancel()
      tick = undefined
      if (f.notify) await tellDone($, now)
    }
    return r
  })

  on('command.run', { command: 'tldr' }, async ($, e) => {
    const sub = e.args.trim().toLowerCase()
    if (sub === 'context') {
      if (!f.context) return { text: 'TL;DR: the context bar is off. Turn it on in /plugin, TL;DR options.' }
      await openContext($)
      return { text: contextNow === null ? 'TL;DR: no context figures yet.' : `TL;DR: context opened, ${contextNow.percent}% used. Escape closes it.` }
    }
    if (!f.card) return { text: 'TL;DR: the turn card is off. Turn it on in /plugin, TL;DR options.' }
    // One card, one detail: `show` opens what sits behind a row. `expand` is kept as a word for it.
    const [verb = '', arg = ''] = sub.split(/\s+/)
    if (verb === 'show' || verb === 'expand') {
      const section = sectionOf(arg)
      if (section === null) return { text: `TL;DR: no row "${arg}". Rows: changed, tests, check, ran, looked.` }
      const t = await lastTurn($, f.keep)
      if (t === null) return { text: 'TL;DR: no turn yet.' }
      await showDetail($, t, section)
      const what = section === 'all' ? `the whole turn "${t.goal}"` : paneTitle(t, section).replace(/^TL;DR · /, '')
      return { text: `TL;DR: ${what} opened. Escape closes it.` }
    }
    if (verb === 'collapse' || verb === 'hide') {
      await $.ui.close({ id: DETAIL_PANE }).catch(() => {})
      return { text: 'TL;DR: detail closed.' }
    }
    if (sub === 'history' && !f.keep) return { text: 'TL;DR: keeping cards is off. Turn it on in /plugin, TL;DR options.' }
    if (sub === 'history') {
      const n = (await loadKept($).catch(() => [])).length
      await $.ui.open({ id: HISTORY_PANE, title: 'TL;DR history' })
      return { text: `TL;DR: history opened, ${n} card${n === 1 ? '' : 's'} kept.` }
    }
    if (f.actions && (sub === 'copy' || sub === 'diff')) {
      const t = await lastTurn($, f.keep)
      if (t === null) return { text: 'TL;DR: no turn yet.' }
      if (sub === 'copy') return { text: await copyReply($, t) }
      const diff = turnDiff(t)
      return { text: diff === '' ? `TL;DR: no edits kept for "${t.goal}".` : diff }
    }
    return { text: HELP }
  })

  // The card takes the place of the turn's tool rows: the turn's first group draws it, later groups draw nothing.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!f.card || e.surface !== 'terminal') return next(e)
    const ids = e.props.calls.map(c => c.tool_use_id).filter((id): id is string => id !== undefined)
    const found = turnForCalls(await allTurns($), ids)
    if (found === null) return next(e)
    // Main screen: printed rows cannot change, so each group is one line; the card follows at turn end.
    if (e.viewport?.isFullscreen === false) return e.props.isExpanded ? next(e) : drawCompactLine($.ui.resolve(e), e.props.calls, await $.session.root().catch(() => undefined))
    // A click on the group expands it, and its rows are ToolUse rows that would draw the card again: the card stays the one view.
    const { Box } = $.ui.resolve(e)
    if (!found.isFirst) return <Box key="tldr-folded" />
    const t = found.turn
    return drawCard($.ui.resolve(e), t, { isExpanded: e.props.isExpanded, show: sec => toggleInline($, t, sec), open: inlineOpen($, e, t) })
  })

  // A call the transcript does not fold into a group (Bash, Edit, Write, ...) is its own row: the same rule as a group.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!f.card || e.surface !== 'terminal') return next(e)
    const found = turnForCalls(await allTurns($), [e.props.tool_use_id])
    if (found === null) return next(e)
    const t = found.turn
    if (e.viewport?.isFullscreen === false) return drawCompactLine($.ui.resolve(e), [e.props], await $.session.root().catch(() => undefined))
    const { Box } = $.ui.resolve(e)
    if (!found.isFirst) return <Box key="tldr-folded" />
    // A standalone row has no ctrl+o of its own: the card stands for it, and a press opens the detail.
    return drawCard($.ui.resolve(e), t, { isExpanded: false, show: sec => toggleInline($, t, sec), open: inlineOpen($, e, t) })
  })

  // The result block under a standalone row: folded with its row.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!f.card || e.surface !== 'terminal') return next(e)
    const found = turnForCalls(await allTurns($), [e.props.tool_use_id])
    if (found === null) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box key="tldr-folded-result" />
  })

  // In-between text folds into the card in fullscreen; the main screen keeps what it printed.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!f.card || e.surface !== 'terminal' || e.viewport?.isFullscreen === false) return next(e)
    // A block that is also some turn's reply is ambiguous (a later answer can repeat earlier in-between text): it stays.
    const recent = (await allTurns($)).slice(-50)
    if (!recent.some(t => isInterim(t, e.props.text)) || recent.some(t => isReply(t, e.props.text))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box key="tldr-folded-text" />
  })

  // The mode-aware spinner, in place of the engine's spinning word.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!f.motion || e.surface !== 'terminal') return next(e)
    const l = await readLive($)
    const t = await latestTurn($)
    const now = await $.clock.now()
    const word = e.props.message ?? (l.phase !== 'idle' && l.word ? l.word : e.props.word)
    // Any spinner moves, not only a turn's: /compact draws one with no turn open.
    if (f.animation) {
      spinnerSite = { requestId: e.requestId, mode: e.props.mode as SpinnerMode }
      startLoop($)
    }
    return drawSpinner($.ui.resolve(e as RenderInput<'Spinner', 'terminal'>), e, word, t !== null && t.endedAt === null ? now - t.startedAt : null, frameMs)
  })

  // The band above the prompt: the kept-cards note and the row keys; what other mods draw there stays, above it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.surface !== 'terminal' || e.props.hasSurvey) return rest
    const k = f.keep ? await readKept($) : { count: 0, note: false }
    const note = k.note && k.count > 0 ? keptNote(k.count) : null
    // On the main screen the printed card can't take a press, so its rows sit on the band as digit keys; a key opens its row's detail on the band.
    const t = f.card && e.viewport?.isFullscreen === false && !e.props.isWorking ? await lastTurn($, f.keep) : null
    const reveal = t !== null && t.endedAt !== null
      ? { turnId: t.id, verdict: verdictOf(t), keys: revealKeys(t), show: (s: Section | 'all') => toggleInline($, t, s), open: inlineFor?.turnId === t.id ? { section: inlineFor.section, detail: drawDetail($.ui.resolve(e), t, inlineFor.section) } : null }
      : null
    const context = f.context && contextNow !== null ? { fill: contextNow, open: () => void openContext($) } : null
    // While a turn runs: what runs now against last time, and the last thing that happened. The tick redraws it each second.
    const open = f.card && f.motion && e.props.isWorking ? await latestTurn($) : null
    const running = open !== null && open.endedAt === null
    const now = running ? await $.clock.now() : 0
    const l = running ? await readLive($) : null
    const run = l !== null ? runLine({ word: l.word, running: l.running, since: l.since, now, turn: open! }) : null
    const plan = running ? await planParts($, e.requestId, open!.id, e.props.bodyColumns, f.animation) : null
    if (plan === null && planSite?.requestId === e.requestId) planSite = null
    if (note === null && reveal === null && context === null && run === null) return rest
    return drawBand($.ui.resolve(e as RenderInput<'AbovePrompt', 'terminal'>), e, rest ?? null, { note, reveal, context, run, plan, last: running ? jumpParts(open!.jump, now) : [] })
  })

  // After a compaction the earlier rows are gone from the screen; the band points to the kept cards.
  // While it runs, the spinner moves and says so: a compaction can take a minute. A precompute runs unseen and is left out.
  on('session.compact', async ($, e, next) => {
    const shown = f.motion && e.agentId === undefined && e.trigger !== 'precompute'
    if (shown) {
      await setLive($, l => ({ ...l, phase: 'compacting', word: 'Compacting' })).catch(() => {})
      if (f.animation) startLoop($)
    }
    const r = await next(e).finally(async () => {
      if (!shown) return
      // An automatic compaction can fall inside a turn: the turn goes on working.
      const inTurn = openTurnId !== null
      await setLive($, l => ({ ...l, phase: inTurn ? 'working' : 'idle', word: inTurn ? 'Thinking' : '' })).catch(() => {})
      if (!inTurn) endLoop()
    })
    if (f.keep && e.agentId === undefined && 'messages' in r) await setKept($, k => ({ ...k, note: k.count > 0 })).catch(() => {})
    if (f.context && e.agentId === undefined) await measureContext($)
    return r
  })

  on('ui.render', { component: 'Pane', requestId: CONTEXT_PANE }, async ($, e) => drawContextPane($.ui.resolve(e as RenderInput<'Pane', 'terminal'>), contextNow))
  on('ui.render', { component: 'Pane', requestId: HISTORY_PANE }, async ($, e) => drawHistory($.ui.resolve(e), await loadKept($).catch(() => [])))

  on('ui.render', { component: 'Pane', requestId: DETAIL_PANE }, async ($, e) => {
    const all = [...(await allTurns($)), ...(f.keep ? await loadKept($).catch(() => []) : [])]
    return drawDetail($.ui.resolve(e), detailFor === null ? null : all.find(t => t.id === detailFor!.turnId) ?? null, detailFor?.section ?? 'all')
  })

  // Main screen: the full card takes the place of the turn's closing line ("Baked for 52s").
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (!f.card || e.surface !== 'terminal' || e.viewport?.isFullscreen !== false) return next(e)
    const t = await durationTurn($, e.requestId, e.props.durationMs)
    if (t === null) return next(e)
    return drawCard($.ui.resolve(e), t, { isExpanded: false, durationMs: e.props.durationMs })
  })

  // Main screen: the line under the prompt says the latest card's rows open by digit, while the prompt is empty and Claude idle.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (!f.card || e.surface !== 'terminal' || e.viewport?.isFullscreen !== false || e.props.isDraft || e.props.isWorking) return next(e)
    const t = await lastTurn($, f.keep)
    if (t === null || t.endedAt === null) return next(e)
    const keys = revealKeys(t)
    const range = keys.length === 1 ? keys[0]!.hotkey : `${keys[0]!.hotkey}–${keys.at(-1)!.hotkey}`
    return next({ ...e, props: { ...e.props, tail: ` · type ${range} to open the last card` } })
  })

}

/** The stepper's first frame, and the site the frame loop repaints; null when the open turn has no task list. */
async function planParts($: EngineInterface, requestId: string, turnId: string, bodyColumns: number, animation: boolean) {
  const plan = await readPlan($)
  const view = planView(plan, turnId)
  if (view === null) return null
  // With animation off nothing repaints: the bar holds still and the running task is plain text.
  const moving = animation && loop !== undefined
  const barColumns = Math.max(10, Math.min(24, Math.floor(bodyColumns / 5)))
  const label = view.current !== null ? taskLabel(view.current) : null
  const row = moving && label !== null && fitsCells(label) ? label : null
  const rowColumns = row === null ? 0 : Math.max(1, Math.min(bodyColumns, [...row].length + 4))
  planSite = moving ? { requestId, done: view.done, total: view.total, barColumns, row, rowColumns } : null
  const now = await $.clock.now()
  return {
    view,
    barCells: encodeCells(planBarFrame(view.done, view.total, frameMs - doneFrame, frameMs, barColumns, moving)),
    barColumns,
    rowCells: row === null ? null : encodeCells(shimmerRowFrame(row, frameMs, rowColumns, moving)),
    rowColumns,
    justDone: plan.done !== null && now - plan.done.at < PULSE_MS ? plan.done.id : null,
  }
}

/** The newest turn in this session; after a resume, the newest kept card. */
async function lastTurn($: EngineInterface, keep: boolean): Promise<Turn | null> {
  const t = await latestTurn($)
  if (t !== null || !keep) return t
  return (await loadKept($).catch(() => [])).at(-1) ?? null
}

async function copyReply($: EngineInterface, t: Turn): Promise<string> {
  if (t.reply === null) return `TL;DR: "${t.goal}" has no reply to copy.`
  const r = await $.ui.copy({ text: cleanCopy(t.reply) })
  return r.isCopied ? 'TL;DR: reply copied.' : `TL;DR: could not copy the reply (${r.reason}).`
}

/** A long turn that just ended: a notification with its verdict, and the same on the status line until the next prompt. */
async function tellDone($: EngineInterface, now: number) {
  const t = await latestTurn($)
  if (t === null || t.toolUseIds.length === 0 || now - t.startedAt < LONG_TURN_MS) return
  const v = verdictOf(t)
  const mark = v === 'pass' || v === 'fail' || v === 'check' ? ` ${glyph[v]}` : ''
  $.ui.status(`TL;DR${mark} done ${duration(now - t.startedAt)}`)
  statusShown = true
  await $.ui.notify(doneText(t, now - t.startedAt), { title: 'TL;DR' }).catch(() => {})
}

/** Opens the detail pane behind a card row: small, holding the keys, closed by Escape. */
async function showDetail($: EngineInterface, t: Turn, section: Section | 'all') {
  detailFor = { turnId: t.id, section }
  await $.ui.open({ id: DETAIL_PANE, title: paneTitle(t, section), focus: true, closeOnEscape: true, rows: paneRows(t, section) })
  $.ui.invalidate('ui.render')
}

/** A press opens a row's detail where it was pressed (inside the fullscreen card, on the main screen's band), and the same press closes it. */
function toggleInline($: EngineInterface, t: Turn, section: Section | 'all') {
  inlineFor = inlineFor?.turnId === t.id && inlineFor.section === section ? null : { turnId: t.id, section }
  $.ui.invalidate('ui.render')
}

function inlineOpen($: EngineInterface, e: RenderInput<'ToolGroup'> | RenderInput<'ToolUse'>, t: Turn) {
  if (inlineFor?.turnId !== t.id) return undefined
  return { section: inlineFor.section, detail: drawDetail($.ui.resolve(e), t, inlineFor.section) }
}

/** The context window by category, as /context counts it but estimated locally, so it costs no request. */
async function measureContext($: EngineInterface) {
  if (measuring) return
  measuring = true
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    const b = u.context.breakdown
    if (b !== undefined && b.rawMaxTokens > 0) {
      contextNow = contextFill(b)
      $.ui.invalidate('ui.render')
    }
  } catch {
    // No figures: the bar keeps its last ones.
  } finally {
    measuring = false
  }
}

async function openContext($: EngineInterface) {
  await measureContext($)
  await $.ui.open({ id: CONTEXT_PANE, title: 'TL;DR context', focus: true, closeOnEscape: true, rows: (contextNow?.slices.length ?? 1) + (contextNow?.setup.length ?? 0) + 3 })
}

function editPath(tool: string, input: unknown): string | undefined {
  if (!EDIT_TOOLS.includes(tool)) return undefined
  const i = input as { file_path?: unknown; notebook_path?: unknown }
  return typeof i.file_path === 'string' ? i.file_path : typeof i.notebook_path === 'string' ? i.notebook_path : undefined
}

/** The open turn's edited files as net diffs: their text now against their text before the turn's first edit. */
async function netDiffs($: EngineInterface): Promise<{ path: string; lines: string[] | null }[]> {
  const root = await $.session.root().catch(() => undefined)
  const out: { path: string; lines: string[] | null }[] = []
  for (const [abs, before] of befores) {
    const path = placePath(abs, root).path
    if (before === null) {
      out.push({ path, lines: null })
      continue
    }
    const after = await $.fs.read(abs).catch(() => null)
    out.push({ path, lines: typeof after === 'string' ? unifiedDiff(before, after) : null })
  }
  return out
}

// State: TL;DR's atoms, and every read and write of them and of the kept cards.

const turns = atom({ plugin: 'tldr', key: 'turns' } as const, [] as Turn[])
const IDLE: Live = { phase: 'idle', word: '', running: null, since: 0 }
const live = atom({ plugin: 'tldr', key: 'live' } as const, IDLE)
const kept = atom({ plugin: 'tldr', key: 'kept' } as const, { count: 0, note: false } as Kept)
const current = atom({ plugin: 'tldr', key: 'current' } as const, null as string | null)
const planAtom = atom({ plugin: 'tldr', key: 'plan' } as const, EMPTY_PLAN as Plan)

async function readPlan($: EngineInterface): Promise<Plan> {
  return read($, planAtom)
}

async function setPlan($: EngineInterface, fn: (p: Plan) => Plan): Promise<void> {
  await update($, planAtom, p => fn(p ?? EMPTY_PLAN))
}

async function openTurn($: EngineInterface, t: Turn): Promise<void> {
  // A turn that never completed (interrupted) ends where the next one starts, so its card stops saying "running".
  await update($, turns, list => [...(list ?? []).filter(x => x.id !== t.id).map(x => (x.endedAt === null ? { ...x, endedAt: t.startedAt } : x)), t].slice(-MAX_TURNS))
  await update($, current, () => t.id)
}

async function updateCurrent($: EngineInterface, fn: (t: Turn) => Turn): Promise<void> {
  const id = await read($, current)
  if (id === null) return
  await update($, turns, list => (list ?? []).map(t => (t.id === id ? fn(t) : t)))
}

async function updateTurn($: EngineInterface, id: string, fn: (t: Turn) => Turn): Promise<void> {
  await update($, turns, list => (list ?? []).map(t => (t.id === id ? fn(t) : t)))
}

async function closeCurrent($: EngineInterface, fn: (t: Turn) => Turn): Promise<void> {
  await updateCurrent($, fn)
  await update($, current, () => null)
}

// Drawing is pure, so the pins live in the module, like the spinner's site. A hot reload starts them over.
const durationPins = new Map<string, string>()

async function durationTurn($: EngineInterface, site: string, durationMs: number): Promise<Turn | null> {
  const t = turnForDuration(await read($, turns), durationPins, site, durationMs, await $.clock.now())
  if (t !== null) durationPins.set(site, t.id)
  return t
}

async function latestTurn($: EngineInterface): Promise<Turn | null> {
  const list = await read($, turns)
  return list.at(-1) ?? null
}

async function allTurns($: EngineInterface): Promise<Turn[]> {
  return read($, turns)
}

async function readLive($: EngineInterface): Promise<Live> {
  return read($, live)
}

async function setLive($: EngineInterface, fn: (l: Live) => Live): Promise<void> {
  await update($, live, l => fn(l ?? IDLE))
}

async function loadDurations($: EngineInterface): Promise<Durations> {
  const v = await $.store.get(durationsKey(await $.session.root().catch(() => undefined))).catch(() => undefined)
  return isDurations(v) ? v : {}
}

async function saveDuration($: EngineInterface, command: string, ms: number): Promise<void> {
  const key = durationsKey(await $.session.root().catch(() => undefined))
  await $.store.set(key, remember(await loadDurations($), command, ms))
}

async function loadKept($: EngineInterface): Promise<Turn[]> {
  const v = await $.store.get(keptKey(await $.session.id()))
  return isTurnList(v) ? v : []
}

async function saveKept($: EngineInterface, t: Turn): Promise<number> {
  const list = (await loadKept($)).filter(x => x.id !== t.id)
  const next = [...list, t].slice(-KEPT_MAX)
  await $.store.set(keptKey(await $.session.id()), next)
  return next.length
}

/** A restarted session (a resume, a /tui switch) starts with no turns in memory: the kept cards stand in, so its old rows draw cards again. */
async function seedTurns($: EngineInterface, list: readonly Turn[]): Promise<void> {
  await update($, turns, now => ((now ?? []).length > 0 ? now ?? [] : list.slice(-MAX_TURNS)))
}

async function readKept($: EngineInterface): Promise<Kept> {
  return read($, kept)
}

async function setKept($: EngineInterface, fn: (k: Kept) => Kept): Promise<void> {
  await update($, kept, k => fn(k ?? { count: 0, note: false }))
}
