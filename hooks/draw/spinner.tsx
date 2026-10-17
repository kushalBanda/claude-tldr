// The mode-aware spinner: a Raster the frame loop repaints, then what Claude does now and the elapsed time.
import type { EngineInterface, RenderInput } from 'claude-code'

import { encodeCells, spinnerFrame, SPINNER_COLUMNS } from '../motion'
import type { SpinnerMode } from '../motion'
import { duration } from './card'
import { color } from './theme'

export const SPINNER_KEY = 'tldr-spin'

export function drawSpinner($: EngineInterface, e: RenderInput<'Spinner'>, word: string, elapsedMs: number | null, ms: number) {
  const { Box, Text, Raster } = $.ui.resolve(e as RenderInput<'Spinner', 'terminal'>)
  const mode = e.props.mode as SpinnerMode
  return (
    <Box key="tldr-spinner" flexDirection="row" columnGap={1}>
      <Raster key={SPINNER_KEY} columns={SPINNER_COLUMNS} rows={1} cells={encodeCells(spinnerFrame(mode, ms))} />
      <Text color={color.accent} wrap="truncate-end">{word}</Text>
      {elapsedMs !== null ? <Text color={color.dim}>{duration(elapsedMs)}</Text> : null}
    </Box>
  )
}
