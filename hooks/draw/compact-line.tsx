// The main screen's one line per tool group: rows printed there cannot change later,
// so each group says what it did in one line and the card follows at the end of the turn.
// A line that ran tests shows the result in green or red, its dot too, so a red run stands out in scrollback.
// Calls a line cannot name (git, gh, an MCP tool) draw nothing: a row of them would read "1 other call" again and again,
// and the card stacks them into one line.
import type { Elements, RenderSurface } from 'claude-code'

import { groupSummary, isQuiet } from '../summary'
import type { GroupCall } from '../summary'
import { color, glyph } from './theme'
import { countParts } from './tint'

export function drawCompactLine(ui: Elements[RenderSurface], calls: readonly GroupCall[], root?: string) {
  const { Box, Text } = ui
  if (calls.every(c => isQuiet(c, root))) return <Box key="tldr-quiet" />
  const parts = groupSummary(calls, root)
  const runs = parts.filter(p => p.ok !== undefined)
  const dot = runs.length === 0 ? color.accent : runs.every(p => p.ok) ? color.pass : color.fail
  return (
    <Text key="tldr-line" wrap="truncate-end">
      <Text color={dot}>{`${glyph.dot} `}</Text>
      <Text color={color.dim}>
        {parts.length === 0 ? 'tool calls' : parts.map((p, i) => [
          i > 0 ? ' · ' : '',
          p.ok !== undefined
            ? <Text color={p.ok ? color.pass : color.fail}>{p.text}</Text>
            : countParts(p.text).map(c => (c.tone === undefined ? c.text : <Text color={c.tone === 'added' ? color.added : color.removed}>{c.text}</Text>)),
        ])}
      </Text>
    </Text>
  )
}
