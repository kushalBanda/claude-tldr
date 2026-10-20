// TL;DR's type contract: the records it keeps in $.state.

export type Change = {
  path: string
  added: number
  removed: number
  viaBash: boolean
  isTest: boolean
  isDelete: boolean
  outsideRoot: boolean // written outside the session's project root (path kept absolute)
  addsSkip: boolean // the edit adds a skip/only/xfail marker that was not there
}

export type TestRun = {
  command: string
  runner: string | null
  passed: number | null
  failed: number | null
  skipped: number | null
  isError: boolean
  note?: string // what failed when no test ran: "build failed"
}

export type Turn = {
  id: string
  startedAt: number
  endedAt: number | null
  goal: string
  reads: string[]
  searches: string[]
  changes: Change[]
  testRuns: TestRun[]
  toolUseIds: string[]
  log: string[] // one line per tool call, in order: the steps view and the main-screen lines
  ranLog?: string[] // the log line of each call counted under Ran, for the detail pane
  ran?: string[] // a short name per call that is not a read, search, change or test: git, gh, WebFetch
  interim: string[] // what Claude wrote between tool calls; folded into the card
  reply: string | null // what Claude wrote after its last tool call
  jump: Jump | null // the newest notable event: a test result or a new flag, for the band while the turn runs
  flags: Flag[] // what to check before trusting this turn
  diffs: FileDiff[] // the turn's edits as diff lines, for /tldr diff (dropped on disk)
}

/** One file's edits in the turn: hunk headers and -/+/space lines, as a unified diff has them. */
export type FileDiff = { path: string; lines: string[] }

export type FlagKind = 'tests-edited' | 'outside-root' | 'deleted' | 'skipped-tests' | 'bypass'
export type Flag = { kind: FlagKind; detail: string; items?: string[] } // detail fits one row; items show in the Check pane

export type Tone = 'pass' | 'fail' | 'check'

/** What just happened in the turn: "✗ pytest 3 failed", "⚠ tests/conftest.py changed …", and when. */
export type Jump = { parts: { text: string; tone: Tone }[]; at: number }

/** The tool call running now, for the band's clock; `lastMs` is how long the same command took last time. */
export type Running = { id: string; label: string; startedAt: number; isCommand: boolean; lastMs: number | null }

export type Live = {
  phase: 'idle' | 'working' | 'compacting'
  word: string // what Claude does now: "Reading src/auth.py"
  running: Running | null
  since: number // when the last tool call ended, or the turn started: the clock while Claude thinks
}

/** Cards kept on disk; shown after /compact or a resume. */
export type Kept = { count: number; note: boolean }

/** One task of Claude's own list, as TaskCreate/TaskUpdate or TodoWrite wrote it. */
export type PlanTask = {
  id: string
  subject: string // "Run the auth tests"
  activeForm: string | null // what the row says while the task runs: "Running the auth tests"
  status: 'pending' | 'in_progress' | 'completed'
}

/** Claude's task list for the band's stepper: session-wide, as Claude's own list is; shown while the turn that last touched it runs. */
export type Plan = {
  tasks: PlanTask[]
  turnId: string | null
  done: { id: string; at: number } | null // the task completed last, for a short highlight
}

declare module 'claude-code' {
  interface PluginState {
    tldr: { turns: Turn[]; current: string | null; live: Live; kept: Kept; plan: Plan }
  }
}
