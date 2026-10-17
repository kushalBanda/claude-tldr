// The band above the prompt: the context bar, the kept-cards note after /compact, and on the main screen the rows of the latest card as keys.
import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { Turn } from '../../types'
import { contextCells, contextLabel, contextLevel } from '../context'
import type { ContextFill } from '../context'
import { encodeCells } from '../motion'
import type { Section } from './detail'
import { color } from './theme'

export function keptNote(count: number): string {
  return `${count} earlier turn${count === 1 ? '' : 's'} kept · /tldr history`
}

export type Reveal = { section: Section | 'all'; label: string; hotkey: string }

/**
 * The rows of the latest card as keys on the band, for the main screen: a printed card can't take a press,
 * but the band can. Each row keeps one digit, so the same key always opens the same row.
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

export type BandReveal = { turnId: string; keys: Reveal[]; show: (s: Section | 'all') => void }
export type BandContext = { fill: ContextFill; open: () => void }
export type BandParts = { note: string | null; reveal: BandReveal | null; context: BandContext | null }

export const CONTEXT_KEY = 'tldr-context-bar'
const CONTEXT_HOTKEY = '7'

export function drawBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, rest: RenderElement | null, parts: BandParts) {
  const { Box, Text, Button, Raster } = $.ui.resolve(e as RenderInput<'AbovePrompt', 'terminal'>)
  const reveal = parts.reveal
  const ctx = parts.context
  const label = ctx !== null ? contextLabel(ctx.fill) : ''
  const level = ctx !== null ? contextLevel(ctx.fill.percent) : 'ok'
  // The label and its hotkey take their own cells; the bar takes the rest.
  const barColumns = Math.max(4, e.props.bodyColumns - label.length - 4)
  return (
    <Box key="tldr-bands" flexDirection="column">
      {rest}
      {parts.note !== null ? <Text key="tldr-kept-note" color={color.dim} wrap="truncate-end">{parts.note}</Text> : null}
      {reveal !== null ? (
        <Box key="tldr-reveal" flexDirection="row" columnGap={2}>
          <Text color={color.dim}>TL;DR</Text>
          {reveal.keys.map(k => (
            <Button key={`tldr-reveal:${k.section}:${reveal.turnId}`} label={k.label} hotkey={k.hotkey} plain dimColor onPress={() => reveal.show(k.section)} />
          ))}
        </Box>
      ) : null}
      {ctx !== null ? (
        <Box key="tldr-context-row" flexDirection="row" columnGap={1}>
          <Raster key={CONTEXT_KEY} columns={barColumns} rows={1} cells={encodeCells(contextCells(ctx.fill, barColumns))} />
          <Button key="tldr-context-open" hotkey={CONTEXT_HOTKEY} plain onPress={ctx.open}>
            <Text color={level === 'full' ? color.fail : level === 'warn' ? color.check : color.dim}>{label}</Text>
          </Button>
        </Box>
      ) : null}
    </Box>
  )
}
