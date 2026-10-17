// The context pane: each category that fills the window, in its bar color, with its tokens and share.
import type { EngineInterface, RenderInput } from 'claude-code'

import { contextLabel, contextLevel, tokens } from '../context'
import type { ContextFill } from '../context'
import { encodeCells } from '../motion'
import { color } from './theme'

export const CONTEXT_PANE = 'tldr-context'
const SWATCH = 2
const NAME_WIDTH = 22

const swatch = (rgb: number, glyph: number) => encodeCells(Uint32Array.from({ length: SWATCH * 3 }, (_, i) => (i % 3 === 0 ? glyph : i % 3 === 1 ? rgb : 0x01000000)))

export function drawContextPane($: EngineInterface, e: RenderInput<'Pane'>, fill: ContextFill | null) {
  const { Box, Text, Raster } = $.ui.resolve(e as RenderInput<'Pane', 'terminal'>)
  if (fill === null) return <Box key="tldr-context-pane"><Text color={color.dim}>No context figures yet. They come after the first reply.</Text></Box>
  const total = fill.slices.reduce((n, s) => n + s.tokens, 0) || 1
  const level = contextLevel(fill.percent)
  return (
    <Box key="tldr-context-pane" flexDirection="column">
      <Text color={level === 'full' ? color.fail : level === 'warn' ? color.check : color.label}>{contextLabel(fill)}</Text>
      {fill.slices.map(s => (
        <Box flexDirection="row" columnGap={1}>
          <Raster key={`tldr-swatch:${s.name}`} columns={SWATCH} rows={1} cells={swatch(s.rgb, s.kind === 'used' ? 0x2588 : s.kind === 'free' ? 0x2500 : 0x254c)} />
          <Box width={NAME_WIDTH} flexShrink={0}><Text wrap="truncate-end" color={s.kind === 'used' ? color.text : color.dim}>{s.name}</Text></Box>
          <Box width={6} flexShrink={0}><Text color={color.dim}>{tokens(s.tokens).padStart(5)}</Text></Box>
          <Text color={color.dim}>{`${Math.round((s.tokens / total) * 100)}%`}</Text>
        </Box>
      ))}
      {level !== 'ok' ? <Text color={color.dim}>/compact frees the window and keeps a summary. TL;DR keeps the cards.</Text> : null}
    </Box>
  )
}
