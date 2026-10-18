// The band above the prompt: the TL;DR line while a turn runs, the context bar, the kept-cards note after /compact, and on the main screen the rows of the latest card as keys, with the open row's detail under them.
import type { Elements, RenderElement, RenderInput } from 'claude-code'

import type { Turn } from '../../types'
import { contextCells, contextLevel, hex, sliceTokens, tokens } from '../context'
import type { ContextFill } from '../context'
import { conversationRgb, SETUP_RGB } from '../context'
import { encodeCells } from '../motion'
import type { ProgressPart } from '../progress'
import { countParts } from './tint'
import { sectionTitle } from './detail'
import type { Section } from './detail'
import { color, glyph } from './theme'

export function keptNote(count: number): string {
  return `${count} earlier turn${count === 1 ? '' : 's'} kept · /tldr history`
}

export type Reveal = { section: Section | 'all'; label: string; hotkey: string }

/**
 * The rows of the latest card as keys on the band, for the main screen: a printed card can't take a press,
 * but the band can. Each row keeps one digit, so the same key always opens the same row, and pressed again closes it.
 */
export function revealKeys(t: Turn): Reveal[] {
  const out: Reveal[] = [{ section: 'all', label: 'steps', hotkey: '1' }]
  if (t.changes.length > 0) out.push({ section: 'changed', label: 'changed', hotkey: '2' })
  if (t.testRuns.length > 0) out.push({ section: 'tests', label: 'tests', hotkey: '3' })
  if (t.flags.length > 0) out.push({ section: 'check', label: 'check', hotkey: '4' })
  if ((t.ranLog?.length ?? 0) > 0) out.push({ section: 'ran', label: 'ran', hotkey: '5' })
  if (t.reads.length + t.searches.length > 0) out.push({ section: 'looked', label: 'looked at', hotkey: '6' })
  return out
}

export type BandReveal = { turnId: string; keys: Reveal[]; show: (s: Section | 'all') => void; open: { section: Section | 'all'; detail: RenderElement } | null }
export type BandContext = { fill: ContextFill; open: () => void }
export type BandParts = { note: string | null; reveal: BandReveal | null; context: BandContext | null; progress: ProgressPart[] | null }

export const CONTEXT_KEY = 'tldr-context-bar'

export function drawBand(ui: Elements['terminal'], e: RenderInput<'AbovePrompt'>, rest: RenderElement | null, parts: BandParts) {
  const { Box, Text, Button, Raster } = ui
  const reveal = parts.reveal
  const ctx = parts.context
  // The label names each color in that color, so the bar reads without a legend: "62% full · conversation 94k · setup 30k".
  const level = ctx !== null ? contextLevel(ctx.fill.percent) : 'ok'
  const head = ctx !== null ? `${ctx.fill.percent}% full${level === 'full' ? ' · /compact' : ''}` : ''
  const conv = ctx !== null ? `conversation ${tokens(sliceTokens(ctx.fill, 'conversation'))}` : ''
  const setup = ctx !== null ? `setup ${tokens(sliceTokens(ctx.fill, 'setup'))}` : ''
  const wide = e.props.bodyColumns >= 72
  const labelLength = head.length + (wide ? conv.length + setup.length + 6 : 0)
  // The label takes its own cells, one more for the gap; the bar takes the rest.
  const barColumns = Math.max(4, e.props.bodyColumns - labelLength - 1)
  return (
    <Box key="tldr-bands" flexDirection="column">
      {rest}
      {parts.note !== null ? <Text key="tldr-kept-note" color={color.dim} wrap="truncate-end">{parts.note}</Text> : null}
      {parts.progress !== null && parts.progress.length > 0 ? (
        <Text key="tldr-progress" wrap="truncate-end">
          <Text bold>{'TL;DR  '}</Text>
          {parts.progress.map((p, i) => (
            <Text color={color.dim}>
              {i > 0 ? ' · ' : ''}
              {p.key === 'tests' ? <Text color={p.ok ? color.pass : color.fail}>{p.text}</Text>
                : p.key === 'files' ? countParts(p.text).map(c => (c.tone === undefined ? c.text : <Text color={c.tone === 'added' ? color.added : color.removed}>{c.text}</Text>))
                : p.text}
            </Text>
          ))}
        </Text>
      ) : null}
      {reveal !== null ? (
        <Box key="tldr-reveal" flexDirection="row" columnGap={2}>
          <Text color={color.dim}>TL;DR open</Text>
          {reveal.keys.map(k => (
            <Button key={`tldr-reveal:${k.section}:${reveal.turnId}`} label={k.label} hotkey={k.hotkey} plain dimColor={reveal.open?.section !== k.section} onPress={() => reveal.show(k.section)} />
          ))}
          {reveal.open !== null ? <Text color={color.dim}>{`press it again to close ${glyph.collapse}`}</Text> : null}
        </Box>
      ) : null}
      {reveal?.open ? (
        <Box key={`tldr-inline:${reveal.turnId}`} flexDirection="column" marginBottom={1}>
          {reveal.open.section !== 'all' ? <Text bold>{sectionTitle(reveal.open.section)}</Text> : null}
          {reveal.open.detail}
        </Box>
      ) : null}
      {ctx !== null ? (
        <Box key="tldr-context-row" flexDirection="row" columnGap={1}>
          <Raster key={CONTEXT_KEY} columns={barColumns} rows={1} cells={encodeCells(contextCells(ctx.fill, barColumns))} />
          <Button key="tldr-context-open" plain onPress={ctx.open}>
            <Text color={level === 'full' ? color.fail : level === 'warn' ? color.check : color.text}>{head}</Text>
            {wide ? <Text color={color.dim}>{' · '}</Text> : null}
            {wide ? <Text color={hex(conversationRgb(ctx.fill.percent))}>{conv}</Text> : null}
            {wide ? <Text color={color.dim}>{' · '}</Text> : null}
            {wide ? <Text color={hex(SETUP_RGB)}>{setup}</Text> : null}
          </Button>
        </Box>
      ) : null}
    </Box>
  )
}
