# Privacy

TL;DR for Claude Code collects no data and sends nothing anywhere.

- **No network.** The mod makes no network calls and starts no processes.
- **What it reads.** The tool calls and results of your Claude Code session, and the files Claude edits in that session, to build the TL;DR row and the net diff. It reads them on your machine only.
- **What it keeps.** Finished rows, at most 50 per session and without diff bodies, in Claude Code's local plugin store on your machine. Turn off the `keep` switch to keep nothing. In the same store, how long each Bash command took, at most 100 commands per project, so the band can compare the next run against it.
- **Notifications.** When a turn over 30 seconds ends, it raises a notification through your own Claude Code notification setting. Turn off the `notify` switch to stop it.
- **No accounts, no analytics, no third parties.**

Questions: open an issue at https://github.com/kushalBanda/claude-tldr/issues.
