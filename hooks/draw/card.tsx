// The turn card: goal, what changed, tests, what Claude looked at.
import type { EngineInterface, RenderChildren, RenderInput, UiPressArgument } from 'claude-code'

import type { TestRun, Turn } from '../../types'
import { shortPath } from '../classify'
import { ranLabel } from '../summary'
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

export function testLabel(r: TestRun): { ok: boolean; text: string } {
  const name = r.runner ?? 'tests'
  if (r.failed !== null && r.failed > 0) return { ok: false, text: `${name} ${glyph.fail} ${r.failed} failed` }
  if (r.passed !== null && !r.isError) return { ok: true, text: `${name} ${glyph.pass} ${r.passed} passed` }
  return r.isError ? { ok: false, text: `${name} ${glyph.fail} failed` } : { ok: true, text: `${name} ${glyph.pass} ran` }
}

export function lookedLabel(t: Turn): string {
  const parts: string[] = []
  if (t.reads.length > 0) parts.push(`${t.reads.length} file${t.reads.length === 1 ? '' : 's'}`)
  if (t.searches.length > 0) parts.push(`${t.searches.length} search${t.searches.length === 1 ? '' : 'es'}`)
  return parts.length > 0 ? parts.join(', ') : 'nothing'
}

export type CardOptions = {
  isExpanded: boolean
  /** How the person expands it here: ctrl+o where rows redraw (fullscreen), /tldr expand on the main screen. */
  expandBy: 'ctrl+o' | '/tldr'
  /** The engine's own measure of the turn, where it gives one (TurnDuration). */
  durationMs?: number
  /** Clock time now, and whether the newest change or test result may flash. */
  now?: number
  pulse?: boolean
  /** The action buttons, where presses reach the mod (fullscreen) and the turn is done. */
  actions?: CardActions
}

export type CardActions = { copy: (p: UiPressArgument) => void; diff: (p: UiPressArgument) => void }

export const PULSE_MS = 900

export function drawCard($: EngineInterface, e: RenderInput<'ToolGroup'> | RenderInput<'ToolUse'> | RenderInput<'TurnDuration'>, t: Turn, o: CardOptions) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const ms = o.durationMs ?? (t.endedAt === null ? null : t.endedAt - t.startedAt)
  const meta = ms === null ? `${clock(t.startedAt)} · running` : `${clock(t.startedAt)} · ${duration(ms)}`
  const isExpanded = o.isExpanded
  const flash = (kind: 'change' | 'test', key: string) =>
    o.pulse === true && o.now !== undefined && t.pulse !== null && t.pulse.kind === kind && t.pulse.key === key && o.now - t.pulse.at < PULSE_MS
  const hint = o.expandBy === 'ctrl+o'
    ? (isExpanded ? `ctrl+o collapse ${glyph.collapse}` : `ctrl+o expand ${glyph.expand}`)
    : '/tldr expand'

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

  const changed =
    t.changes.length === 0 ? (
      <Text color={color.dim}>no files</Text>
    ) : (
      t.changes.map(c => c.isDelete ? (
        <Text color={color.check}>{`${shortPath(c.path)} deleted`}</Text>
      ) : c.viaBash ? (
        <Text bold={flash('change', c.path)}>{`${shortPath(c.path)} `}<Text color={color.dim}>via Bash</Text></Text>
      ) : (
        <Text bold={flash('change', c.path)} backgroundColor={flash('change', c.path) ? (c.isTest ? color.check : color.pass) : undefined}>
          {`${shortPath(c.path)} `}<Text color={color.added}>{`+${c.added}`}</Text>{' '}<Text color={color.removed}>{`${glyph.minus}${c.removed}`}</Text>
        </Text>
      ))
    )

  const tests =
    t.testRuns.length === 0 ? (
      <Text color={color.dim}>not run</Text>
    ) : (
      <Text>
        {t.testRuns.map((r, i) => {
          const l = testLabel(r)
          return (
            <Text>
              {i > 0 ? <Text color={color.dim}>{`  ${glyph.arrow}  `}</Text> : ''}
              <Text color={l.ok ? color.pass : color.fail} bold={flash('test', String(i))}>{l.text}</Text>
            </Text>
          )
        })}
      </Text>
    )

  const looked = (
    <Box flexDirection="row" justifyContent="space-between" flexGrow={1}>
      <Text>{lookedLabel(t)}</Text>
      <Text color={color.dim}>{hint}</Text>
    </Box>
  )

  return (
    <Box key="tldr-card" flexDirection="column" borderStyle="round" borderColor={t.flags.length > 0 ? color.check : color.border} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Text bold wrap="truncate-end">{t.goal}</Text>
        <Text color={color.dim}>{meta}</Text>
      </Box>
      {row('Changed', changed)}
      {row('Tests', tests)}
      {t.flags.length > 0
        ? row(
            'Check',
            <Box flexDirection="column" flexGrow={1}>
              {t.flags.map(fl => (
                <Box flexDirection="column">
                  <Text color={color.check} wrap="truncate-end">{`⚠ ${fl.detail}`}</Text>
                  {isExpanded ? (fl.items ?? []).map(i => <Text color={color.dim} wrap="truncate-end">{`  ${i}`}</Text>) : null}
                </Box>
              ))}
            </Box>,
            color.check,
          )
        : null}
      {(t.ran ?? []).length > 0 ? row('Ran', <Text>{ranLabel(t.ran ?? [])}</Text>) : null}
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
      {o.actions !== undefined && (t.reply !== null || (t.diffs ?? []).length > 0) ? (
        <Box flexDirection="row" justifyContent="flex-end" columnGap={1}>
          {t.reply !== null ? <Button key={`tldr-copy:${t.id}`} label="copy reply" dimColor onPress={o.actions.copy} /> : null}
          {(t.diffs ?? []).length > 0 ? <Button key={`tldr-diff:${t.id}`} label="diff" dimColor onPress={o.actions.diff} /> : null}
        </Box>
      ) : null}
    </Box>
  )
}
