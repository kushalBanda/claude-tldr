// Calls a summary line cannot name stack into the card's Ran row; /compact moves the band while it runs.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ranLabel, runName } from '../hooks/summary'
import { engine } from './fixtures/login-bug'

const FULL = { columns: 120, rows: 40, isFullscreen: true }
const MAIN = { columns: 120, rows: 40, isFullscreen: false }
const band = { plugin: 'tldr', surface: 'terminal' as const, component: 'AbovePrompt' as const, requestId: 'band', viewport: FULL, props: { bodyColumns: 100, hasSurvey: false, isWorking: false, maxRows: 10 } as never }

const drawn = async ($: Engine, input: Parameters<Engine['ui']['mount']>[0]) => JSON.stringify(await (await $.ui.mount(input)).drawn())
const row = (id: string, command: string, viewport = MAIN) => ({
  plugin: 'tldr', surface: 'terminal' as const, component: 'ToolUse' as const, requestId: id, viewport,
  props: { tool_use_id: id, tool: 'Bash', input: { command }, isRunning: false, isErrored: false, isInterrupted: false, output: { stdout: '', stderr: '', interrupted: false } },
})

const COMMANDS = ['git clone https://x/y.git /tmp/y', 'cd /tmp/y && git fetch upstream', 'gh pr view 1651', 'cd /tmp/y && git merge upstream/master']

async function playCommands($: Engine) {
  await $.turn.start({ turnId: 'r', text: 'Resolve this PR conflict' } as never)
  for (const [k, command] of COMMANDS.entries()) await $.tool.call({ tool: 'Bash', command, tool_use_id: `r-${k}` } as never)
  await $.turn.complete({ turnId: 'r', answer: 'Conflict resolved.' } as never)
}

test('runName: the program a command runs, past cd and env words; an MCP server; else the tool', async () => {
  expect(runName('Bash', { command: 'cd /tmp/y && git merge upstream/master' })).toBe('git')
  expect(runName('Bash', { command: 'FOO=1 /usr/bin/python3 x.py' })).toBe('python3')
  expect(runName('Bash', { command: 'cd /tmp' })).toBe('Bash')
  expect(runName('mcp__claude_ai_Notion__notion-search', {})).toBe('claude_ai_Notion')
  expect(runName('WebFetch', { url: 'https://x' })).toBe('WebFetch')
})

test('ranLabel: each name once in first-run order, a count past one, the rest folded', async () => {
  expect(ranLabel(['git', 'git', 'gh', 'git'])).toBe('git ×3 · gh')
  expect(ranLabel(['a', 'b', 'c'], 2)).toBe('a · b · +1 more')
})

test('main screen: a row of a command the line cannot name draws nothing, not "1 other call"', async ($, on) => {
  engine(on)
  await playCommands($)
  const text = await drawn($, row('r-2', 'gh pr view 1651'))
  expect(text).not.toContain('other call')
  expect(text).not.toContain('gh pr view')
})

test('main screen: a row the line can name still draws its line', async ($, on) => {
  engine(on)
  await playCommands($)
  await $.turn.start({ turnId: 's', text: 'read it' } as never)
  await $.tool.call({ tool: 'Bash', command: 'cat src/auth.py', tool_use_id: 's-0' } as never)
  expect(await drawn($, row('s-0', 'cat src/auth.py'))).toContain('Read src/auth.py')
})

test('card: the commands stack into one Ran row', async ($, on) => {
  engine(on)
  await playCommands($)
  const text = await drawn($, row('r-0', COMMANDS[0]!, FULL))
  expect(text).toContain('"Ran"')
  expect(text).toContain('git ×3 · gh')
})

test('card: a turn with no such call has no Ran row', async ($, on) => {
  engine(on)
  await $.turn.start({ turnId: 'e', text: 'edit' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b', tool_use_id: 'e-0' } as never)
  await $.turn.complete({ turnId: 'e', answer: 'done' } as never)
  expect(await drawn($, row('e-0', '', FULL))).not.toContain('"Ran"')
})

const MESSAGES = [{ role: 'user', text: 'summary of earlier work', toolUses: [] }]

/** A compaction that holds until released, so the test can draw the band while it runs. */
function slowCompact(on: On) {
  let release = () => {}
  let entered = () => {}
  const gate = new Promise<void>(r => { release = r })
  const reached = new Promise<void>(r => { entered = r })
  on('session.compact', async (_$, e) => {
    entered()
    await gate
    return { messages: e.messages } as never
  })
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  return { release, reached }
}

test('/compact: the band says compacting while it runs, and idle after', async ($, on) => {
  engine(on)
  const c = slowCompact(on)
  const done = $.session.compact({ trigger: 'manual', messages: MESSAGES } as never)
  await c.reached
  expect(await drawn($, band)).toContain('compacting')
  c.release()
  await done
  const after = await drawn($, { ...band, requestId: 'band-after' })
  expect(after).not.toContain('compacting')
  expect(after).toContain('idle')
})

test('/compact: a precompute runs unseen, the band stays idle', async ($, on) => {
  engine(on)
  const c = slowCompact(on)
  const done = $.session.compact({ trigger: 'precompute', messages: MESSAGES } as never)
  await c.reached
  expect(await drawn($, band)).not.toContain('compacting')
  c.release()
  await done
})
