---
name: sipcode-regress
description: Check the user's own local Claude Code and Codex logs for regressions after an update (prompt-cache misses, 5-minute cache TTL, uncached context, hourly cache rebuilds, Codex usage limit draining faster per token) and pin each one to the version that introduced it, using the Sipcode CLI. Use when the user asks whether Codex or Claude Code got worse or more expensive after an update, why their usage limit burns faster than before, or whether an update changed their costs.
---

# Did Codex or Claude Code get worse after an update?

Answer "is it the tool or is it me?" from the user's own logs on this computer, through the published `sipcode` command, with evidence they can attach to a bug report. Explicit instructions from the user take priority over this skill.

## Run Sipcode

1. Run the command for the question below straight away. Do not check the Sipcode version first: every extra command is another request that re-sends this whole chat. If the shell says `sipcode` is not found or not recognized, tell the user: "Sipcode is not installed. Run `npm i -g sipcode` once in a terminal, then ask again." and stop. If Sipcode says the command or an option is unknown, tell the user: "Your Sipcode is older than this plugin. Run `npm i -g sipcode@latest`, then ask again." and stop. Do not try `npx` (the sandbox usually blocks network access) and do not install anything yourself.
2. If the user asks about Codex or does not name a tool, run the Codex check once:

   ```bash
   sipcode regress --bug-report --agent codex
   ```

   It reads only the Codex logs in `~/.codex` (usually about a second) and compares each Codex version with the user's other versions.

   Run the Claude Code check only when the user explicitly asks about Claude Code: `sipcode regress --bug-report --agent claude-code`, or `sipcode regress --bug-report` (no `--agent`) when they ask about both tools. It reads `~/.claude/projects` (and `~/.codex` for both). Before running it, tell the user the first run can take a minute or more on large Claude Code logs. Give the command a timeout of at least 3 minutes. Use no other options.

   A run cut off by a timeout prints nothing, and empty output is never a result: if the command returns no output at all, run it again with a longer timeout before answering.
3. If the sandbox blocks a log folder (the output says "Not found or not readable", prints a WARNING that files could not be read, or the command exits with code 2), request permission to run the same command again with read access to those folders, for example by running it outside the sandbox. Do not report a result from a blocked run.
4. Never open, read, search or summarise the log files yourself, and never paste their contents. Work only from Sipcode's output.

## Report the result

1. Start with the coverage lines, quoted exactly as printed: requests, sessions, date range and versions, and (for Claude Code) which known-regression windows the logs cover.
   - If the output says "Nothing to analyse", or the command exited with code 2, tell the user no logs could be read and that this is not a clean result. Never say "no regressions".
   - If it prints a WARNING that files could not be read, say the result is partial and ask the user to allow read access, then run it again.
   - If it says "Not enough data to compare versions yet", say that, and that it is not a clean result either.
   - If it prints "Not enough data to compare Codex versions yet" or "Not enough data to compare Claude Code versions yet", that tool was read but not compared: say so, and do not include it in "no regressions".
2. If there are findings, list each one with its versions, the evidence numbers and whether it matches a known, confirmed issue (R1 to R5). Quote numbers exactly as printed (they are already rounded for display); do not round or recompute them, and never invent one.
3. A finding not in the known-issue catalog is a signal worth reporting, not proof of a bug. Say so plainly.
4. A Codex finding ("Codex rate limit drains faster per token") could also be a limit change on the user's plan at the same time as the update, and Codex use on other devices or in the cloud shares the same limit: always say so, and call any limit change "possible".
5. If there are no findings, say "No regressions detected in your logs" for the tools that were compared, and repeat the coverage, so the user knows what was checked. Do not speculate about causes.
6. Offer the bug-report block (after "paste into a GitHub issue") for a GitHub issue. It holds token counts, versions, dates and short session ids only, never prompts or code. Tell the user to review it before posting.

## Rules

- Never say the model was "nerfed". Sipcode measures cache, token and limit behaviour, not answer quality.
- Subagent and Agent SDK runs are left out on purpose, because their cache policy differs by design. If the user asks, explain this.
- Codex versions are compared only with other versions on the same plan and limit window, whatever the model. If a Codex finding notes that the version ran a different model, say the model may explain the difference. If the plan or window changed, a missing finding does not mean nothing changed.
