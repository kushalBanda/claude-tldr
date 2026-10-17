// The state band above the prompt: one line whose color says what is going on, and a short label.
import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { Live } from '../../types'
import { bandFrame, encodeCells } from '../motion'
import type { BandState } from '../motion'
import { color } from './theme'

export const BAND_KEY = 'tldr-band'

export function bandState(l: Live): BandState {
  if (l.phase === 'idle') return 'idle'
  if (l.phase === 'compacting') return 'working'
  return l.last ?? 'working'
}

export function bandLabel(l: Live): string {
  const tail = l.last === 'pass' ? (l.flagged ? 'tests green · check card' : 'tests green') : l.last === 'fail' ? 'tests failing' : ''
  if (l.phase === 'idle') return tail ? `idle · ${tail}` : 'idle'
  if (l.phase === 'compacting') return 'compacting'
  if (tail) return tail
  return l.word ? `working · ${l.word}` : 'working'
}

const LABEL_MAX = 40

export function bandColumns(bodyColumns: number, label: string): number {
  return Math.max(4, bodyColumns - Math.min(label.length, LABEL_MAX) - 1)
}

export function keptNote(count: number): string {
  return `${count} earlier turn${count === 1 ? '' : 's'} kept · /tldr history`
}

export type BandParts = { line: boolean; note: string | null }

export function drawBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, l: Live, ms: number, animate: boolean, rest: RenderElement | null, parts: BandParts = { line: true, note: null }) {
  const { Box, Text, Raster } = $.ui.resolve(e as RenderInput<'AbovePrompt', 'terminal'>)
  const label = bandLabel(l)
  const state = bandState(l)
  const cols = bandColumns(e.props.bodyColumns, label)
  const tone = state === 'fail' ? color.fail : state === 'pass' ? color.pass : state === 'working' ? color.accent : color.dim
  return (
    <Box key="tldr-bands" flexDirection="column">
      {rest}
      {parts.note !== null ? <Text key="tldr-kept-note" color={color.dim} wrap="truncate-end">{parts.note}</Text> : null}
      {parts.line ? (
        <Box key="tldr-band-row" flexDirection="row" columnGap={1}>
          <Raster key={BAND_KEY} columns={cols} rows={1} cells={encodeCells(bandFrame(state, ms, cols, animate))} />
          <Text color={tone} wrap="truncate-end">{label.slice(0, LABEL_MAX)}</Text>
        </Box>
      ) : null}
    </Box>
  )
}
