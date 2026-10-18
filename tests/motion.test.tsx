import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { encodeCells, spinnerFrame } from '../hooks/motion'
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

test('activity words name what Claude does', async () => {
  expect(activityWord('Read', { file_path: 'src/auth.py' })).toBe('Reading src/auth.py')
  expect(activityWord('Edit', { file_path: 'a.ts' })).toBe('Editing a.ts')
  expect(activityWord('Bash', { command: 'pytest -q\necho done' })).toBe('Running pytest -q')
  expect(activityWord('WebFetch', {})).toBe('Using WebFetch')
  expect(activityWord('mcp__playwright__browser_take_screenshot', {})).toBe('Using playwright browser take screenshot')
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

test('band: no line of its own; other mods kept, nothing added in fullscreen', async ($, on) => {
  engine(on)
  engineDraws(on)
  await play($)
  const text = JSON.stringify(await (await $.ui.mount(band)).drawn())
  expect(text).toContain('other mod band')
  expect(text).not.toContain('"type":"Raster"')
  expect(text).not.toContain('tldr-reveal')
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

const MAIN = { columns: 120, rows: 40, isFullscreen: false }
const mainBand = { ...band, viewport: MAIN }

test('main screen: the band holds the card rows as digit keys, and a key opens the pane', async ($, on) => {
  const opened: string[] = []
  on('ui.open', async (_$, e) => { opened.push((e as { id: string }).id); return { value: { isPlaced: true } } as never })
  engine(on)
  engineDraws(on)
  await play($)
  const ui = await $.ui.mount(mainBand)
  for (const s of ['all', 'changed', 'tests', 'check', 'looked']) expect(await ui.find({ key: `tldr-reveal:${s}:turn-login` })).toBeDefined()
  expect(await ui.find({ key: 'tldr-reveal:ran:turn-login' })).toBeUndefined()
  const text = JSON.stringify(await ui.drawn())
  for (const s of ['"hotkey":"1"', '"label":"steps"', '"hotkey":"3"', '"label":"tests"']) expect(text).toContain(s)
  await ui.press({ key: 'tldr-reveal:tests:turn-login' })
  expect(opened).toEqual(['tldr-detail'])
  const pane = await $.ui.mount({ plugin: 'tldr', surface: 'terminal', component: 'Pane', requestId: 'tldr-detail', viewport: MAIN, props: {} as never })
  expect(JSON.stringify(await pane.drawn())).toContain('12 passed')
})

test('the band shows no row keys in fullscreen, while Claude works, or before a turn ends', async ($, on) => {
  engine(on)
  engineDraws(on)
  const none = async (input: typeof band) => {
    const ui = await $.ui.mount(input)
    expect(await ui.find({ key: 'tldr-reveal:all:turn-login' })).toBeUndefined()
    await ui.unmount()
  }
  await none(mainBand)
  await play($)
  await none(band)
  await none({ ...mainBand, props: { bodyColumns: 100, hasSurvey: false, isWorking: true, maxRows: 10 } as never })
})

test('card off: the band shows no row keys', { options: { card: false } }, async ($, on) => {
  engine(on)
  engineDraws(on)
  await play($)
  expect(await (await $.ui.mount(mainBand)).find({ key: 'tldr-reveal:all:turn-login' })).toBeUndefined()
})
