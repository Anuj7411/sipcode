---
name: sipcode-why
description: Explain why a Codex session used so many tokens (largest requests, files read more than once, context carried while idle) from the user's local Codex logs, using the Sipcode CLI. Use when the user asks why their last Codex session was so expensive, where the tokens went, or what made a session cost so much.
---

# Why a Codex session was expensive

Answer from the user's own Codex logs on this computer, through the published `sipcode` command. Explicit instructions from the user take priority over this skill.

## Run Sipcode

1. Run `sipcode --version`. If the command is not found, tell the user: "Sipcode is not installed. Run `npm i -g sipcode` once in a terminal, then ask again." and stop. Do not try `npx` (the sandbox usually blocks network access) and do not install anything yourself. If the version is lower than 1.7.2, tell the user to run `npm i -g sipcode@latest` and stop.
2. Sipcode reads `~/.codex` (or the folder `CODEX_HOME` points to). If the sandbox blocks that folder (a permission error, or a result that says no sessions while the user clearly uses Codex), request permission to run the same command again with read access to that folder, for example by running it outside the sandbox. Do not report an empty result caused by the sandbox.
3. Never open, read, search or summarise the log files yourself, and never paste their contents. Work only from Sipcode's output.

## Pick one command

| The user asks about | Run |
|---|---|
| the last (most recent) session | `sipcode why --agent codex --json` |
| a specific session | `sipcode why --agent codex --list` to find its id, then `sipcode why --agent codex --session <id> --json` |

The session you are in right now is also a Codex session: if the user means an earlier one, use `--list` and ask which one when it is not clear. Lines Sipcode prints on stderr that start with `note:` are part of the answer.

## Present numbers

The JSON holds raw values such as `3.2481702571428572` or `88.99999999999999`. Show them the way Sipcode's own terminal output does:

- Dollars to the cent: `$3.25`. An amount above zero but below one cent is "under $0.01".
- Percents as whole numbers: `89%`. Below 1%, one decimal (`0.4%`); above zero but below 0.1% is "under 0.1%". The output ratio (`punchline.outputRatioPct`) keeps one decimal, as the terminal shows it: `3.7%`.
- Tokens with thousands separators: `107,733`. For large totals the compact form the terminal uses is fine: `3.1M`, `425K`.
- Dates written out: `Wed 14 Oct`. Never show an ISO string such as `2026-10-14T06:25:29.384Z`.
- Never change a number beyond this rounding, and never invent, add up or recompute one. If a value is null or missing, say it is not available.

## Report the result

- Start with the session (`header`), its total tokens (`punchline.totalTokens`) and cost at API prices (`totals.estCostUSD`). On a ChatGPT plan the user is not billed per token: say "at API prices".
- `punchline.outputTokens` are output: the text, code and reasoning the model wrote. `punchline.nonOutputTokens` are the context sent with each request: every request re-sends the conversation so far, and the part read from cache (`totals.cacheReadTokens`) costs a fraction of the input price. `punchline.oneLiner` says this in one line. Report it that way, and never call them exploration, re-reads or idle context.
- `punchline.outputRatioPct` is output as a share of the tokens not read from cache (cache reads are left out), so it is not `outputTokens` divided by `totalTokens`. Say "of the tokens not read from cache" when you give it.
- Then where the tokens went, largest first: `topExpensive` (the largest requests and the tool call each one made), `duplicates` (files read more than once, with the tokens the re-reads cost), `idle` (files kept in context without being used), and `topLeaks`.
- A `topExpensive` row's `tokens` are the whole request's: mostly the conversation context sent with it, plus its output, split evenly when one request made several tool calls. Say "the request that called <toolName> (<label>) used N tokens, mostly context"; never say a tool call used or cost those tokens.
- `estimatedSavings` describes what Sipcode's setup saves in Claude Code. Sipcode does not act inside Codex, so do not present it as a saving the user can get in Codex.
- Do not speculate beyond the output. If the user asks whether Codex itself got more expensive after an update, that is the sipcode-regress skill.
