// The main screen's one line per tool group: rows printed there cannot change later,
// so each group says what it did in one line and the full card follows at the end of the turn.
// Calls a line cannot name (git, gh, an MCP tool) draw nothing: a row of them would read "1 other call" again and again,
// and the card's Ran row stacks them into one line.
import type { Elements, RenderInput, RenderSurface } from 'claude-code'

import { groupSummary, isQuiet } from '../summary'
import type { GroupCall } from '../summary'
import { color } from './theme'
import { countParts } from './tint'

export function drawCompactLine(ui: Elements[RenderSurface], e: RenderInput<'ToolGroup'> | RenderInput<'ToolUse'>, calls: readonly GroupCall[], root?: string) {
  const { Box, Text } = ui
  if (calls.every(c => isQuiet(c, root))) return <Box key="tldr-quiet" />
  const parts = groupSummary(calls, root)
  return (
    <Text key="tldr-line" wrap="truncate-end">
      <Text color={color.accent}>{'⏺ '}</Text>
      <Text color={color.dim}>
        {countParts(parts.length > 0 ? parts.join(' · ') : 'tool calls').map(p => (p.tone === undefined ? p.text : <Text color={p.tone === 'added' ? color.added : color.removed}>{p.text}</Text>))}
      </Text>
    </Text>
  )
}
