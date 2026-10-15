---
name: sipcode-spend
description: Report how much the user spent on Codex (tokens and cost at API prices) today, this month, the projected month end, or over a period, from their local Codex logs, using the Sipcode CLI. Use when the user asks how much they spent on Codex, how many tokens Codex used today or this month, or what this month will cost.
---

# Codex spend

Answer from the user's own Codex logs on this computer, through the published `sipcode` command. Explicit instructions from the user take priority over this skill.

## Run Sipcode

1. Run the command for the question below straight away. Do not check the Sipcode version first: every extra command is another request that re-sends this whole chat. If the shell says `sipcode` is not found or not recognized, tell the user: "Sipcode is not installed. Run `npm i -g sipcode` once in a terminal, then ask again." and stop. If Sipcode says the command or an option is unknown, tell the user: "Your Sipcode is older than this plugin. Run `npm i -g sipcode@latest`, then ask again." and stop. Do not try `npx` (the sandbox usually blocks network access) and do not install anything yourself.
2. Sipcode reads `~/.codex` (or the folder `CODEX_HOME` points to). If the sandbox blocks that folder (a permission error, or a result that says no sessions while the user clearly uses Codex), request permission to run the same command again with read access to that folder, for example by running it outside the sandbox. Do not report an empty result caused by the sandbox.
3. Never open, read, search or summarise the log files yourself, and never paste their contents. Work only from Sipcode's output.

## Pick one command

| The user asks about | Run |
|---|---|
| today | `sipcode today --agent codex --json` |
| this month, month end, "what will this month cost" | `sipcode forecast --agent codex --json` |
| a period: last 7 days, since a date, all time | `sipcode stats --agent codex --since 7d --json` (use `7d`, `30d`, `90d`, `all` or a `yyyy-mm-dd` date) |

Run it once. Lines Sipcode prints on stderr that start with `note:` are part of the answer. If Sipcode prints a line starting "warning:" that log files could not be read, say it first in your answer, as printed: the numbers leave those logs out. With `--json` the same thing comes on stderr as a `note:` that log files or folders could not be read or parsed, or that compressed logs were skipped: say that first too.

## Present numbers

The JSON holds raw values such as `3.2481702571428572`, `88.99999999999999` or `2026-10-14T06:25:29.384Z`. Show them the way Sipcode's own terminal output does:

- Dollars to the cent: `$3.25`. An amount above zero but below one cent is "under $0.01".
- Percents as whole numbers: `89%`. Below 1%, one decimal (`0.4%`); above zero but below 0.1% is "under 0.1%". The output ratio (`outputRatioPct`) keeps one decimal, as the terminal shows it: `3.7%`. A change against the usual day of less than 0.5% is "about the same as usual".
- Tokens with thousands separators: `107,733`. For large totals the compact form the terminal uses is fine: `3.1M`, `425K`.
- Dates written out: `Wed 14 Oct`. Never show an ISO string such as `2026-10-14T06:25:29.384Z`. JSON times are in UTC: give a time of day only converted to the user's local time zone, and leave it out if you do not know that zone.
- Never change a number beyond this rounding, and never invent, add up or recompute one. If a value is null or missing, say it is not available.

## Report the result

- Dollar amounts are what the tokens would cost at OpenAI's API prices. On a ChatGPT plan the user is not billed per token: say "at API prices", never "you were charged".
- `today`: give `today.totalSpendUSD` and `today.totalTokens`, then the comparison with the usual day (`comparison.spendDeltaPct` against `baseline.medianSpendPerDayUSD`). If `status` is `no-sessions-today`, `no-baseline` or `no-data`, say that plainly (no Codex use today, not enough history to compare, or no Codex logs).
- `forecast`: give `monthEnd.spendSoFarUSD`, then `monthEnd.projectedSpendUSD` with its range (`confidenceLowUSD` to `confidenceHighUSD`), and last month when `comparison.lastMonthSpendUSD` is not null. If `status` is not `ok`, say what it means (too little data, too close to month end, no recent activity, or no data) instead of giving a projection.
- `stats`: give `totals.estCostUSD`, `totals.totalTokens` and `sessionCount` for the window, then `topExpensive` if the user asked which sessions cost most.
- If Sipcode says some tokens are on models without a known price, say that those tokens are counted but not in the dollar figure.
- Do not speculate about causes. If the user wants to know why a session cost so much, that is the sipcode-why skill.
