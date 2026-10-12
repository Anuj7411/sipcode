---
name: sipcode-spend
description: Report how much the user spent on Codex (tokens and cost at API prices) today, this month, the projected month end, or over a period, from their local Codex logs, using the Sipcode CLI. Use when the user asks how much they spent on Codex, how many tokens Codex used today or this month, or what this month will cost.
---

# Codex spend

Answer from the user's own Codex logs on this computer, through the published `sipcode` command. Explicit instructions from the user take priority over this skill.

## Run Sipcode

1. Run `sipcode --version`. If the command is not found, tell the user: "Sipcode is not installed. Run `npm i -g sipcode` once in a terminal, then ask again." and stop. Do not try `npx` (the sandbox usually blocks network access) and do not install anything yourself. If the version is lower than 1.7.2, tell the user to run `npm i -g sipcode@latest` and stop.
2. Sipcode reads `~/.codex` (or the folder `CODEX_HOME` points to). If the sandbox blocks that folder (a permission error, or a result that says no sessions while the user clearly uses Codex), request permission to run the same command again with read access to that folder, for example by running it outside the sandbox. Do not report an empty result caused by the sandbox.
3. Never open, read, search or summarise the log files yourself, and never paste their contents. Work only from Sipcode's output.

## Pick one command

| The user asks about | Run |
|---|---|
| today | `sipcode today --agent codex --json` |
| this month, month end, "what will this month cost" | `sipcode forecast --agent codex --json` |
| a period: last 7 days, since a date, all time | `sipcode stats --agent codex --since 7d --json` (use `7d`, `30d`, `90d`, `all` or a `yyyy-mm-dd` date) |

Run it once. Lines Sipcode prints on stderr that start with `note:` are part of the answer.

## Report the result

- Quote numbers exactly as Sipcode prints them. Do not round, add up or recompute them.
- Dollar amounts are what the tokens would cost at OpenAI's API prices. On a ChatGPT plan the user is not billed per token: say "at API prices", never "you were charged".
- `today`: give `today.totalSpendUSD` and `today.totalTokens`, then the comparison with the usual day (`comparison.spendDeltaPct` against `baseline.medianSpendPerDayUSD`). If `status` is `no-sessions-today`, `no-baseline` or `no-data`, say that plainly (no Codex use today, not enough history to compare, or no Codex logs).
- `forecast`: give `monthEnd.spendSoFarUSD`, then `monthEnd.projectedSpendUSD` with its range (`confidenceLowUSD` to `confidenceHighUSD`), and last month when `comparison.lastMonthSpendUSD` is not null. If `status` is not `ok`, say what it means (too little data, too close to month end, no recent activity, or no data) instead of giving a projection.
- `stats`: give `totals.estCostUSD`, `totals.totalTokens` and `sessionCount` for the window, then `topExpensive` if the user asked which sessions cost most.
- If Sipcode says some tokens are on models without a known price, say that those tokens are counted but not in the dollar figure.
- Do not speculate about causes. If the user wants to know why a session cost so much, that is the sipcode-why skill.
