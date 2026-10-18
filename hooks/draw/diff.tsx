// The diff pane: one turn's edits, opened from the card's diff button.
import type { Elements, RenderInput, RenderSurface } from 'claude-code'

import type { Turn } from '../../types'
import { turnDiff } from '../actions'
import { color } from './theme'

export const DIFF_PANE = 'tldr-diff'

function lineColor(l: string): string | undefined {
  if (l.startsWith('+++') || l.startsWith('---')) return undefined
  if (l.startsWith('+')) return color.added
  if (l.startsWith('-')) return color.removed
  if (l.startsWith('@@') || l.startsWith('…')) return color.dim
  return undefined
}

export function drawDiff(ui: Elements[RenderSurface], e: RenderInput<'Pane'>, t: Turn | null) {
  const { Box, Text } = ui
  const text = t === null ? '' : turnDiff(t)
  if (text === '') {
    return (
      <Box key="tldr-diff" flexDirection="column">
        <Text color={color.dim}>No edits to show for this turn.</Text>
      </Box>
    )
  }
  return (
    <Box key="tldr-diff" flexDirection="column">
      <Text bold>{t!.goal}</Text>
      {text.split('\n').map(l => (
        <Text color={lineColor(l)} bold={l.startsWith('+++') || l.startsWith('---')} wrap="truncate-end">
          {l === '' ? ' ' : l}
        </Text>
      ))}
    </Box>
  )
}
