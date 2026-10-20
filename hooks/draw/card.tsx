// The turn card, as one of Claude Code's own rows: "⏺ TL;DR <goal> · 52s", then under ⎿ what changed and how the
// tests went, one line per thing to check. The dot's color is the verdict. No box, no labels.
import type { Elements, RenderChildren, RenderSurface } from 'claude-code'

import type { Change, Turn } from '../../types'
import { shortPath } from '../classify'
import { duration } from '../durations'
import { byFolder, changeTotals, verdictOf } from '../steps'
import { ranLabel, testLabel } from '../summary'
import { sectionTitle } from './detail'
import type { Section } from './detail'
import { color, glyph, verdictColor } from './theme'

export function lookedLabel(t: Turn): string {
  const parts: string[] = []
  if (t.reads.length > 0) parts.push(`${t.reads.length} file${t.reads.length === 1 ? '' : 's'}`)
  if (t.searches.length > 0) parts.push(`${t.searches.length} search${t.searches.length === 1 ? '' : 'es'}`)
  return parts.length > 0 ? parts.join(', ') : 'nothing'
}

export type CardOptions = {
  /** An expanded fullscreen group (a click, ctrl+o): the card adds Claude's notes. */
  isExpanded: boolean
  /** The engine's own measure of the turn, where it gives one (TurnDuration). */
  durationMs?: number
  /** Opens or closes the detail behind a line, where presses reach the mod (fullscreen). The goal opens the steps. Absent: lines are plain text. */
  show?: (s: Section | 'all') => void
  /** The line whose detail is open inside the card, and that detail drawn. */
  open?: { section: Section | 'all'; detail: RenderChildren }
}

const FOLDERS_SHOWN = 3 // more read as "+N folders"

const dirName = (dir: string) => (dir === '' ? './' : dir.replace(/\/$/, ''))

export function drawCard(ui: Elements[RenderSurface], t: Turn, o: CardOptions) {
  const { Box, Button, Text } = ui
  const ms = o.durationMs ?? (t.endedAt === null ? null : t.endedAt - t.startedAt)
  const pressable = (s: Section | 'all', children: RenderChildren, n = 0) =>
    o.show !== undefined ? (
      <Button key={`tldr-show:${s}:${t.id}:${n}`} plain onPress={() => o.show!(s)}>{children}</Button>
    ) : (
      <Text>{children}</Text>
    )
  // The gutter: ⎿ on the first line under the dot, blank under it, as Claude Code draws a tool's result.
  const line = (first: boolean, children: RenderChildren, key: string) => (
    <Box key={key} flexDirection="row">
      <Box width={glyph.elbow.length} flexShrink={0}>
        <Text color={color.dim}>{first ? glyph.elbow : ''}</Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" flexGrow={1}>{children}</Box>
    </Box>
  )
  const sep = <Text color={color.dim}>{' · '}</Text>
  const counts = (added: number, removed: number) => (
    <Text><Text color={color.added}>{`+${added}`}</Text>{' '}<Text color={color.removed}>{`${glyph.minus}${removed}`}</Text></Text>
  )

  // One file reads as itself; more read as their size and folders, so a 60-file refactor is as short as a 2-file fix. Key 2 has each file.
  const one = (c: Change) =>
    c.isDelete ? <Text color={color.check}>{`${shortPath(c.path)} deleted`}</Text>
    : c.viaBash ? <Text>{shortPath(c.path)}<Text color={color.dim}> via Bash</Text></Text>
    : <Text>{`${shortPath(c.path)} `}{counts(c.added, c.removed)}</Text>
  const changed = (): RenderChildren => {
    if (t.changes.length === 1) return one(t.changes[0]!)
    const total = changeTotals(t.changes)
    const size = <Text>{`${total.files} files `}{total.counted ? counts(total.added, total.removed) : <Text color={color.dim}>via Bash</Text>}</Text>
    const folders = byFolder(t.changes)
    const more = folders.length - FOLDERS_SHOWN
    return (
      <Text>
        {size}
        <Text color={color.dim}>{' in '}</Text>
        {folders.slice(0, FOLDERS_SHOWN).map(f => dirName(f.dir)).join(', ')}
        {more > 0 ? <Text color={color.dim}>{` +${more} folder${more === 1 ? '' : 's'}`}</Text> : ''}
      </Text>
    )
  }

  // The first run and the last: where the turn's tests started and where they ended. One runner names itself once.
  const tests = (): RenderChildren => {
    const first = t.testRuns[0]!
    const last = t.testRuns.at(-1)!
    const a = testLabel(first)
    if (t.testRuns.length === 1) return <Text color={a.ok ? color.pass : color.fail}>{a.text}</Text>
    const b = testLabel(last)
    return (
      <Text>
        <Text color={a.ok ? color.pass : color.fail}>{a.text}</Text>
        <Text color={color.dim}>{` ${glyph.arrow} `}</Text>
        <Text color={b.ok ? color.pass : color.fail}>{first.runner === last.runner ? b.result : b.text}</Text>
      </Text>
    )
  }

  // What the turn did, in one line: its changes and its tests. A turn with neither says what it read or ran.
  const facts: RenderChildren[] = []
  if (t.changes.length > 0) facts.push(pressable('changed', changed()))
  if (t.testRuns.length > 0) facts.push(pressable('tests', tests()))
  else if (t.changes.length > 0) facts.push(pressable('tests', <Text color={color.dim}>tests not run</Text>))
  if (facts.length === 0 && (t.ran ?? []).length > 0) facts.push(pressable('ran', `ran ${ranLabel(t.ran ?? [])}`))
  if (facts.length === 0) facts.push(pressable('looked', `read ${lookedLabel(t)}`))

  const lines = [
    facts.flatMap((f, i) => (i > 0 ? [sep, f] : [f])),
    ...t.flags.map((fl, i) => pressable('check', <Text color={color.check}>{`${glyph.check} ${fl.detail}`}</Text>, i)),
    ...(o.isExpanded ? t.interim.map(n => <Text color={color.dim}>{n}</Text>) : []),
  ]

  const goal = <Text wrap="truncate-end">{t.goal}</Text>
  return (
    <Box key="tldr-card" flexDirection="column">
      <Box flexDirection="row">
        <Text color={verdictColor[verdictOf(t)]}>{`${glyph.dot} `}</Text>
        <Text bold>{'TL;DR '}</Text>
        {o.show !== undefined ? <Button key={`tldr-show:all:${t.id}`} plain onPress={() => o.show!('all')}>{goal}</Button> : goal}
        <Text color={color.dim}>{` · ${ms === null ? 'running' : duration(ms)}`}</Text>
      </Box>
      {lines.map((l, i) => line(i === 0, l, `tldr-line:${i}`))}
      {o.open !== undefined ? (
        <Box key={`tldr-inline:${t.id}`} flexDirection="column" marginTop={1} paddingLeft={glyph.elbow.length}>
          {o.open.section !== 'all' ? <Text bold>{sectionTitle(o.open.section)}</Text> : null}
          {o.open.detail}
        </Box>
      ) : null}
    </Box>
  )
}
