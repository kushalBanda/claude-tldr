# Changelog

## 0.1.6

- **Context bar after /compact:** the bar now shows the compacted conversation. Before, it measured the transcript before the new one was in place, so it kept the old figures until the next request.

## 0.1.5

- **The card is a row:** each turn ends with a row in the transcript's own style, `⏺ TL;DR <goal> · 52s`, and under `⎿` what changed and how the tests went, then one line per thing to check. The dot's color is the verdict: green, red, amber for a flag, gray with no test run. No box, no labels. More than one file reads as its size and folders, so a 60-file refactor stays one line.
- **Long turns:** the TL;DR line above the prompt ticks each second. A command it has timed before gets a ring against last time (`◑ … 38s of ~1m 12s`); the first run says so. After it comes the last test result or flag and how long ago. Between calls it says how long Claude has been thinking.
- **Notify:** a turn over 30 seconds ends with a notification carrying its verdict, and the status line keeps it until your next prompt. A new `notify` switch, on by default.
- **Main screen:** a tool line that ran tests shows the result and its dot in green or red. The band shows `TL;DR` in Claude's orange with the last turn's verdict. The line under an empty prompt says the digits open the last card.
- **Removed:** the card's copy and diff buttons and the diff pane (`/tldr copy` and `/tldr diff` stay), the hint lines on the card and the band, and the flash on a new change.

## 0.1.4

- **Task stepper:** when Claude writes a task list (`TaskCreate` and `TaskUpdate`, or `TodoWrite`), the band above the prompt shows it while the turn runs: a bar filled by tasks done, the count, and up to five tasks. Done tasks tick off, the running one names what Claude does now with a sweep of light, the rest wait dim. With no list, the TL;DR line stays as before. Behind `motion`; `animation` off holds it still.

## 0.1.3

- **Directory ready:** every function that takes `$` lives in the hooks module, so the Claude directory can read the mod's calls. The draw modules take the resolved elements. No change in what the mod does.
- **Icon:** a square listing icon, and a display name, TL;DR for Claude Code.

## 0.1.2

- **Click to reveal:** on the main screen, a row key opens its detail on the band above the prompt, as fullscreen opens it inside the card. The same key closes it. No pane.

## 0.1.1

- **Click to reveal:** in fullscreen, a row's detail opens inside the card instead of a pane on the right. A click on the card no longer draws it twice.
- **Context bar:** the conversation turns amber at 60% and red at 80%.

## 0.1.0

The first release.

- **Turn card:** one card per turn with the goal, time, size, changed files, test runs, other commands and reads.
- **Click to reveal:** in fullscreen, each row opens its detail inside the card, and a second click closes it. On the main screen, a row key opens its detail on the band above the prompt, and the same key closes it. Changed groups files by folder. The goal opens the turn as steps.
- **Trust flags:** test files changed in the turn that made tests pass, writes outside the project, deletes, added skip markers, `--no-verify` and force pushes.
- **Test parsers:** pytest, unittest, jest, vitest, Playwright, go test, gotestsum, cargo, nextest, bun and deno, also behind `npm test`, `make test`, `just test` and `tox`.
- **Bash parsing:** one command counts every job in it: test runs, writes, deletes and reads.
- **Motion:** a mode-aware spinner that names what Claude does now.
- **Context bar:** a bar above the prompt shows how full the context window is: the conversation (what `/compact` frees) in blue (amber from 60%, red from 80%), the setup in gray, and the room left. The label names each color and warns at 60% and 80%. A click on its label or `/tldr context` explains each part.
- **So far line:** while a turn runs, one line above the prompt shows its calls, files, test runs and current job.
- **Main-screen keys:** on the main screen, the band above the prompt holds the rows of the latest card as digit keys.
- **Kept cards:** cards stay after `/compact` and a resume. `/tldr history` lists them.
- **Actions:** `/tldr copy` and `/tldr diff`.
