# TL;DR for Claude Code

**Every turn, in one row.** What changed, how the tests went, and what to check before you trust it, in Claude Code's own row style.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-0.1.5-orange.svg)
![Claude Code](https://img.shields.io/badge/Claude%20Code-2.1.301%2B-d77757.svg)
![No network calls](https://img.shields.io/badge/network%20calls-none-success.svg)

**Listed on** [![claudecodemods.com](https://img.shields.io/badge/claudecodemods.com-tldr-d77757.svg)](https://claudecodemods.com/extensions/claude-tldr)
[![claudemods.dev](https://img.shields.io/badge/claudemods.dev-tldr-d77757.svg)](https://claudemods.dev/en/builds/tldr-825fdb)
[![claudemods.si](https://img.shields.io/badge/claudemods.si-tldr-d77757.svg)](https://claudemods.si/mods/tldr-kushalbanda)

![Left: a Claude Code turn as 33 lines of reads, edits and test logs. Right: the same turn as one line per tool group, then a three-line TL;DR row with an amber dot that flags the changed test file, the row keys and the prompt hint.](.github/assets/before-after.png)

![33 lines become 3. The dot turns amber and each edit that can fake a green run gets its own line. No network calls.](.github/assets/value.png)

## Install

In a Claude Code terminal session, type:

```
/plugin install tldr --marketplace kushalBanda/claude-tldr
```

Answer `y` to add the marketplace, then pick a scope (user is the first one). The mod starts at once, with no restart. It needs Claude Code 2.1.301 or later.

## Features

![A TL;DR row with an amber dot and four lines to check: a write outside the project, a deleted file, an added skip marker, and skipped hooks with a force push.](.github/assets/trust.png)

![In fullscreen, the changes line is open under the row: files grouped by folder, with the first diff lines of auth.py.](.github/assets/reveal.png)

![A spinner reads "Running pytest". The TL;DR line above the prompt shows a half-filled ring, 38s of about 1m 12s last time, and the last result: pytest 3 failed 1m 30s ago.](.github/assets/progress.png)

![Three context bars: 38% full in blue, 62% full in amber, and 86% full in red with a pointer to /compact.](.github/assets/context.png)

![On the main screen, the band above the prompt shows TL;DR, the last turn's verdict and its rows as digit keys. Key 3 opens the test runs under it.](.github/assets/band.png)

![The /tldr history pane lists two kept rows with their replies, newest first.](.github/assets/history.png)

Also: when a turn over 30 seconds ends, a notification carries its verdict, and the status line keeps it until your next prompt. `/tldr copy` copies the reply as clean text, and `/tldr diff` prints the net diff of the turn. On desktop and in VS Code, Claude Code draws its own rows. TL;DR is for the terminal.

## Reference

<details>
<summary><b>Commands</b></summary>

| Command | Does |
| --- | --- |
| `/tldr` | Help. |
| `/tldr show [row]` | Open what's behind a line of the latest row: `changed`, `tests`, `check`, `ran`, `looked`, `notes`. With no row, the steps of the turn in order. Escape closes it. |
| `/tldr context` | Open the context pane: each category that fills the window, with its tokens and share. |
| `/tldr history` | Open the kept rows of this session, newest first. |
| `/tldr copy` | Copy the latest reply as clean text: no trailing spaces, no shared indentation. |
| `/tldr diff` | Print the net change of the latest turn per file, as a unified diff. |

</details>

<details>
<summary><b>Switches</b></summary>

Every feature is a switch, and all are on by default. Change them with `/plugin configure tldr@claude-tldr` in Claude Code.

| Switch | Off means |
| --- | --- |
| `card` | Claude Code's own rows. Also turns off `trust`, `keep`, `actions` and `notify`. |
| `motion` | Claude Code's own spinner, and no TL;DR line while a turn runs. |
| `animation` | Motion keeps its colors but doesn't move. The band's clock moves only when a step lands. |
| `context` | No context bar. |
| `trust` | No lines to check, no amber dot. |
| `keep` | Nothing saved, no note after `/compact`. |
| `actions` | No copy or diff commands. |
| `notify` | No notification and no status line when a long turn ends. |

</details>

<details>
<summary><b>Tests it reads</b></summary>

pytest, unittest, jest, vitest, Playwright, go test, gotestsum, cargo test and nextest, bun test, and deno test. It also reads `npm`, `pnpm` and `yarn test`, `make test`, `just test` and `tox`: it finds the summary of the runner they start. For `go test`, counts need `-v`, and a compile error reads `✗ build failed`. Runs that only list tests (`--collect-only`, `--listTests`) don't count.

</details>

<details>
<summary><b>Privacy and trust</b></summary>

- **No network.** TL;DR makes no network calls and starts no processes.
- **Local only.** It reads the tool calls and results of your session, and the files Claude edits, to build the net diff. The context bar uses Claude Code's local estimate of the window, so it sends no request. Kept rows stay in Claude Code's local plugin store: one list per session, at most 50 rows, without diff bodies. The same store keeps how long each Bash command took, at most 100 per project, for the band's ring.
- **Notifications.** A turn over 30 seconds ends with a notification through your own Claude Code notification setting. The `notify` switch turns it off.
- **Hooks that see other calls.** It hooks `command.run` only to answer its own `/tldr` command, and `tool.call` only to read each call and its result, which it passes back unchanged. It never changes or blocks a call.
- **Check it yourself.** Before you install, run `claude plugin validate` on a clone. The `hooks:` and `calls:` lines list every event the mod handles and every API it calls.

</details>

<details>
<summary><b>Limits</b></summary>

- Changes made through Bash count when they use a redirect, a heredoc, `tee`, `sed -i`, `perl -i`, `cp`, `mv`, `touch`, `git checkout -- path` or `git restore`. They show as `path via Bash`, without line counts. Writes from scripts (`python x.py`), `git apply` and `git stash pop` don't show. A path built from a variable (`> $OUT`) is left out.
- A `cd` counts inside one command (`cd app && touch x`), but not when it ran in an earlier call.
- When grep or tail cuts `go test` output, the row keeps the failures it sees but drops the pass count. A summary line (gotestsum, or a wrapper's own) keeps all counts.
- Bulk deletes (`find -delete`, `git clean -f`, `xargs rm`) are flagged by command, not file by file.
- A task runner that starts two test runners (`make test` that runs `go test` and then `vitest`) shows the first summary it finds, not the sum.
- The custom spinner takes the place of Claude Code's spinner line, so the token count doesn't show. Switch `motion` off to get it back.
- If Claude writes the same text twice in one turn, as a note and as the reply, it can fold away with the note. `/tldr show notes` brings it back.

</details>

<details>
<summary><b>Develop</b></summary>

Clone the repository, and in its folder:

```bash
claude --plugin-dir .          # run it; a save reloads the mod
claude plugin validate .       # manifest, marketplace and hooks
claude plugin test .           # the test suite (tests/*.test.ts*)
```

The mod is TypeScript with no dependencies. Render hooks are pure, and all parsing is static: TL;DR never runs a command to learn what a command did. See [CONTRIBUTING.md](CONTRIBUTING.md) to send a change.

The images in this README are mock-ups of the mod's output for the turn in `tests/fixtures/login-bug.ts`.

</details>

## Contributing

Bug reports, ideas and pull requests are welcome. Use the [issue forms](https://github.com/kushalBanda/claude-tldr/issues/new/choose). A screenshot of the TL;DR row helps a lot. To report a security problem, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Kushal Banda
