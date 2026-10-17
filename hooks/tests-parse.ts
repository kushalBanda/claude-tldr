// Recognize test commands and read their result counts. Pure.

export type TestCounts = { passed: number | null; failed: number | null; skipped: number | null }

// Command start: line start or after a shell separator, with an optional runner prefix (npx, pnpm exec, ...).
const AT = String.raw`(^|[\s;&|(])`
const VIA = String.raw`((npx|bunx|pnpx|pnpm(\s+exec)?|yarn|npm\s+exec)\s+)?`

// Order matters: a named runner wins over the package manager or task runner that starts it.
const RUNNERS: [string, RegExp][] = [
  ['pytest', new RegExp(`${AT}(python3?\\s+-m\\s+|uv\\s+run\\s+|poetry\\s+run\\s+)?pytest(\\s|$)`)],
  ['unittest', new RegExp(`${AT}python3?\\s+-m\\s+unittest(\\s|$)`)],
  ['playwright', new RegExp(`${AT}${VIA}playwright\\s+test(\\s|$)`)],
  ['vitest', new RegExp(`${AT}${VIA}vitest(\\s|$)`)],
  ['jest', new RegExp(`${AT}${VIA}jest(\\s|$)`)],
  ['go test', new RegExp(`${AT}go\\s+test(\\s|$)`)],
  ['cargo test', new RegExp(`${AT}cargo\\s+(test|nextest\\s+run)(\\s|$)`)],
  ['bun test', new RegExp(`${AT}bun\\s+test(\\s|$)`)],
  ['deno test', new RegExp(`${AT}deno\\s+test(\\s|$)`)],
  ['npm test', new RegExp(`${AT}npm\\s+(run\\s+)?test(:\\S+)?(\\s|$)|${AT}npm\\s+t(\\s|$)`)],
  ['pnpm test', new RegExp(`${AT}pnpm\\s+(run\\s+)?test(:\\S+)?(\\s|$)`)],
  ['yarn test', new RegExp(`${AT}yarn\\s+(run\\s+)?test(:\\S+)?(\\s|$)`)],
  ['bun test', new RegExp(`${AT}bun\\s+run\\s+test(:\\S+)?(\\s|$)`)],
  ['make test', new RegExp(`${AT}make\\s+test(\\s|$)`)],
  ['just test', new RegExp(`${AT}just\\s+test(\\s|$)`)],
  ['tox', new RegExp(`${AT}tox(\\s|$)`)],
]

// Runs that only list tests and run none.
const LIST_ONLY = /\s(--collect-only|--co|--listTests|--list|-list)(?=[\s=]|$)|\bvitest\s+list\b/

// Text in quotes or a heredoc is not a command: `echo "run npm test"` runs no tests.
function commandText(command: string): string {
  return command
    .replace(/<<-?\s*['"]?(\w+)['"]?([^\n]*)\n[\s\S]*?\n\s*\1\s*(?=\n|$)/g, '$2')
    .replace(/'[^'\n]*'|"(?:[^"\\\n]|\\.)*"/g, "''")
}

export function detectRunner(command: string): string | null {
  const text = commandText(command)
  if (LIST_ONLY.test(text)) return null
  for (const [name, re] of RUNNERS) if (re.test(text)) return name
  return null
}

const NONE: TestCounts = { passed: null, failed: null, skipped: null }

function count(text: string, word: string): number | null {
  const m = new RegExp(`(\\d+) ${word}`).exec(text)
  return m ? Number(m[1]) : null
}

function lastLine(output: string, test: (l: string) => boolean): string | undefined {
  return output.split('\n').reverse().find(test)
}

// "3 failed, 9 passed in 1.84s" or "12 passed in 1.62s".
function pytest(output: string): TestCounts {
  const line = lastLine(output, l => /\d+ (passed|failed|error)/.test(l) && / in [\d.]+s/.test(l))
  if (line === undefined) return NONE
  return { passed: count(line, 'passed') ?? 0, failed: (count(line, 'failed') ?? 0) + (count(line, 'errors?') ?? 0), skipped: count(line, 'skipped') ?? 0 }
}

// "Tests:       1 failed, 2 skipped, 11 passed, 14 total"
function jest(output: string): TestCounts {
  const line = lastLine(output, l => /^\s*Tests:\s+.*\d+ total/.test(l))
  if (line === undefined) return NONE
  return { passed: count(line, 'passed') ?? 0, failed: count(line, 'failed') ?? 0, skipped: (count(line, 'skipped') ?? 0) + (count(line, 'todo') ?? 0) }
}

// " Tests  3 failed | 9 passed (12)"
function vitest(output: string): TestCounts {
  const line = lastLine(output, l => /^\s*Tests\s+.*\(\d+\)/.test(l))
  if (line === undefined) return NONE
  return { passed: count(line, 'passed') ?? 0, failed: count(line, 'failed') ?? 0, skipped: (count(line, 'skipped') ?? 0) + (count(line, 'todo') ?? 0) }
}

// One "test result: ok. 12 passed; 0 failed; 1 ignored; ..." line per test binary: add them up.
function cargo(output: string): TestCounts {
  const lines = output.split('\n').filter(l => /test result: \w+\. \d+ passed; \d+ failed/.test(l))
  if (lines.length === 0) return NONE
  const sum = (word: string) => lines.reduce((n, l) => n + (count(l, word) ?? 0), 0)
  return { passed: sum('passed'), failed: sum('failed'), skipped: sum('ignored') }
}

// "--- PASS: TestX" lines come with -v; without them only the package lines show, and there are no counts.
function go(output: string): TestCounts {
  const n = (re: RegExp) => output.split('\n').filter(l => re.test(l)).length
  const passed = n(/^\s*--- PASS: /)
  const failed = n(/^\s*--- FAIL: /)
  if (passed + failed === 0) return NONE
  return { passed, failed, skipped: n(/^\s*--- SKIP: /) }
}

// " 12 pass" / " 3 fail" / " 1 skip" lines at the end of a bun test run.
function bun(output: string): TestCounts {
  const pass = /^\s*(\d+) pass\s*$/m.exec(output)
  const fail = /^\s*(\d+) fail\s*$/m.exec(output)
  if (pass === null && fail === null) return NONE
  const skip = /^\s*(\d+) skip\s*$/m.exec(output)
  return { passed: pass ? Number(pass[1]) : 0, failed: fail ? Number(fail[1]) : 0, skipped: skip ? Number(skip[1]) : 0 }
}

// "Ran 5 tests in 0.001s", then "OK (skipped=1)" or "FAILED (failures=1, errors=1)".
function unittest(output: string): TestCounts {
  const ran = /^Ran (\d+) tests? in /m.exec(output)
  if (ran === null) return NONE
  const end = lastLine(output, l => /^(OK|FAILED)\b/.test(l)) ?? ''
  const n = (word: string) => Number(new RegExp(`[(,]\\s*${word}=(\\d+)`).exec(end)?.[1] ?? 0)
  const failed = n('failures') + n('errors')
  const skipped = n('skipped') + n('expected failures')
  return { passed: Math.max(0, Number(ran[1]) - failed - skipped - n('unexpected successes')), failed, skipped }
}

// "  3 passed (5.2s)", "  1 failed", "  2 skipped", "  1 flaky" at the end of a run.
function playwright(output: string): TestCounts {
  const n = (word: string) => {
    const m = new RegExp(`^\\s*(\\d+) ${word}\\b`, 'm').exec(output)
    return m ? Number(m[1]) : null
  }
  const passed = n('passed')
  const failed = n('failed')
  if (passed === null && failed === null) return NONE
  return { passed: (passed ?? 0) + (n('flaky') ?? 0), failed: failed ?? 0, skipped: n('skipped') ?? 0 }
}

// "ok | 5 passed | 0 failed | 1 ignored (20ms)" or "FAILED | 3 passed | 2 failed (31ms)".
function deno(output: string): TestCounts {
  const line = lastLine(output, l => /^(ok|FAILED) \| \d+ passed/.test(l))
  if (line === undefined) return NONE
  return { passed: count(line, 'passed') ?? 0, failed: count(line, 'failed') ?? 0, skipped: count(line, 'ignored') ?? 0 }
}

const PARSERS: Record<string, (output: string) => TestCounts> = { pytest, unittest, playwright, jest, vitest, 'cargo test': cargo, 'go test': go, 'bun test': bun, 'deno test': deno }

export function parseResult(runner: string | null, output: string): TestCounts {
  const own = runner === null ? undefined : PARSERS[runner]
  if (own !== undefined) {
    const r = own(output)
    if (r.passed !== null || r.failed !== null) return r
  }
  // A package script or task runner (npm test, make test, tox, ...) runs some runner: the first summary any of them finds.
  for (const parse of [jest, vitest, bun, pytest, unittest, deno, cargo, go, playwright]) {
    const r = parse(output)
    if (r.passed !== null || r.failed !== null) return r
  }
  return NONE
}
