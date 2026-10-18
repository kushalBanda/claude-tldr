// The context pane: the bar's three parts with their tokens and share, what each one means, and the setup rows.
import type { Elements, RenderInput } from 'claude-code'

import { contextLevel, tokens } from '../context'
import type { ContextFill, SliceKind } from '../context'
import { encodeCells } from '../motion'
import { color } from './theme'

export const CONTEXT_PANE = 'tldr-context'
const SWATCH = 3
const NAME_WIDTH = 26

const GLYPH: Record<SliceKind, number> = { conversation: 0x2588, setup: 0x2588, free: 0x2500, buffer: 0x254c }
const MEANS: Record<SliceKind, string> = {
  conversation: '/compact frees this',
  setup: 'loaded on every request',
  free: 'room left',
  buffer: 'kept back so auto-compact can run',
}

const swatch = (rgb: number, glyph: number) => encodeCells(Uint32Array.from({ length: SWATCH * 3 }, (_, i) => (i % 3 === 0 ? glyph : i % 3 === 1 ? rgb : 0x01000000)))

export function drawContextPane(ui: Elements['terminal'], e: RenderInput<'Pane'>, fill: ContextFill | null) {
  const { Box, Text, Raster } = ui
  if (fill === null) return <Box key="tldr-context-pane"><Text color={color.dim}>No context figures yet. They come after the first reply.</Text></Box>
  const total = fill.slices.reduce((n, s) => n + s.tokens, 0) || 1
  const level = contextLevel(fill.percent)
  const share = (n: number) => `${Math.round((n / total) * 100)}%`.padStart(4)
  return (
    <Box key="tldr-context-pane" flexDirection="column">
      <Text color={level === 'full' ? color.fail : level === 'warn' ? color.check : color.text}>{`${fill.percent}% full · ${tokens(fill.used)} of ${tokens(fill.window)}`}</Text>
      {fill.slices.map(s => (
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={1}>
            <Raster key={`tldr-swatch:${s.kind}`} columns={SWATCH} rows={1} cells={swatch(s.rgb, GLYPH[s.kind])} />
            <Box width={NAME_WIDTH} flexShrink={0}><Text wrap="truncate-end" color={s.kind === 'free' || s.kind === 'buffer' ? color.dim : color.text}>{s.name}</Text></Box>
            <Box width={5} flexShrink={0}><Text color={color.dim}>{tokens(s.tokens).padStart(5)}</Text></Box>
            <Box width={5} flexShrink={0}><Text color={color.dim}>{share(s.tokens)}</Text></Box>
            <Text color={color.dim} wrap="truncate-end">{MEANS[s.kind]}</Text>
          </Box>
          {s.kind === 'setup'
            ? fill.setup.map(r => (
                <Box flexDirection="row" columnGap={1}>
                  <Box width={SWATCH} flexShrink={0} />
                  <Box width={NAME_WIDTH} flexShrink={0}><Text color={color.dim} wrap="truncate-end">{`  ${r.name}`}</Text></Box>
                  <Text color={color.dim}>{tokens(r.tokens).padStart(5)}</Text>
                </Box>
              ))
            : null}
        </Box>
      ))}
      {level !== 'ok' ? <Text color={color.dim}>/compact shrinks the conversation to a summary. TL;DR keeps the cards.</Text> : null}
    </Box>
  )
}
