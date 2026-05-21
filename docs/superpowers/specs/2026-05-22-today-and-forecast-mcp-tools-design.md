# v1.3.0 — `get_today_summary` and `forecast_monthly_spend` MCP tools

**Status:** Approved design. Not yet implemented.
**Author:** Anuj Ojha (via brainstorming session, 2026-05-22).
**Target release:** sipcode v1.3.0.
**Lineage:** continues the same product thread as `verify_sipcode_impact` (v1.2.0) — surface real, user-specific token economy answers directly in Claude Desktop chat.

---

## Why this exists

Today's 6 MCP tools (`get_sipcode_info`, `list_recent_sessions`, `audit_latest_session`, `get_project_manifest`, `estimate_task_cost`, `verify_sipcode_impact`) cover diagnostics, discovery, forensics, exploration, pre-flight pricing, and A/B proof-of-savings.

What they don't cover is the two questions a Claude Code user asks themselves **most frequently**:

1. *"How am I doing today?"* — a one-paragraph daily dashboard.
2. *"How much will this cost me by month-end?"* — a forward projection at current trajectory.

Both questions are answerable from data Sipcode already has on the user's local disk (the `.jsonl` Claude Code session files). Neither is currently surfaced in chat. Together they make Claude Desktop **the place a sipcode user opens every morning**, not just the place they go when they need a one-off audit.

## Goals (and non-goals)

**Goals:**

- One MCP tool answers "how am I doing today?" with a single paragraph + structured data.
- One MCP tool answers "how much by month-end?" with a projection + confidence band + last-month comparison.
- Both have matching CLI commands (`sipcode today`, `sipcode forecast`) for terminal users.
- Both adapt to whatever baseline window the user has data for (30 / 14 / 7 / 3 days), labeled honestly.
- Both never claim more precision than the data warrants — confidence bands, "all you have so far" labels, status fields for incomplete data.

**Non-goals (explicitly out of scope for v1.3.0):**

- Weekly or yearly trend tools.
- Project-grouped today summary (`sipcode stats --group-by project` already exists).
- Per-model breakdown.
- Active optimization tools (those are for v1.4+ if at all).
- Any change to existing 6 MCP tools.

---

## Architecture & module structure

Matches the established Sipcode pattern: pure runner + format-terminal + format-json + CLI wiring + MCP tool registration.

### New files

```
src/modules/today/
  types.ts              # TodaySummary, TodayBaseline, TodayComparison, TodayStatus
  runToday.ts           # pure runner: AggregatedSession[] + nowIso → TodaySummary
  format-terminal.ts    # one-paragraph + structured key/value rendering
  format-json.ts        # JSON shape, stable schemaVersion: "sipcode-today/1"

src/modules/forecast/
  types.ts              # ForecastReport, ForecastStatus
  runForecast.ts        # pure runner: AggregatedSession[] + nowIso → ForecastReport
  format-terminal.ts
  format-json.ts        # schemaVersion: "sipcode-forecast/1"

src/lib/baseline-window.ts
  # SHARED adaptive-window resolver.
  # Exports: resolveBaseline(sessions, now) → { windowDays, isPartial, label, sliceStartIso }
  # Cascade: 30d → 14d → 7d → 3d → "insufficient" (each tier requires ≥ that many days
  # of available history, where "available" = (now - earliestSession) ≥ tier).

src/commands/today.ts          # CLI: `sipcode today [--json]`
src/commands/forecast.ts       # CLI: `sipcode forecast [--json]`

src/lib/aggregate-loader.ts
  # NEW shared helper: loadAggregatedSessions({ fs, env, clock, agent })
  # Kills ~60 lines of duplication across impact.ts, stats.ts, and the
  # two new commands. Each command's orchestrator becomes 3 lines.
```

### Modified files

```
src/cli.ts                              # register `today` + `forecast` commands
src/mcp/server.ts                       # add 2 new tools (count 6 → 8)
src/commands/impact.ts                  # refactor to use loadAggregatedSessions (no behavior change)
src/commands/stats.ts                   # SAME refactor (optional, can stay opt-in)
tests/e2e/release-smoke.test.ts         # bump tool count expectation to 8
tests/mcp/server.integration.test.ts    # same
README.md                               # add `today` + `forecast` rows + MCP tool mentions
docs/MCP.md                             # add 7th + 8th tool docs
package.json                            # version 1.2.1 → 1.3.0
```

### Reused engine

Both tools call the **identical** session-discovery + parse + analyze + aggregate pipeline that `impact.ts` and `stats.ts` already use:

```
agent.discoverSessions → fs.readFile → agent.parseTranscript →
analyzeTokens + analyzeDuplicateReads + analyzeIdleContext →
aggregateSession() → AggregatedSession[]
```

The new `loadAggregatedSessions` helper wraps that whole chain. All three commands (impact, today, forecast) become thin orchestrators.

### Tool count regression guard

Updated assertion in `tests/e2e/release-smoke.test.ts`:

```ts
expect(r.toolNames.sort()).toEqual([
  "audit_latest_session",
  "estimate_task_cost",
  "forecast_monthly_spend",
  "get_project_manifest",
  "get_sipcode_info",
  "get_today_summary",
  "list_recent_sessions",
  "verify_sipcode_impact",
]);
```

Any future PR that drops or renames a tool fails CI before publish.

---

## Output shapes

### `get_today_summary` / `sipcode today`

**Terminal (CLI):**

```
sipcode today · Thu 2026-05-22

  spend so far          $0.42  across 3 sessions
  tokens so far        145.0K  output ratio 0.8%
  top leak              $0.11  4 re-reads of CLAUDE.md

vs your last 30 days (median):
  spend / day           $0.51  → today is 18% lower ↓
  tokens / day         178.0K  → today is 18% lower ↓
  output ratio           0.4%  → today is +0.4pp ↑  (rules are working)
```

**Headline string (Claude reads aloud in chat):**

> *"You've spent $0.42 today across 3 sessions — 18% below your 30-day median. Output ratio 0.8% (vs 0.4% baseline — Sipcode rules are working). Top leak: 4 re-reads of CLAUDE.md ($0.11)."*

**JSON shape:**

```json
{
  "schemaVersion": "sipcode-today/1",
  "status": "ok",
  "today": {
    "dateLocal": "2026-05-22",
    "sessionCount": 3,
    "totalSpendUSD": 0.42,
    "totalTokens": 145000,
    "outputRatioPct": 0.8,
    "topLeak": {
      "kind": "duplicate-reads",
      "description": "4 re-reads of CLAUDE.md",
      "costUSD": 0.11
    }
  },
  "baseline": {
    "windowDays": 30,
    "isPartial": false,
    "medianSpendPerDayUSD": 0.51,
    "medianTokensPerDay": 178000,
    "medianOutputRatioPct": 0.4
  },
  "comparison": {
    "spendDeltaPct": -17.6,
    "tokenDeltaPct": -18.5,
    "outputRatioDeltaPp": 0.4
  },
  "headline": "You've spent $0.42 today across 3 sessions — 18% below your 30-day median..."
}
```

### `forecast_monthly_spend` / `sipcode forecast`

**Terminal (CLI):**

```
sipcode forecast · projection to end of May 2026 (9 days remaining)

  current pace (last 14 days)
    avg daily spend     $4.20  across 24 sessions
    median daily spend  $3.95

  projected month-end
    spend               $280.50   (range: $255 – $306, 80% confidence)
    vs last month       12.4% less than April ($320.10)
```

**Headline string:**

> *"At your current pace ($4.20/day across 14 days of recent sessions), you're on track to spend about $280 by month-end — 12% less than April's $320. Confidence range: $255–$306."*

**JSON shape:**

```json
{
  "schemaVersion": "sipcode-forecast/1",
  "status": "ok",
  "trajectoryInput": {
    "windowDays": 14,
    "isPartial": false,
    "sessionsSampled": 24,
    "avgDailySpendUSD": 4.20,
    "medianDailySpendUSD": 3.95
  },
  "monthEnd": {
    "monthLabel": "May 2026",
    "daysRemaining": 9,
    "projectedSpendUSD": 280.50,
    "confidenceLowUSD": 255.20,
    "confidenceHighUSD": 305.80,
    "spendSoFarUSD": 113.70
  },
  "comparison": {
    "lastMonthSpendUSD": 320.10,
    "vsLastMonthPct": -12.4
  },
  "headline": "At your current pace ($4.20/day...), you're on track to spend about $280..."
}
```

### Confidence band math (forecast)

Approach: **standard deviation of the daily-spend distribution over the trajectory window**, clamped.

```
σ = stdev(dailySpend[1..N])
band = ±max(0, min(σ * daysRemaining, 0.20 * projected))
```

In practical terms: band is ±1σ of the daily spend variance, but never more than ±20% of the projected total. Stable for chunky users, never absurdly wide for spiky users. Honest signal that this is an estimate, not a prediction.

### Partial-baseline framing

When `windowDays < 30`, both tools label the window explicitly. Example:

> *"vs your last 12 days (all you have so far)"*

instead of pretending to compare against 30 days that don't exist. The `baseline.isPartial: true` JSON flag is the structured equivalent.

---

## Status enum (both tools)

Each tool exposes a `status` field that downstream consumers (Claude, scripts) can branch on. **Never throws — always returns a structured report.**

### `get_today_summary` statuses

| Status | When | Headline |
|---|---|---|
| `ok` | ≥1 session today AND ≥3 days of baseline data | Full comparison rendered. |
| `no-sessions-today` | 0 sessions today, baseline OK | "No sessions today yet. Your 30-day median is $0.51/day — go build something." |
| `no-baseline` | <3 days of total session history | "Showing today only — need 3+ days of history to compute a baseline." (comparison block omitted) |
| `no-data` | 0 sessions in `~/.claude/projects/` at all | "No Claude Code sessions found yet. Run `claude` in any project to start." |

### `forecast_monthly_spend` statuses

| Status | When | Headline |
|---|---|---|
| `ok` | ≥7 days of session history AND ≥2 days remaining in the month | Full projection + confidence band. |
| `insufficient-data` | <7 days of session history | "Forecast needs at least 7 days of session history. Currently have N." |
| `near-month-end` | ≤1 day remaining in the month | "May ends tomorrow. Spend so far: $X. Forecast not meaningful at this point." |
| `no-recent-activity` | No sessions in last 14 days | "No sessions in your last 14 days — can't forecast a trajectory." |
| `no-data` | 0 sessions in `~/.claude/projects/` | Same as today's `no-data`. |

---

## Edge cases (full table)

| Case | Behavior |
|---|---|
| No sessions today | `today.status = "no-sessions-today"`, baseline still rendered if available. |
| Brand-new user (<3 days history) | `today.status = "no-baseline"`, only today's data shown. |
| Partial baseline (12 days available, 30 wanted) | Adaptive cascade picks 14d (or whatever ≥7 tier matches), labels honestly. |
| Forecast with <7 days of data | `forecast.status = "insufficient-data"`, no projection rendered. |
| Near month-end (≤1 day remaining) | `forecast.status = "near-month-end"`. |
| No activity in 14 days (user paused) | `forecast.status = "no-recent-activity"`. |
| Timezone boundary | "Today" computed in user's local timezone (Node default). `.jsonl` stored UTC; we shift on the day boundary. Local date echoed in JSON: `dateLocal: "2026-05-22"`. |
| Top-leak source missing (clean session) | `topLeak: null`. Headline drops the leak clause. |
| Last-month comparison missing | `comparison.lastMonthSpendUSD: null`. Headline drops the comparison clause. |
| "Rules are working" callout | Only fires when output ratio improved AND `.sipcode/install-state.json` has a `rulesInstalledAt`. Avoids feeling pushy on users who haven't opted in. |

---

## Testing strategy

**Unit tests (pure runners, no I/O — fixture-driven):**

| Test file | Coverage |
|---|---|
| `tests/modules/today/runToday.test.ts` | All 4 `TodayStatus` branches. Baseline window cascade. Comparison delta math. Top-leak detection. |
| `tests/modules/today/format-terminal.test.ts` | Deterministic rendering. Partial-baseline labeling. Status-specific output. |
| `tests/modules/today/format-json.test.ts` | Schema version pinned. Round-trip JSON validity. |
| `tests/modules/forecast/runForecast.test.ts` | All 5 `ForecastStatus` branches. Linear projection. Confidence band = `±min(σ × daysRemaining, 0.20 × projected)` — tested at: stable daily spend (band shrinks), spiky daily spend (band hits 20% cap), single-day-of-data (σ=0, band=0). Last-month comparison present and absent. |
| `tests/modules/forecast/format-terminal.test.ts` + `format-json.test.ts` | Same pattern. |
| `tests/lib/baseline-window.test.ts` | Adaptive cascade: 30→14→7→3→insufficient. |
| `tests/lib/aggregate-loader.test.ts` | Shared session-loader against InMemoryFs fixtures. |

**Integration tests:**

| Test | Coverage |
|---|---|
| `tests/integration/today-flow.test.ts` | Full CLI: `sipcode today --json` against fixture-stuffed InMemoryFs. JSON round-trip. |
| `tests/integration/forecast-flow.test.ts` | Same for forecast. |

**E2E regression guards (`tests/e2e/release-smoke.test.ts`):**

- Boot-line assertion: `"8 tools"` instead of `"6 tools"`.
- Sorted-tool-list assertion: exact 8-element array.
- MCP server integration test bumped 6 → 8 as well.

**Privacy guard:** unchanged. Existing `tests/privacy/no-network.test.ts` covers all new files (they live under `src/`).

**Total test count projection:** 828 → ~860 (≈32 new tests).

---

## Privacy + safety

Both tools are pure read-only on local `.jsonl` files. No new file writes. No network calls. No telemetry. Privacy contract preserved end-to-end, asserted by the existing privacy-guard test.

---

## Open questions / known unknowns

None blocking. The design is fully specified.

Stylistic open items (not blocking implementation):

- Whether the "rules are working" callout should also recognize `hygieneInstalledAt` (currently only checks `rulesInstalledAt`). Will decide during implementation — both options preserve the "no pushy callouts if user hasn't opted in" rule.
- Whether to add a `--here` flag (scope to current cwd) to `sipcode today` mirroring `sipcode stats --here`. Out of scope for v1.3.0; can land in v1.3.1 if requested.

---

## Release plan

1. Implementation work (separate plan, created via writing-plans skill after this spec is approved).
2. All 5 gates pass locally (build + ~860 unit tests + e2e smoke + privacy + guards).
3. Commit + push to main as a single PR.
4. Tag `v1.3.0`, push tag → CI runs the full 5-gate release pipeline → publishes `sipcode@1.3.0` to npm.
5. Verify `npm view sipcode version` returns `1.3.0`.
6. Verify in Claude Desktop: ask *"how am I doing today?"* — should trigger `get_today_summary`. Ask *"how much will I spend this month?"* — should trigger `forecast_monthly_spend`.

---

## Sign-off

- **Brainstorm goal:** make Claude Desktop chat more valuable per session — confirmed.
- **Baseline window strategy:** adaptive (30→14→7→3→insufficient) — confirmed.
- **Architecture:** pure runner pattern + shared aggregate-loader helper — confirmed.
- **Output shapes:** one-paragraph headline + structured JSON + status enum — confirmed.
- **Edge cases:** 9 cases mapped, all return structured reports — confirmed.
- **Testing:** ~32 new tests, e2e tool-count guard updated to 8 — confirmed.

Next step: invoke `superpowers:writing-plans` to generate the implementation plan.
