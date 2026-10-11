# Codex limit tracking (piece 2 of Codex support): design

Date: 2026-10-11. Status: approved in conversation, awaiting written-spec review.
Ships as **v1.7.1** (patch bump, per the versioning policy).

## Goal

Answer three questions from the usage-limit readings Codex already writes into its local logs,
with zero network calls:

1. **When will I hit my limit?** For each limit the plan has: percent used, reset time, and
   at the current pace, when it runs out.
2. **What used up my limit?** Which sessions and projects used how much of each limit.
3. **Did my limit shrink?** How many tokens 1% of a limit buys over time, on the same model,
   with a cautious "possible limit cut" alert.

## Non-goals

- Claude Code limits: Claude Code's logs do not record them.
- Codex setup (AGENTS.md, MCP registration, hooks): piece 3.
- Any network call, including to OpenAI.

## What the data looks like (measured on the maintainer's 15 real rollouts)

- `event_msg` / `token_count` lines carry `payload.rate_limits`: `limit_id` (seen: `codex`,
  `premium`), `limit_name`, `plan_type` (seen: `go`), `primary` and `secondary` (each
  `{ used_percent, window_minutes, resets_at }` or `null`), `credits`
  (`{ has_credits, unlimited, balance }` or `null`), `rate_limit_reached_type`,
  `individual_limit`, `spend_control_reached`.
- 1,149 readings. `used_percent` is always a whole number (1% resolution). Window lengths
  seen: 10,080 min (weekly) and 43,200 min (30-day); other plans also have 300 min (5-hour).
  `secondary` was always `null` on this plan; 3 readings had `primary: null`.
- `resets_at` (epoch seconds) drifts between readings of the same period: exact on the weekly
  window, up to about 72 minutes on the 30-day window.
- Within one period `used_percent` never decreased in the weekly window; the 30-day window had 7
  decreases (period boundaries the old grouping missed, or concurrent sessions reporting
  slightly different values), so grouping must not assume monotonic readings.
- Finding that motivates question 3: weekly window, same model (gpt-5.4), similar cache share:
  about 425K tokens per 1% (week of Mar 28), 357K (Apr 1), 80K (Apr 13).
- One `codex-auto-review` request used about 3% of the 30-day limit.

## What users see

### `sipcode limits`

```
sipcode limits · Codex · plan: go · as of 2h ago (your last Codex request)

Weekly limit    62% used   resets Tue 14 Oct 14:00   at this pace: runs out Mon 13 Oct ~18:00
30-day limit    41% used   resets Sun 2 Nov          at this pace: lasts until reset

What used your weekly limit (since Tue 7 Oct)
  0199a1b2-c3d4-7a11   sipcode       19%   3.1M tokens
  0199a0f7-11aa-7b02   my-app        12%   1.4M tokens
  codex-auto-review (9 requests)      6%

Tokens per 1% of your weekly limit (gpt-5.4)
  Mar 28: 425K   Apr 1: 357K   Apr 13: 80K
  Possible limit cut around Apr 13: 4.5x fewer tokens per 1%.
  Limits cover your whole account. Codex use on other devices or in the cloud
  is not in these logs and can look like a cut.
```

- Shows only the windows the logs report (5-hour, weekly, 30-day, or any other length, named
  from `window_minutes`: 300 → "5-hour", 10,080 → "Weekly", 43,200 → "30-day", otherwise
  "N-hour"/"N-day").
- "as of" is the time of the newest reading; numbers are only as fresh as the last Codex request.
- "What used it" lists the current period of each window, top 5 sessions plus a
  `codex-auto-review` line when it used any, percentages to one decimal place when below 1%.
  A rise with no local request in between is shown as `unattributed (no Codex requests on this
  computer)`, since limits are shared with other devices and Codex cloud.
- The shrink section appears per window per model only when at least two comparable periods
  exist; the alert line only under the rule below.
- Options: `--json`; `--since <window>` (default 90d) for how far back the tokens-per-1% history
  goes; `--here` narrows only the "what used it" list to sessions whose cwd is in the current
  folder (limits are account-wide, so the rest is unchanged).
- `--agent claude-code` → E009-style "limits are recorded only by Codex" message, exit 1.
  `--agent` absent or `codex` → Codex.

### `today`

One extra line, only when Codex limit data exists and the newest reading is within the
current period of that window, for the window closest to running out:
`Codex weekly limit: 62% used, resets Tue 14:00. At this pace you run out Mon ~18:00.`
(or `... At this pace it lasts until the reset.`). No line otherwise: `today` output is
byte-identical when there is no Codex limit data. `today --json` schema is unchanged; the line
is terminal-only.

### MCP

New tool `get_codex_limits` (optional `since`), returning the same JSON as
`sipcode limits --json`. Registered tool count 15 → 16; the release smoke test asserts 16.

### Empty and error states

- No Codex installed, or no readings: `no Codex limit readings found yet (Codex records them
  after each request).` exit 0.
- Newest reading's `resets_at` already passed: the window shows `reset since your last Codex
  request (at <time>)` instead of a stale percentage, and no run-out estimate.
- Period started less than 1 hour before the newest reading: `not enough data yet for a pace`.
- At 100%: `limit reached, resets <time>`.
- `rate_limits` null or a window null: skipped, never an error.

## Architecture

Pure functions plus one command; each unit testable alone.

1. **`src/modules/agents/codex/rateLimits.ts`**: `scanCodexRateLimits(content, meta) →
   LimitReading[]`. Reads only lines containing `"rate_limits"`; returns
   `{ at (ms), sessionId, limitId, planType, windowMinutes, slot ("primary"|"secondary"),
   usedPercent, resetsAt (ms) }` per non-null window. Malformed lines skipped and counted.
2. **`src/modules/limits/periods.ts`**: `buildPeriods(readings) → LimitWindow[]`. Sorts all
   readings by time across files. Key = `limitId + windowMinutes`. A reading starts a new
   period when its `resetsAt` differs from the current period's by more than the drift
   tolerance (the larger of 15 minutes and 1% of the window: 15 min for 5-hour, about 1.7 h for
   weekly, 7.2 h for 30-day; real 30-day readings drift by about 72 minutes), or
   when its time is past the current period's `resetsAt`. Within a period the percent is the
   running maximum (a lower value from a concurrent session never lowers it). Period start =
   `resetsAt − windowMinutes`.
3. **`src/modules/limits/pace.ts`**: `projectRunOut(period, now) → { kind: "runs-out", at } |
   { kind: "lasts" } | { kind: "reached" } | { kind: "reset-since" } | { kind: "too-early" }`.
   Pace = percent used ÷ (newest reading time − period start). Run-out =
   newest reading time + (100 − percent) ÷ pace; "lasts" when that is after `resetsAt`.
4. **`src/modules/limits/attribute.ts`**: `attribute(period, readings, requests) →
   { sessionId, project, percent, tokens }[]`. Requests come from the existing Codex loader
   (deduped turns with timestamps, session id, model). Each rise in the running maximum between
   two consecutive readings of the window is split across all requests whose time falls in
   that interval, in proportion to their tokens (input + output). A rise with no request in
   the interval goes to an "unattributed (no local requests)" line. Per period, attributed +
   unattributed percent equals the observed rise exactly (floating sums, rounded only for
   display). `codex-auto-review` requests are grouped into their own line.
5. **`src/modules/limits/shrink.ts`**: `tokensPerPercent(periods, requests) → series per
   window per model`. Only finished periods (`resetsAt` before the newest reading) with at
   least 20% used and at least 90% of their tokens from one model. Tokens per 1% = tokens of
   requests in the period ÷ percent used. Alert rule: a comparable period whose tokens per 1%
   is at most half the median of at least two earlier comparable periods on the same model and
   window ("2x or more, against a baseline of 2+ periods"). The alert names the first such
   period. On the real data this is the Apr 13 week (80K against a 425K / 357K baseline).
   Wording always "Possible limit cut", plus the other-devices caveat.
6. **`src/commands/limits.ts`** + `src/modules/limits/format-terminal.ts` / `format-json.ts`;
   `today` line in `src/modules/today/format-terminal.ts`; MCP tool in `src/mcp/server.ts`;
   CLI registration in `src/cli.ts`; messages in `src/lib/messages.ts`.

Readings are scanned directly from rollout files (Codex logs are small: 43 MB on the
maintainer's machine); requests come from the existing usage loader, so dedupe rules and the
usage cache are reused unchanged.

## JSON shape (`limits --json`, new)

```json
{
  "agent": "codex",
  "planType": "go",
  "asOf": "2026-10-11T10:00:00.000Z",
  "windows": [
    {
      "limitId": "codex",
      "windowMinutes": 10080,
      "label": "Weekly",
      "usedPercent": 62,
      "resetsAt": "2026-10-14T08:30:00.000Z",
      "projection": { "kind": "runs-out", "at": "2026-10-13T12:30:00.000Z" },
      "usedBy": [{ "sessionId": "…", "project": "…", "percent": 19, "tokens": 3100000 }],
      "unattributedPercent": 0,
      "tokensPerPercent": [{ "model": "gpt-5.4", "periodStart": "…", "tokensPerPercent": 425000 }],
      "possibleCut": { "at": "2026-04-13", "factor": 4.5 }
    }
  ]
}
```

`project` is the folder name of the session's cwd only (never the full path).

## Testing and proof (release gate)

1. Unit tests per unit with synthetic readings: reset between readings, `resetsAt` drift,
   two concurrent sessions reporting different percents, 5-hour + weekly plan, null
   `rate_limits` / null window, 100% period, too-early period, reset-since.
2. The anonymised fixtures in `tests/fixtures/codex/` (timestamps and epochs already shifted
   consistently) used for an end-to-end test of `limits --json`.
3. `scripts/verify-counts.mjs` gains an independent limits computation (no Sipcode code) that
   must match Sipcode on real logs: newest percent per window, number of periods per window,
   and per period attributed + unattributed = observed rise.
4. Real data: the Apr 13 weekly drop shows as a possible cut; periods with mixed models are
   never compared.
5. `today` byte-identical with no Codex limit data; all existing `--json` outputs unchanged;
   MCP tool count 16 in unit and e2e tests.
6. Copy rules: no em-dashes, no hype, shrink always "possible".

## Risks

- **Account-wide limits, local-only logs.** Usage from other devices or Codex cloud raises the
  percent without local tokens: attribution shows it as "unattributed", and the shrink alert
  carries the caveat. This is the main source of false alerts; the cautious rule limits them.
- **Log format is not a stable interface.** Unknown fields ignored; missing windows skipped.
- **Model weighting.** OpenAI may weigh models differently against limits; comparisons stay
  within one model.
