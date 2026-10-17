// The /tldr history pane: every kept card of this session, newest first, nothing folded.
import type { EngineInterface, RenderInput } from 'claude-code'

import type { Turn } from '../../types'
import { testLabel } from '../summary'
import { duration, lookedLabel } from './card'
import { shortPath } from '../classify'
import { color, glyph } from './theme'

export const HISTORY_PANE = 'tldr-history'

function clock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function drawHistory($: EngineInterface, e: RenderInput<'Pane'>, list: readonly Turn[]) {
  const { Box, Text } = $.ui.resolve(e)
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
        <Box flexDirection="column" borderStyle="round" borderColor={t.flags.length > 0 ? color.check : color.border} paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
            <Text bold wrap="truncate-end">{t.goal}</Text>
            <Text color={color.dim}>{`${clock(t.startedAt)}${t.endedAt !== null ? ` · ${duration(t.endedAt - t.startedAt)}` : ''}`}</Text>
          </Box>
          {t.changes.length > 0 ? (
            <Text wrap="wrap">
              {t.changes.map((c, i) => `${i > 0 ? '   ' : ''}${c.isDelete ? `${shortPath(c.path)} deleted` : c.viaBash ? `${shortPath(c.path)} via Bash` : `${shortPath(c.path)} +${c.added} ${glyph.minus}${c.removed}`}`).join('')}
            </Text>
          ) : null}
          {t.testRuns.length > 0 ? (
            <Text>
              {t.testRuns.map((r, i) => {
                const l = testLabel(r)
                return <Text color={l.ok ? color.pass : color.fail}>{`${i > 0 ? `  ${glyph.arrow}  ` : ''}${l.text}`}</Text>
              })}
            </Text>
          ) : null}
          {t.flags.map(f => (
            <Text color={color.check}>{`⚠ ${f.detail}`}</Text>
          ))}
          <Text color={color.dim}>{`looked at ${lookedLabel(t)}`}</Text>
          {t.reply !== null ? <Text wrap="wrap">{t.reply}</Text> : null}
        </Box>
      ))}
    </Box>
  )
}
