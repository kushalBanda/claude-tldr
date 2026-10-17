# Contributing to TL;DR

Thanks for your help. Bug reports, ideas and pull requests are all welcome.

## Report a bug or send an idea

Use the [issue forms](https://github.com/kushalBanda/claude-tldr/issues/new/choose). For a bug, include:

- The output of `claude --version`.
- The layout: fullscreen or main screen.
- A screenshot of the card, if you can share one.
- The command or tool calls that cause it. A wrong test count needs the last lines of the test output.

## Set up

You need Claude Code 2.1.301 or later. The mod has no dependencies, so there is nothing to install.

```bash
git clone https://github.com/kushalBanda/claude-tldr && cd claude-tldr
claude --plugin-dir .          # run Claude Code with your copy; a save reloads the mod
claude plugin test .           # run the test suite
claude plugin validate .       # check the manifest, the marketplace and the hooks
```

To type-check, run `npx -y -p typescript@5.6.3 tsc -p .`. It needs the engine types in `.claude-plugin/types/`, which Claude Code writes when it loads the mod with `--plugin-dir`.

## Where the code is

| Path | Holds |
| --- | --- |
| `hooks/register.tsx` | The entry point. It registers every hook and command. |
| `hooks/turn.ts` | The state of one turn: changes, test runs, reads, the log. |
| `hooks/classify.ts` | Static parsing of tool calls and Bash commands. |
| `hooks/tests-parse.ts` | One parser per test runner. |
| `hooks/trust.ts` | The Check flags. |
| `hooks/steps.ts`, `hooks/summary.ts` | Totals, folders, steps and the one-line summaries. |
| `hooks/draw/` | The card, the panes and the history list. |
| `tests/` | Tests that run in the Claude Code test kit, without a session. |

## Rules for a change

- **Render hooks stay pure.** A `ui.render` hook reads state and returns elements. It doesn't change state.
- **Parsing stays static.** TL;DR never runs a command to learn what a command did.
- **No network, no processes.** A change that needs either needs an issue first.
- **Every feature is a switch.** A new feature gets a `userConfig` entry in `.claude-plugin/plugin.json`, on by default.
- **A flag states a fact.** A Check flag says what happened, such as "tests/conftest.py changed in the turn that made tests pass". It doesn't guess at intent.
- **Add a test.** A new runner, command form or flag needs a test in `tests/`. A bug fix needs a test that fails before the fix.

## Send a pull request

1. Fork the repository and make a branch.
2. Make the change and add tests.
3. Run `claude plugin test .` and `claude plugin validate .`. Both must pass.
4. Update the README if the change shows to users.
5. Open the pull request. Say what changed, and add a screenshot for a change to the card.

By sending a pull request, you agree to license your change under the [MIT License](LICENSE).

## Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
