---
name: sipcode-limits
description: Report how close the user is to their Codex usage limits (5-hour, weekly or 30-day), when they run out at the current pace, what used them, and whether a limit may have shrunk, from the limit readings in their local Codex logs, using the Sipcode CLI. Use when the user asks how close they are to their Codex limit, when it resets, what used it up, or whether their limit got smaller.
---

# Codex usage limits

Answer from the limit readings Codex writes into its own logs on this computer, through the published `sipcode` command. Explicit instructions from the user take priority over this skill.

## Run Sipcode

1. Run `sipcode --version`. If the command is not found, tell the user: "Sipcode is not installed. Run `npm i -g sipcode` once in a terminal, then ask again." and stop. Do not try `npx` (the sandbox usually blocks network access) and do not install anything yourself. If the version is lower than 1.7.2, tell the user to run `npm i -g sipcode@latest` and stop.
2. Sipcode reads `~/.codex` (or the folder `CODEX_HOME` points to). If the sandbox blocks that folder (a permission error, or a result that says no readings while the user clearly uses Codex), request permission to run the same command again with read access to that folder, for example by running it outside the sandbox. Do not report an empty result caused by the sandbox.
3. Never open, read, search or summarise the log files yourself, and never paste their contents. Work only from Sipcode's output.

## Pick one command

| The user asks about | Run |
|---|---|
| how close they are, when it resets, what used it | `sipcode limits` |
| whether a limit shrank, or the history | `sipcode limits --since all` |

Run it once, without `--json`. This answer is mostly times (resets, run-out estimates), and Sipcode prints them in the user's local time zone, which it reads from this computer; the JSON has UTC timestamps and unrounded values that you would have to convert. Lines Sipcode prints on stderr that start with `note:` are part of the answer.

## Present numbers

The output is already rounded the way Sipcode shows it: whole percents (one decimal below 1%), compact token counts (`3.1M`, `425K`) and local times such as `Wed 14 Oct 11:55` or `Sun 2 Nov`. A `~` marks an estimate, rounded to the hour.

- Use the numbers and times as printed. Never show an ISO string, and do not convert a time to another time zone.
- Never change a number beyond this rounding, and never invent, add up or recompute one.

## Report the result

- If it prints "no Codex limit readings found yet", say Sipcode found no Codex limit readings yet (Codex records them after each request).
- The first line ends with "as of ... (your last Codex request)": the percents are only as fresh as that request.
- One line per limit window, for example "Weekly limit  92% used  resets Wed 14 Oct 11:55  at this pace: runs out Mon 13 Oct ~18:00". Say how much is used, when it resets, and what the line says about the pace:
  - "runs out ...": at this pace the limit runs out then (an estimate).
  - "lasts until reset": at this pace it lasts until the reset.
  - "limit reached": the limit is used up until the reset.
  - "not enough data yet for a pace": too soon after the reset to judge the pace.
- A limit that has reset has no percent on its line. Say what the line says, in plain words, and never give a percent for that limit (any percent from before the reset belongs to the period that ended):
  - "no readings since it reset (Mon 20 Apr)": "Your weekly limit reset on Mon 20 Apr, and Codex has not reported it since, so there is no current reading for it."
  - "reset since your last Codex request (at Wed 14 Oct 11:55)": "Your 5-hour limit reset at Wed 14 Oct 11:55, after your last Codex request, so a new period has started. Your next Codex request will show how much of it is used."
- What used it: the list under "What used your weekly limit (since Mon 13 Oct)" is what used this limit in the current period, from that day: up to five sessions (short id and folder name), the part of the limit each one used (in percent of the whole limit, so the lines add up to no more than the percent used, not to 100%) and its tokens. "codex-auto-review" is Codex's automatic code reviews. "unattributed" is use with no request on this computer: Codex on another device or in the cloud. A limit that has reset has no such list.
- Did it shrink: "Tokens per 1% of your ... limit" lists how many tokens 1% bought in each finished period. If it prints "Possible limit cut around ...", say "a possible limit cut" around that date, about that many times fewer tokens per 1%, and always add that Codex use on other devices or in the cloud raises the percent without local tokens, so it can look like a cut. Never say it is confirmed, and never say Codex was "nerfed".
