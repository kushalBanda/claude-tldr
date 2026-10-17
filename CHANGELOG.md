# Changelog

## 0.1.0

The first release.

- **Turn card:** one card per turn with the goal, time, size, changed files, test runs, other commands and reads.
- **Click to reveal:** each row opens a pane. Changed groups files by folder. The goal opens the turn as steps.
- **Trust flags:** test files changed in the turn that made tests pass, writes outside the project, deletes, added skip markers, `--no-verify` and force pushes.
- **Test parsers:** pytest, unittest, jest, vitest, Playwright, go test, gotestsum, cargo, nextest, bun and deno, also behind `npm test`, `make test`, `just test` and `tox`.
- **Bash parsing:** one command counts every job in it: test runs, writes, deletes and reads.
- **Motion:** a mode-aware spinner that names what Claude does now.
- **Context bar:** a bar above the prompt shows how full the context window is: the conversation (what `/compact` frees) in blue, the setup in gray, and the room left. The label names each color and warns at 75% and 90%. `/tldr context` or key 7 explains each part.
- **Main-screen keys:** on the main screen, the band above the prompt holds the rows of the latest card as digit keys.
- **Kept cards:** cards stay after `/compact` and a resume. `/tldr history` lists them.
- **Actions:** `/tldr copy` and `/tldr diff`.
