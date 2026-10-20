// The /tldr history pane: every kept card of this session, newest first, each with Claude's reply under it.
import type { Elements, RenderSurface } from 'claude-code'

import type { Turn } from '../../types'
import { drawCard } from './card'
import { color, glyph } from './theme'

export const HISTORY_PANE = 'tldr-history'

export function drawHistory(ui: Elements[RenderSurface], list: readonly Turn[]) {
  const { Box, Text } = ui
  if (list.length === 0) {
    return (
      <Box key="tldr-history" flexDirection="column">
        <Text color={color.dim}>No cards kept yet. Each finished turn is kept here, also after /compact.</Text>
      </Box>
    )
  }
  return (
    <Box key="tldr-history" flexDirection="column" rowGap={1}>
      {[...list].reverse().map(t => (
        <Box key={`tldr-kept:${t.id}`} flexDirection="column">
          {drawCard(ui, t, { isExpanded: false })}
          {t.reply !== null ? (
            <Box paddingLeft={glyph.elbow.length}>
              <Text wrap="wrap">{t.reply}</Text>
            </Box>
          ) : null}
        </Box>
      ))}
    </Box>
  )
}
