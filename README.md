# TL;DR for Claude Code

**Every turn, in one card.** The files Claude changed, the tests before and after, what it looked at, and what to check before you trust it.

<!-- GIF: replace this comment with ![TL;DR before and after](docs/demo/tldr.gif) -->

One fix in Claude Code can print a hundred lines of reads, searches, diffs and test logs. To find out what changed and whether it worked, you scroll. TL;DR folds the turn into a card and keeps every raw line one key away.

```
╭─────────────────────────────────────────────────────────────────────────────────╮
│ fix the login bug, users get logged out after refresh          14:02 · 52s      │
│ Changed   3 files +18 −6   src/auth.py, src/middleware.py, tests/conftest.py    │
│ Tests     pytest ✗ 3 failed  →  ✓ 12 passed                                     │
│ Check     ⚠ tests/conftest.py changed in the turn that made tests pass          │
│ Looked at 2 files, 1 search                              click a row ▸          │
│                                                             [ diff ]            │
╰─────────────────────────────────────────────────────────────────────────────────╯
```

## Install

In a Claude Code terminal session, type:

```
/plugin install tldr --marketplace kushalBanda/claude-tldr
```

Answer `y` to add the marketplace, then pick a scope (user is the first one). The plugin is active at once, with no restart. Needs Claude Code 2.1.301 or later.

## What you get

| | |
| --- | --- |
| **Turn card** | One card per turn in place of the tool rows: goal, time, the turn's size (`3 files +18 −6`) and its files, the test sequence, the other commands it ran (`git ×3 · gh`) stacked in one Ran row, what Claude read and searched. The text Claude writes between tool calls folds into the card; its final reply stays. |
| **Motion** | A spinner that shows the mode (thinking, running tools, writing) and what Claude does now (`Reading src/auth.py`). It also moves during `/compact`. A band above the prompt: orange while working, red after a failing test, green after a pass. |
| **Trust flags** | The card turns amber and says what to check: a test file changed in the turn that made tests pass, a write outside the project, a deleted file, an added skip/only/xfail marker, `--no-verify` or a force push. |
| **Kept cards** | Each finished card is saved for the session. After `/compact` or a resume, the band says how many earlier turns are kept, and `/tldr history` shows them. |
| **Actions** | Copy the reply as clean text, or see the turn's net diff. Buttons on the card in fullscreen; commands everywhere. |

### Both layouts

- **Fullscreen:** the card takes the place of the turn's tool rows and updates live. Click a row (Changed, Tests, Check, Ran, Looked at) and a small pane shows what's behind it: files grouped by folder with their first diff lines, each file read, each search, each test command. Click the goal and the pane shows the turn as steps in order, so you see how the tests went green: `Edit src/auth.py → Test ✗ 3 failed → Edit tests/conftest.py → Test ✓ 12 passed`. Escape closes it.
- **Main screen (scrollback):** printed rows cannot change, so each tool group becomes one summary line (calls it cannot name, like `git` or an MCP tool, print nothing and stack into the card's Ran row), and the full card prints where Claude Code's closing line ("Baked for 52s") was. `/tldr show` opens the same pane.

On desktop and VS Code, Claude Code draws its own rows. The card is for the terminal.

## Commands

| Command | Does |
| --- | --- |
| `/tldr` | Help. |
| `/tldr show [row]` | Open what's behind a row of the latest card: `changed`, `tests`, `check`, `ran`, `looked`, `notes`. With no row, the turn's steps in order. Escape closes it. |
| `/tldr history` | Open the kept cards of this session, newest first. |
| `/tldr copy` | Copy the latest reply as clean text: no trailing spaces, no shared indentation. |
| `/tldr diff` | Print the latest turn's net change per file as a unified diff. |

## Switches

Every feature is a switch, all on by default. Change them with `/plugin configure tldr@claude-tldr` in Claude Code.

| Switch | Off means |
| --- | --- |
| `card` | Claude Code's own rows. Also turns off `trust`, `keep` and `actions`. |
| `motion` | Claude Code's own spinner, no band. |
| `animation` | Motion keeps its colors but does not move. |
| `trust` | No Check row, no amber border. |
| `keep` | Nothing saved; no note after `/compact`. |
| `actions` | No buttons; no copy or diff commands. |

## Tests it reads

pytest, unittest, jest, vitest, Playwright, go test (counts need `-v`; a compile error reads `✗ build failed`), cargo test and nextest, bun test, deno test, and `npm`/`pnpm`/`yarn test`, `make test`, `just test` and `tox` (it reads the summary of whatever runner they start). Runs that only list tests (`--collect-only`, `--listTests`) don't count.

## Privacy

TL;DR makes no network calls. It only watches tool calls and their results in your session. Kept cards stay in Claude Code's local plugin store, one list per session, at most 50 cards, without diff bodies.

## Limits

- Changes made through Bash count when they use a redirect, a heredoc, `tee`, `sed -i`, `perl -i`, `cp`, `mv`, `touch`, `git checkout -- path` or `git restore`. They show as `path via Bash`, without line counts. Writes from scripts (`python x.py`), `git apply` and `git stash pop` are not seen. A path built from a variable (`> $OUT`) is left out.
- A `cd` counts inside one command (`cd app && touch x`), but not when it ran in an earlier call.
- Bulk deletes (`find -delete`, `git clean -f`, `xargs rm`) are flagged by command, not file by file.
- A task runner that starts two test runners (`make test` running `go test` and then `vitest`) shows the first summary it finds, not the sum.
- The custom spinner takes the place of Claude Code's spinner line, so its token count is not shown. Switch `motion` off to get it back.
- Text that Claude writes twice in one turn, word for word, as a note and as the reply, can fold away with the note. `/tldr show notes` brings it back.

## Develop

```bash
git clone https://github.com/kushalBanda/claude-tldr && cd claude-tldr
claude --plugin-dir .          # run it; a save reloads the mod
claude plugin validate .       # manifest, marketplace and hooks
claude plugin test .           # the test suite (tests/*.test.ts*)
```

Issues and ideas are welcome.

## License

MIT
