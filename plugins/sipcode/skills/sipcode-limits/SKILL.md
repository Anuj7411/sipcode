---
name: sipcode-limits
description: Report how close the user is to their Codex usage limits (5-hour, weekly or 30-day), when they run out at the current pace, what used them, and whether a limit may have shrunk, from the limit readings in their local Codex logs, using the Sipcode CLI. Use when the user asks how close they are to their Codex limit, when it resets, what used it up, or whether their limit got smaller.
---

# Codex usage limits

Answer from the limit readings Codex writes into its own logs on this computer, through the published `sipcode` command. Explicit instructions from the user take priority over this skill.

## Run Sipcode

1. Run `sipcode --version`. If the command is not found, tell the user: "Sipcode is not installed. Run `npm i -g sipcode` once in a terminal, then ask again." and stop. Do not try `npx` (the sandbox usually blocks network access) and do not install anything yourself. If the version is lower than 1.7.2, tell the user to run `npm i -g sipcode@latest` and stop.
2. Sipcode reads `~/.codex` (or the folder `CODEX_HOME` points to). If the sandbox blocks that folder (a permission error, or a result that says no sessions while the user clearly uses Codex), request permission to run the same command again with read access to that folder, for example by running it outside the sandbox. Do not report an empty result caused by the sandbox.
3. Never open, read, search or summarise the log files yourself, and never paste their contents. Work only from Sipcode's output.

## Pick one command

| The user asks about | Run |
|---|---|
| how close they are, when it resets, what used it | `sipcode limits --json` |
| whether a limit shrank, or the history | `sipcode limits --json --since all` |

Run it once. Lines Sipcode prints on stderr that start with `note:` are part of the answer.

## Report the result

- Quote numbers exactly as Sipcode prints them. Do not round or recompute them.
- If `windows` is empty, say Sipcode found no Codex limit readings yet (Codex records them after each request).
- For each window: its `label` (for example "Weekly"), `usedPercent`, and `resetsAt`. Then `projection.kind`: `runs-out` (say when: `projection.at`), `lasts` (it lasts until the reset at this pace), `reached` (the limit is used up), `reset-since` (it has reset since the last reading, so the old percent no longer applies), `too-early` (too soon after the reset to judge the pace).
- `asOf` is the user's last Codex request: the percent is only as fresh as that.
- What used it: the sessions in `usedBy` (folder names and percent). `unattributedPercent` is use with no request on this computer: Codex on another device or in the cloud.
- Did it shrink: `tokensPerPercent` lists how many tokens 1% bought in each finished period. If `possibleCut` is not null, say "a possible limit cut" around `possibleCut.at`, about `possibleCut.factor` times fewer tokens per 1%, and always add that Codex use on other devices or in the cloud raises the percent without local tokens, so it can look like a cut. Never say it is confirmed, and never say Codex was "nerfed".
