// TL;DR for Claude Code: each turn folds into one card.
// This file only wires hooks; the logic lives in the modules it imports.
import type { EngineInterface, Register, RenderSurface, Timer } from 'claude-code'

import type { Live, Turn } from '../types'

import { addDiff, cleanCopy, diffOf, mergeNet, turnDiff } from './actions'
import { classify, placePath } from './classify'
import { unifiedDiff } from './netdiff'
import { drawCard, PULSE_MS } from './draw/card'
import { BAND_KEY, bandColumns, bandLabel, bandState, drawBand, keptNote } from './draw/band'
import { drawCompactLine } from './draw/compact-line'
import { DIFF_PANE, drawDiff } from './draw/diff'
import { drawHistory, HISTORY_PANE } from './draw/history'
import { drawSpinner, SPINNER_KEY } from './draw/spinner'
import { readFeatures } from './features'
import { bandFrame, encodeCells, spinnerFrame } from './motion'
import type { SpinnerMode } from './motion'
import { allTurns, closeCurrent, latestTurn, loadKept, openTurn, readKept, readLive, saveKept, setKept, setLive, turnForCalls, updateCurrent, updateTurn } from './state'
import { activityWord, logLine, runName } from './summary'
import { checkTurn } from './trust'
import { endTurn, isInterim, recordCall, recordStep, startTurn, toKept } from './turn'

const HELP = 'TL;DR is on. /tldr expand · /tldr collapse (or ctrl+o) · /tldr history · /tldr copy · /tldr diff'

// The frame loop repaints the spinner and the band between renders (module state: a reload restarts it).
const FRAME_MS = 80
let frameMs = 0
let loop: Timer | undefined
let spinnerSite: { requestId: string; mode: SpinnerMode } | null = null
let bandSite: { requestId: string; columns: number; live: Live } | null = null
// The turn the diff pane shows: the card whose diff button was pressed last.
let diffFor: string | null = null
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
    const band = bandSite
    if (band !== null && bandState(band.live) === 'working')
      void $.ui.blit({ requestId: band.requestId, key: BAND_KEY, cells: encodeCells(bandFrame('working', frameMs, band.columns, true)) })
        .then(r => { if (r.deny !== undefined && bandSite === band) bandSite = null })
        .catch(() => {})
  })
}

function endLoop() {
  loop?.cancel()
  loop = undefined
  spinnerSite = null
}

export const register: Register = (on, options) => {
  const f = readFeatures(options)

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command
      .register({ name: 'tldr', description: 'TL;DR for Claude Code: turn cards', argumentHint: '[expand|collapse|history|copy|diff]' })
      .catch(() => {})
    // A resumed session: its earlier cards are on disk, its earlier rows are not on screen.
    if (f.keep) {
      const list = await loadKept($).catch(() => [])
      if (list.length > 0) await setKept($, () => ({ count: list.length, note: true })).catch(() => {})
    }
    return r
  })

  // A turn of the main conversation opens a card; subagents fill their own windows and are left out.
  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      openTurnId = e.turnId
      befores = new Map()
      await openTurn($, startTurn(e.turnId, e.text, await $.clock.now()))
      if (f.keep) await setKept($, k => ({ ...k, note: false })).catch(() => {})
      if (f.motion) {
        await setLive($, () => ({ phase: 'working', word: 'Thinking', last: null, flagged: false })).catch(() => {})
        if (f.animation) startLoop($)
      }
    }
    return r
  })

  // Observe only: the engine's result goes back unchanged.
  on('tool.call', async ($, e, next) => {
    // Link the call to the turn first: the engine draws its group while the call still runs.
    if (e.agentId === undefined) {
      await updateCurrent($, t => recordCall(t, e.tool_use_id, [])).catch(() => {})
      if (f.motion) await setLive($, l => ({ ...l, word: activityWord(e.tool, e), last: null })).catch(() => {})
      const path = editPath(e.tool, e)
      if (f.actions && path !== undefined && !befores.has(path)) {
        // Missing (ENOENT) is a new file, empty before; any other failure leaves the net diff unknown.
        const text = await $.fs.read(path).catch((err: unknown) => (/ENOENT|not found|no such file/i.test(String(err)) ? '' : null))
        befores.set(path, typeof text === 'string' && text.length <= BEFORE_MAX ? text : null)
      }
    }
    const ran = await next(e)
    if (e.agentId !== undefined || ran.deny !== undefined) return ran
    const root = await $.session.root().catch(() => undefined)
    const calls = classify(e.tool, e, ran.result, ran.isError === true, root)
    const line = logLine(e.tool, calls, e)
    const edit = f.actions ? diffOf(e.tool, e, ran.result, ran.isError === true) : null
    const diff = edit === null ? null : { ...edit, path: placePath(edit.path, root).path }
    const now = await $.clock.now()
    await updateCurrent($, t => {
      const called = recordCall(t, e.tool_use_id, calls, line, runName(e.tool, e))
      const recorded = diff === null ? called : { ...called, diffs: addDiff(called.diffs, diff) }
      const done = f.trust ? { ...recorded, flags: checkTurn(recorded) } : recorded
      const c = calls[0]
      if (c?.kind === 'change') return { ...done, pulse: { kind: 'change', key: c.change.path, at: now } }
      if (c?.kind === 'test') return { ...done, pulse: { kind: 'test', key: String(done.testRuns.length - 1), at: now } }
      return done
    }).catch(() => {})
    if (f.trust && f.motion) {
      const t = await latestTurn($)
      const flagged = t !== null && t.endedAt === null && t.flags.length > 0
      await setLive($, l => ({ ...l, flagged })).catch(() => {})
    }
    const test = calls.find(c => c.kind === 'test')
    if (f.motion && test?.kind === 'test') {
      const failed = test.run.isError || (test.run.failed ?? 0) > 0
      await setLive($, l => ({ ...l, last: failed ? 'fail' : 'pass' })).catch(() => {})
    }
    // The flash ends on the next draw after it runs out.
    if (f.motion && f.animation && (calls[0]?.kind === 'change' || test !== undefined)) $.clock.after(PULSE_MS + 50, () => $.ui.invalidate('ui.render'))
    return ran
  }).catch(($, e, next) => next(e)) // a failure here must never stop or change a tool call

  // A finished response: text before a tool call folds into the card; text with no tool call is the reply.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (e.agentId === undefined) {
      await updateTurn($, r.turnId, t => recordStep(t, r.answer, r.toolUses.length > 0)).catch(() => {})
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
      if (f.motion) await setLive($, l => ({ ...l, phase: 'idle', word: '' })).catch(() => {})
      endLoop()
    }
    return r
  })

  on('command.run', { command: 'tldr' }, async ($, e) => {
    const sub = e.args.trim().toLowerCase()
    const isFullscreen = e.presentation.isFullscreen
    if (!f.card) return { text: 'TL;DR: the turn card is off. Turn it on in /plugin, TL;DR options.' }
    if (sub === 'expand') return setExpanded($, true, isFullscreen)
    if (sub === 'collapse') return setExpanded($, false, isFullscreen)
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
    if (e.viewport?.isFullscreen === false) return e.props.isExpanded ? next(e) : drawCompactLine($, e, e.props.calls, await $.session.root().catch(() => undefined))
    const expanded = e.props.isExpanded || found.turn.expanded
    const { Box } = $.ui.resolve(e)
    if (!found.isFirst) return expanded ? next(e) : <Box key="tldr-folded" />
    const t = found.turn
    const actions = f.actions && t.endedAt !== null
      ? { copy: (p: { surface: RenderSurface }) => void copyReply($, t, p.surface, true), diff: () => void openDiff($, t) }
      : undefined
    const card = drawCard($, e, t, { isExpanded: expanded, expandBy: 'ctrl+o', now: await $.clock.now(), pulse: f.motion && f.animation, actions })
    if (!expanded) return card
    const rows = await next(e)
    return (
      <Box key="tldr-expanded" flexDirection="column">
        {card}
        {rows}
      </Box>
    )
  })

  // A call the transcript does not fold into a group (Bash, Edit, Write, ...) is its own row: the same rule as a group.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!f.card || e.surface !== 'terminal') return next(e)
    const found = turnForCalls(await allTurns($), [e.props.tool_use_id])
    if (found === null) return next(e)
    const t = found.turn
    if (e.viewport?.isFullscreen === false) return t.expanded ? next(e) : drawCompactLine($, e, [e.props], await $.session.root().catch(() => undefined))
    const { Box } = $.ui.resolve(e)
    if (!found.isFirst) return t.expanded ? next(e) : <Box key="tldr-folded" />
    const actions = f.actions && t.endedAt !== null
      ? { copy: (p: { surface: RenderSurface }) => void copyReply($, t, p.surface, true), diff: () => void openDiff($, t) }
      : undefined
    // ctrl+o expands groups only; a standalone row opens with /tldr expand.
    const card = drawCard($, e, t, { isExpanded: t.expanded, expandBy: '/tldr', now: await $.clock.now(), pulse: f.motion && f.animation, actions })
    if (!t.expanded) return card
    const row = await next(e)
    return (
      <Box key="tldr-expanded" flexDirection="column">
        {card}
        {row}
      </Box>
    )
  })

  // The result block under a standalone row: folded with its row.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!f.card || e.surface !== 'terminal') return next(e)
    const found = turnForCalls(await allTurns($), [e.props.tool_use_id])
    if (found === null || found.turn.expanded) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box key="tldr-folded-result" />
  })

  // In-between text folds into the card in fullscreen; the main screen keeps what it printed.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!f.card || e.surface !== 'terminal' || e.viewport?.isFullscreen === false) return next(e)
    const list = await allTurns($)
    const owner = list.slice(-50).find(t => isInterim(t, e.props.text))
    if (owner === undefined || owner.expanded) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box key="tldr-folded-text" />
  })

  // The mode-aware spinner, in place of the engine's spinning word.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!f.motion || e.surface !== 'terminal') return next(e)
    const l = await readLive($)
    const t = await latestTurn($)
    const now = await $.clock.now()
    const word = e.props.message ?? (l.phase === 'working' && l.word ? l.word : e.props.word)
    // Any spinner moves, not only a turn's: /compact draws one with no turn open.
    if (f.animation) {
      spinnerSite = { requestId: e.requestId, mode: e.props.mode as SpinnerMode }
      startLoop($)
    }
    return drawSpinner($, e, word, t !== null && t.endedAt === null ? now - t.startedAt : null, frameMs)
  })

  // The state band above the prompt; what other mods draw there stays, above it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.surface !== 'terminal' || e.props.hasSurvey) return rest
    const k = f.keep ? await readKept($) : { count: 0, note: false }
    const note = k.note && k.count > 0 ? keptNote(k.count) : null
    if (!f.motion && note === null) return rest
    const l = await readLive($)
    if (f.motion && f.animation) bandSite = { requestId: e.requestId, columns: bandColumns(e.props.bodyColumns, bandLabel(l)), live: l }
    return drawBand($, e, l, frameMs, f.motion && f.animation, rest ?? null, { line: f.motion, note })
  })

  // After a compaction the earlier rows are gone from the screen; the band points to the kept cards.
  // While it runs, the band and spinner move: a compaction can take a minute. A precompute runs unseen and is left out.
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
    return r
  })

  on('ui.render', { component: 'Pane', requestId: HISTORY_PANE }, async ($, e) => drawHistory($, e, await loadKept($).catch(() => [])))

  on('ui.render', { component: 'Pane', requestId: DIFF_PANE }, async ($, e) => drawDiff($, e, (await allTurns($)).find(t => t.id === diffFor) ?? null))

  // Main screen: the full card takes the place of the turn's closing line ("Baked for 52s").
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (!f.card || e.surface !== 'terminal' || e.viewport?.isFullscreen !== false) return next(e)
    const t = await latestTurn($)
    if (t === null || t.toolUseIds.length === 0) return next(e)
    return drawCard($, e, t, { isExpanded: false, expandBy: '/tldr', durationMs: e.props.durationMs })
  })

}

async function setExpanded($: EngineInterface, expanded: boolean, isFullscreen: boolean) {
  const t = await latestTurn($)
  if (t === null) return { text: 'TL;DR: no turn yet.' }
  // The main screen cannot redraw printed rows, so expand prints the turn's calls instead.
  if (!isFullscreen) {
    if (!expanded) return { text: 'TL;DR: on the main screen, cards stay as printed.' }
    return { text: [`TL;DR · ${t.goal}`, ...t.log.map(l => `⏺ ${l}`)].join('\n') }
  }
  await updateTurn($, t.id, x => ({ ...x, expanded }))
  return { text: expanded ? `TL;DR: expanded "${t.goal}".` : `TL;DR: collapsed "${t.goal}".` }
}

/** The newest turn in this session; after a resume, the newest kept card. */
async function lastTurn($: EngineInterface, keep: boolean): Promise<Turn | null> {
  const t = await latestTurn($)
  if (t !== null || !keep) return t
  return (await loadKept($).catch(() => [])).at(-1) ?? null
}

async function copyText($: EngineInterface, text: string, what: string, surface: RenderSurface | undefined, toast: boolean): Promise<string> {
  const r = await $.ui.copy(surface === undefined ? { text } : { text, surface })
  const said = r.isCopied ? `TL;DR: ${what} copied.` : `TL;DR: could not copy the ${what} (${r.reason}).`
  if (toast) $.ui.toast(said)
  return said
}

async function copyReply($: EngineInterface, t: Turn, surface?: RenderSurface, toast = false): Promise<string> {
  if (t.reply === null) return `TL;DR: "${t.goal}" has no reply to copy.`
  return copyText($, cleanCopy(t.reply), 'reply', surface, toast)
}

async function openDiff($: EngineInterface, t: Turn) {
  diffFor = t.id
  await $.ui.open({ id: DIFF_PANE, title: `TL;DR diff · ${t.goal}` })
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

