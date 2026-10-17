import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { bandLabel, bandState } from '../hooks/draw/band'
import { bandFrame, encodeCells, spinnerFrame } from '../hooks/motion'
import { activityWord } from '../hooks/summary'
import { CALL_IDS, engine, play } from './fixtures/login-bug'

const FULL = { columns: 120, rows: 40, isFullscreen: true }

function engineDraws(on: On) {
  on('ui.render', { component: 'Spinner' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`engine spinner ${e.props.word}`}</Text>
  })
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>other mod band</Text>
  })
  on('ui.render', { component: 'ToolGroup' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine rows</Text>
  })
}

const spinner = (mode: 'thinking' | 'tool-use' | 'responding', surface: 'terminal' | 'desktop' = 'terminal') => ({
  plugin: 'tldr', surface, component: 'Spinner' as const, requestId: 'spin', viewport: FULL,
  props: { word: 'Sautéing', message: null, suffix: '…', mode },
})
const band = { plugin: 'tldr', surface: 'terminal' as const, component: 'AbovePrompt' as const, requestId: 'band', viewport: FULL, props: { bodyColumns: 100, hasSurvey: false, isWorking: false, maxRows: 10 } as never }

test('cells encode as padded base64 of little-endian u32 triplets', async () => {
  expect(encodeCells(Uint32Array.of(0x2588, 0xff8800, 0x01000000))).toBe('iCUAAACI/wAAAAAB')
})

test('spinner frames differ by mode and move over time', async () => {
  const at = (mode: 'thinking' | 'tool-use' | 'responding', ms: number) => Array.from(spinnerFrame(mode, ms)).join(',')
  expect(at('thinking', 0)).not.toBe(at('tool-use', 0))
  expect(at('tool-use', 0)).not.toBe(at('responding', 0))
  expect(at('thinking', 0)).not.toBe(at('thinking', 400))
  expect(spinnerFrame('thinking', 0).length).toBe(9 * 3)
})

test('band frames: red line on a failure, thin dim line when idle, a moving light only while working', async () => {
  const fail = bandFrame('fail', 0, 10, true)
  expect(fail[1]).toBe(0xe46a5e)
  const idle = bandFrame('idle', 0, 10, true)
  expect(idle[0]).toBe(0x2500)
  expect(Array.from(bandFrame('working', 200, 30, true)).join()).not.toBe(Array.from(bandFrame('working', 900, 30, true)).join())
  expect(Array.from(bandFrame('working', 200, 30, false)).join()).toBe(Array.from(bandFrame('working', 900, 30, false)).join())
})

test('band label and state follow the live phase and the latest test result', async () => {
  expect(bandLabel({ phase: 'working', word: 'Reading a.py', last: null, flagged: false })).toBe('working · Reading a.py')
  expect(bandState({ phase: 'working', word: '', last: 'fail', flagged: false })).toBe('fail')
  expect(bandLabel({ phase: 'working', word: '', last: 'fail', flagged: false })).toBe('tests failing')
  expect(bandLabel({ phase: 'idle', word: '', last: 'pass', flagged: false })).toBe('idle · tests green')
  expect(bandState({ phase: 'idle', word: '', last: 'pass', flagged: false })).toBe('idle')
})

test('activity words name what Claude does', async () => {
  expect(activityWord('Read', { file_path: 'src/auth.py' })).toBe('Reading src/auth.py')
  expect(activityWord('Edit', { file_path: 'a.ts' })).toBe('Editing a.ts')
  expect(activityWord('Bash', { command: 'pytest -q\necho done' })).toBe('Running pytest -q')
  expect(activityWord('WebFetch', {})).toBe('Using WebFetch')
})

test('spinner: a Raster plus what Claude does now, while a call runs', async ($, on) => {
  mock.clock(on)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  engineDraws(on)
  let seen = ''
  on('tool.call', async () => {
    const ui = await $.ui.mount(spinner('tool-use'))
    seen = JSON.stringify(await ui.drawn())
    return { result: {} } as never
  })
  await $.turn.start({ turnId: 't', text: 'go' } as never)
  await $.tool.call({ tool: 'Read', file_path: 'src/auth.py', tool_use_id: 'r1' } as never)
  expect(seen).toContain('"type":"Raster"')
  expect(seen).toContain('Reading src/auth.py')
  expect(seen).not.toContain('engine spinner')
})

test('spinner: desktop keeps the engine spinner', async ($, on) => {
  engine(on)
  engineDraws(on)
  const ui = await $.ui.mount(spinner('thinking', 'desktop'))
  expect(JSON.stringify(await ui.drawn())).toContain('engine spinner')
})

test('band: idle with tests green after the login-bug turn, other mods kept above', async ($, on) => {
  engine(on)
  engineDraws(on)
  await play($)
  const text = JSON.stringify(await (await $.ui.mount(band)).drawn())
  expect(text).toContain('other mod band')
  expect(text).toContain('idle · tests green')
  expect(text).toContain('"type":"Raster"')
})

test('band: red with tests failing right after a failing run', async ($, on) => {
  engine(on)
  engineDraws(on)
  await $.turn.start({ turnId: 't', text: 'go' } as never)
  await $.tool.call({ tool: 'Bash', command: 'pytest -q', tool_use_id: 'b1' } as never)
  const text = JSON.stringify(await (await $.ui.mount(band)).drawn())
  expect(text).toContain('tests failing')
  expect(text).toContain('"color":"error"')
})

test('card: the newest change flashes right after it lands', async ($, on) => {
  engine(on)
  engineDraws(on)
  await $.turn.start({ turnId: 't', text: 'go' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'src/auth.py', old_string: 'a', new_string: 'b', tool_use_id: 'e1' } as never)
  const ui = await $.ui.mount({
    plugin: 'tldr', surface: 'terminal', component: 'ToolGroup', requestId: 'g', viewport: FULL,
    props: { calls: [{ tool_use_id: 'e1', tool: 'Edit', input: {}, isRunning: false, isErrored: false, isInterrupted: false }], isActive: false, isExpanded: false },
  })
  expect(JSON.stringify(await ui.drawn())).toContain('"backgroundColor":"success"')
  void CALL_IDS
})
