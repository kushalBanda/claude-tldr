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
  log: string[] // one line per tool call, for /tldr expand on the main screen
  ran?: string[] // a short name per call that is not a read, search, change or test: git, gh, WebFetch
  interim: string[] // what Claude wrote between tool calls; folded into the card
  reply: string | null // what Claude wrote after its last tool call
  expanded: boolean
  pulse: Pulse | null // the newest change or test result, for a short highlight
  flags: Flag[] // what to check before trusting this turn
  diffs: FileDiff[] // the turn's edits as diff lines, for /tldr diff (dropped on disk)
}

/** One file's edits in the turn: hunk headers and -/+/space lines, as a unified diff has them. */
export type FileDiff = { path: string; lines: string[] }

export type FlagKind = 'tests-edited' | 'outside-root' | 'deleted' | 'skipped-tests' | 'bypass'
export type Flag = { kind: FlagKind; detail: string; items?: string[] } // detail fits one row; items show when expanded

export type Pulse = { kind: 'change' | 'test'; key: string; at: number }

export type Live = {
  phase: 'idle' | 'working' | 'compacting'
  word: string // what Claude does now: "Reading src/auth.py"
  last: 'pass' | 'fail' | null // the latest test result while working
  flagged: boolean // the current turn has a trust flag
}

/** Cards kept on disk; shown after /compact or a resume. */
export type Kept = { count: number; note: boolean }

declare module 'claude-code' {
  interface PluginState {
    tldr: { turns: Turn[]; current: string | null; live: Live; kept: Kept }
  }
}
