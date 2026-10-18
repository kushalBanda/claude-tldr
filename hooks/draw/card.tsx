// The turn card: goal, what changed, tests, what Claude looked at.
import type { EngineInterface, RenderChildren, RenderInput, UiPressArgument } from 'claude-code'

import type { Change, Turn } from '../../types'
import { shortPath } from '../classify'
import { changeTotals } from '../steps'
import { ranLabel, testLabel } from '../summary'
import { sectionTitle } from './detail'
import type { Section } from './detail'
import { color, glyph, LABEL_WIDTH } from './theme'

function clock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

export function lookedLabel(t: Turn): string {
  const parts: string[] = []
  if (t.reads.length > 0) parts.push(`${t.reads.length} file${t.reads.length === 1 ? '' : 's'}`)
  if (t.searches.length > 0) parts.push(`${t.searches.length} search${t.searches.length === 1 ? '' : 'es'}`)
  return parts.length > 0 ? parts.join(', ') : 'nothing'
}

export type CardOptions = {
  /** An expanded fullscreen group (a click, ctrl+o): the card adds Claude's notes. */
  isExpanded: boolean
  /** The engine's own measure of the turn, where it gives one (TurnDuration). */
  durationMs?: number
  /** Clock time now, and whether the newest change or test result may flash. */
  now?: number
  pulse?: boolean
  /** The action buttons, where presses reach the mod (fullscreen) and the turn is done. */
  actions?: CardActions
  /** Opens or closes the detail behind a row, where presses reach the mod (fullscreen). The goal opens the steps. Absent: rows are plain text. */
  show?: (s: Section | 'all') => void
  /** The row whose detail is open inside the card, and that detail drawn. */
  open?: { section: Section | 'all'; detail: RenderChildren }
}

export type CardActions = { copy: (p: UiPressArgument) => void; diff: (p: UiPressArgument) => void }

export const PULSE_MS = 900
const NAMES_SHOWN = 3 // file names on the Changed row; the pane lists all

export function drawCard($: EngineInterface, e: RenderInput<'ToolGroup'> | RenderInput<'ToolUse'> | RenderInput<'TurnDuration'>, t: Turn, o: CardOptions) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const ms = o.durationMs ?? (t.endedAt === null ? null : t.endedAt - t.startedAt)
  const meta = ms === null ? `${clock(t.startedAt)} · running` : `${clock(t.startedAt)} · ${duration(ms)}`
  const isExpanded = o.isExpanded
  const flash = (kind: 'change' | 'test', key: string) =>
    o.pulse === true && o.now !== undefined && t.pulse !== null && t.pulse.kind === kind && t.pulse.key === key && o.now - t.pulse.at < PULSE_MS
  // The card is the TL;DR; the detail sits one press away: a click in fullscreen; on the main screen, a digit key on the band or /tldr show.
  const hint = o.open !== undefined ? `click it again to close ${glyph.collapse}` : o.show !== undefined ? `click a row ${glyph.expand}` : 'open a row: type its key at the empty prompt'
  // A row's value as one press target: the whole value opens its detail, nothing about it changes but the cursor.
  const pressable = (s: Section, children: RenderChildren, n = 0) =>
    o.show !== undefined ? (
      <Button key={`tldr-show:${s}:${t.id}:${n}`} plain onPress={() => o.show!(s)}>{children}</Button>
    ) : (
      <Text>{children}</Text>
    )

  const row = (label: string, value: RenderChildren, labelColor: string = color.label) => (
    <Box flexDirection="row">
      <Box width={LABEL_WIDTH} flexShrink={0}>
        <Text color={labelColor}>{label}</Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={3} flexGrow={1}>
        {value}
      </Box>
    </Box>
  )

  // One file reads as itself. Several read as their size first, then the first names; the pane has each one.
  const total = changeTotals(t.changes)
  const name = (c: Change) =>
    c.isDelete ? (
      <Text color={color.check}>{`${shortPath(c.path)} deleted`}</Text>
    ) : (
      <Text bold={flash('change', c.path)} backgroundColor={flash('change', c.path) ? (c.isTest ? color.check : color.pass) : undefined}>{shortPath(c.path)}</Text>
    )
  const counts = (added: number, removed: number) => (
    <Text><Text color={color.added}>{`+${added}`}</Text>{' '}<Text color={color.removed}>{`${glyph.minus}${removed}`}</Text></Text>
  )
  const one = (c: Change) =>
    c.isDelete ? name(c) : <Text>{name(c)}{' '}{c.viaBash ? <Text color={color.dim}>via Bash</Text> : counts(c.added, c.removed)}</Text>
  const changed =
    t.changes.length === 0 ? (
      pressable('changed', <Text color={color.dim}>no files</Text>)
    ) : t.changes.length === 1 ? (
      pressable('changed', one(t.changes[0]!))
    ) : (
      pressable('changed', [
        <Text>{`${total.files} files `}{total.counted ? counts(total.added, total.removed) : <Text color={color.dim}>via Bash</Text>}</Text>,
        '   ',
        ...t.changes.slice(0, NAMES_SHOWN).flatMap((c, i) => [i > 0 ? <Text color={color.dim}>, </Text> : '', name(c)]),
        t.changes.length > NAMES_SHOWN ? <Text color={color.dim}>{` +${t.changes.length - NAMES_SHOWN} more`}</Text> : '',
      ])
    )

  const tests =
    t.testRuns.length === 0 ? (
      pressable('tests', <Text color={color.dim}>not run</Text>)
    ) : (
      pressable('tests',
        t.testRuns.map((r, i) => {
          const l = testLabel(r)
          // One runner names itself once: "go test ✗ 1 failed → ✓ 11 passed".
          const same = i > 0 && t.testRuns[i - 1]!.runner === r.runner
          return (
            <Text>
              {i > 0 ? <Text color={color.dim}>{`  ${glyph.arrow}  `}</Text> : ''}
              <Text color={l.ok ? color.pass : color.fail} bold={flash('test', String(i))}>{same ? l.result : l.text}</Text>
            </Text>
          )
        }),
      )
    )

  const looked = (
    <Box flexDirection="row" justifyContent="space-between" flexGrow={1}>
      {pressable('looked', lookedLabel(t))}
      <Text color={color.dim}>{hint}</Text>
    </Box>
  )

  return (
    <Box key="tldr-card" flexDirection="column" borderStyle="round" borderColor={t.flags.length > 0 ? color.check : color.border} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        {o.show !== undefined ? (
          <Button key={`tldr-show:all:${t.id}`} plain onPress={() => o.show!('all')}><Text bold wrap="truncate-end">{t.goal}</Text></Button>
        ) : (
          <Text bold wrap="truncate-end">{t.goal}</Text>
        )}
        <Text color={color.dim}>{meta}</Text>
      </Box>
      {row('Changed', changed)}
      {row('Tests', tests)}
      {t.flags.length > 0
        ? row(
            'Check',
            <Box flexDirection="column" flexGrow={1}>
              {t.flags.map((fl, i) => pressable('check', <Text color={color.check} wrap="truncate-end">{`⚠ ${fl.detail}`}</Text>, i))}
            </Box>,
            color.check,
          )
        : null}
      {(t.ran ?? []).length > 0 ? row('Ran', pressable('ran', ranLabel(t.ran ?? []))) : null}
      {row('Looked at', looked)}
      {isExpanded && t.interim.length > 0
        ? row(
            'Notes',
            <Box flexDirection="column" flexGrow={1}>
              {t.interim.map(n => (
                <Text color={color.dim}>{n}</Text>
              ))}
            </Box>,
          )
        : null}
      {o.open !== undefined ? (
        <Box key={`tldr-inline:${t.id}`} flexDirection="column" marginTop={1}>
          {o.open.section !== 'all' ? <Text bold>{sectionTitle(o.open.section)}</Text> : null}
          {o.open.detail}
        </Box>
      ) : null}
      {o.actions !== undefined && (t.reply !== null || (t.diffs ?? []).length > 0) ? (
        <Box flexDirection="row" justifyContent="flex-end" columnGap={1}>
          {t.reply !== null ? <Button key={`tldr-copy:${t.id}`} label="copy reply" dimColor onPress={o.actions.copy} /> : null}
          {(t.diffs ?? []).length > 0 ? <Button key={`tldr-diff:${t.id}`} label="diff" dimColor onPress={o.actions.diff} /> : null}
        </Box>
      ) : null}
    </Box>
  )
}
