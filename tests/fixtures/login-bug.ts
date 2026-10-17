// The mockup's turn: fix a login bug, tests fail, fix again, tests pass.
// `engine(on)` stands in for Claude Code beneath the plugin; `play($)` raises the turn's events.
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PYTEST_FAIL = [
  'collected 12 items',
  'tests/test_auth.py ..F.F...F...',
  '========================= 3 failed, 9 passed in 1.84s =========================',
].join('\n')
const PYTEST_PASS = ['............', '12 passed in 1.62s'].join('\n')

function patch(added: number, removed: number) {
  return [{ oldStart: 1, oldLines: removed, newStart: 1, newLines: added, lines: [...Array(removed).fill('-old'), ...Array(added).fill('+new'), ' same'] }]
}

let pytestRuns = 0

export function engine(on: On): void {
  pytestRuns = 0
  mock.clock(on)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: 'Fixed. All 12 auth tests pass.' }))
  on('tool.call', async (_$, e) => {
    if (e.tool === 'Edit') return { result: { structuredPatch: (e as { file_path: string }).file_path.endsWith('auth.py') ? patch(12, 3) : (e as { file_path: string }).file_path.endsWith('middleware.py') ? patch(4, 1) : patch(2, 2) } } as never
    if (e.tool === 'Bash') {
      pytestRuns++
      return pytestRuns === 1
        ? ({ result: { stdout: PYTEST_FAIL, stderr: '', interrupted: false }, isError: true } as never)
        : ({ result: { stdout: PYTEST_PASS, stderr: '', interrupted: false } } as never)
    }
    return { result: { ok: true } } as never
  })
}

export const TURN_ID = 'turn-login'

export async function play($: Engine): Promise<void> {
  await $.turn.start({ turnId: TURN_ID, text: 'fix the login bug, users get logged out after refresh' } as never)
  const call = (tool: string, input: Record<string, unknown>, id: string) => $.tool.call({ tool, ...input, tool_use_id: id } as never)
  await call('Read', { file_path: 'src/auth.py' }, 'tu-1')
  await call('Grep', { pattern: 'decode\\(' }, 'tu-2')
  await call('Read', { file_path: 'src/middleware.py' }, 'tu-3')
  await call('Edit', { file_path: 'src/auth.py', old_string: 'a', new_string: 'b' }, 'tu-4')
  await call('Bash', { command: 'pytest tests/test_auth.py -q' }, 'tu-5')
  await call('Edit', { file_path: 'src/middleware.py', old_string: 'a', new_string: 'b' }, 'tu-6')
  await call('Edit', { file_path: 'tests/conftest.py', old_string: 'a', new_string: 'b' }, 'tu-7')
  await call('Bash', { command: 'pytest tests/test_auth.py -q' }, 'tu-8')
  await $.turn.complete({ turnId: TURN_ID, answer: 'Fixed. All 12 auth tests pass.' } as never)
}

export const CALL_IDS = ['tu-1', 'tu-2', 'tu-3', 'tu-4', 'tu-5', 'tu-6', 'tu-7', 'tu-8']
