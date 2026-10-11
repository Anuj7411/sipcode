# Codex Limit Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `sipcode limits` (and one line in `sipcode today`, and the MCP tool `get_codex_limits`) answers, from the usage-limit readings Codex already writes into its local logs and with zero network calls: when will I hit my Codex limit, what used it, and did it shrink.

**Architecture:** Pure units, each tested alone: a rollout scanner (`scanCodexRateLimits`) turns `rate_limits` lines into readings; `buildPeriods` groups readings into windows and periods; `projectRunOut` gives the pace; `attribute` splits each rise of the percent across local requests; `tokensPerPercent` builds the per-model history and the cautious cut flag; `buildLimitsReport` / `pickTodayWindow` assemble them; two formatters render terminal and JSON. One command (`src/commands/limits.ts`) wires disk to the units: readings are scanned straight from the rollouts Codex discovery lists, requests come from the existing `loadSessions` (same dedupe, same usage cache). `today` and the MCP server reuse the same modules.

**Tech Stack:** TypeScript 5.5 (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Node >= 20, Commander 12, Vitest 2, zod 3, `@modelcontextprotocol/sdk` 1.29. I/O behind the `FileSystem` / `ProcessEnv` / `Clock` seams (`InMemoryFs`, `FakeProcessEnv`, `FakeClock` in tests).

**Spec:** `docs/superpowers/specs/2026-10-11-codex-limit-tracking-design.md`. **Branch:** `codex-limits`. Ships as **v1.7.1** (patch bump).

---

## Decisions this plan makes

The spec is followed exactly except where it is silent, or where the maintainer's real logs (15 rollouts, 1,146 readings, checked while writing this plan) show it would give wrong numbers. Each decision below is pinned by a unit or integration test, and 1 to 4 also by the real-data checks in Tasks 12 and 14. Decisions 1 and 2 change rules the approved spec states: the maintainer should confirm them before this ships (to follow the spec literally instead, drop the third condition in `startsNewPeriod` and the "skip readings that do not rise" behaviour in `attribute`, and update their tests).

1. **Early reset starts a new period (addition to the period rule).** On the real 30-day window the limit reached 100% and then read 5% with a reset time 76 minutes later, and again 129 minutes later. The spec read those shifts as "drift of about 72 minutes", but they are resets: inside the 7.2-hour tolerance they would merge three fills into one period at 100% (tokens per 1% about 3x too high). True drift between readings was at most 66 seconds. Rule added: a reading whose reset time is more than 15 minutes later than the period's **and** whose percent is below the period's running maximum starts a new period. The spec's tolerance (max(15 min, 1% of the window)) and its other two rules are kept unchanged. Result on real data: 5 periods on the 30-day window (not 3), 3 on the weekly window.
2. **A rise is shared by the requests since the previous rise (not the previous reading).** Older Codex versions refresh the limit only when a turn starts, so the rise shows on the first reading of the next turn, after the requests that caused it. With the spec's "between two consecutive readings" interval, 100% of the real weekly usage (Mar to Apr) came out "unattributed (no Codex requests on this computer)", which is false. With "since the previous rise": 60/60, 100/100 and 89/92 attributed; the 30-day periods are unchanged. It is also more correct for current Codex, where several small requests add up to one 1% step. Attributed + unattributed still equals the percent exactly.
3. **"Finished" = reset time before the newest reading of any window** (`asOf`), **or a later period of the same window exists** (a period ended by an early reset keeps a reset time after every reading). The real Apr 13 weekly period has no later weekly reading (the plan moved to a 30-day window), so a per-window "newest reading" would never finish it and the spec's own Apr 13 alert could not fire.
4. **Cut factor = baseline median ÷ the flagged period's tokens per 1%**, to one decimal (the quantity the 2x rule tests). Real data: 391,022 ÷ 77,401 = 5.05, shown as **5.1x** (public copy says "about 5x": 5.05 sits on a rounding boundary) (the spec's 4.5x example used rounded illustrative numbers).
5. **Observed rise of a period = its percent** (the period start counts as 0%), so "what used it" plus "unattributed" adds up to the percent shown.
6. **Tokens of a period** = requests in (period start, newest reading]; requests before the start or after the newest reading belong to no rise.
7. **JSON:** the spec's shape plus one field, `periodCount`, because the independent checker must compare the number of periods (spec "Testing and proof" item 3) and imports nothing from Sipcode. `usedBy` lists every session of the newest period (percent may be 0), then codex-auto-review as `{ "sessionId": "codex-auto-review", "project": null, ... }` when it used any of the limit. `possibleCut.at` is the flagged period's start date (UTC). No readings: `{ "agent": "codex", "planType": null, "asOf": null, "windows": [] }`, exit 0 (the terminal prints the spec's message instead).
8. **Reset since:** the terminal hides the stale percent (spec) and also the "what used it" list for that window (that period is over); JSON keeps the last period's numbers with `projection.kind: "reset-since"`.
9. **`today` line:** printed at the end of the Codex section only (the line is about Codex; `--agent claude-code` shows none). "Closest to running out" = among windows not reset since: a reached limit first, then the earliest run-out time; with no run-out anywhere, the highest percent; ties go to the shorter window.
10. **Times** are local. Within a week of now a time shows its hour ("Wed 14 Oct 14:00", today: "Wed 14:00"), otherwise the date only ("Mon 2 Nov"). Run-out times are rounded to the nearest local hour and marked "~".
11. `--agent cursor` gets the same E009 as `claude-code`. `--since` reuses the stats parser (`7d`, `90d`, `all`, `yyyy-mm-dd`); its E010 message names `limits`. Malformed reading lines are skipped and counted in one stderr note.
12. **Signatures.** `scanCodexRateLimits` returns `{ readings, malformed }` (the spec says malformed lines are "skipped and counted"); `attribute(period, requests)` takes no separate readings because a period carries its own points. Two extra pure units: `report.ts` (assembly, window labels, the `today` pick) and `load.ts` (the only disk access of the limits module).
13. **No new stored data.** `limits` reads the Codex logs read-only and uses the existing usage cache (`~/.sipcode/usage-cache/codex.json`, same content). PRIVACY.md only gains `limits` in two lists.

---

## Conventions for every task

- Files in this working tree have CRLF line endings. Edit existing files with the Edit tool (it matches text, not line endings). New files may use LF.
- Run one test file with `npx vitest run <path>`; the typecheck with `npm run lint`. Run anything longer than a minute (`npx vitest run`, `npm run test:e2e`, `verify-counts`, copying logs) with `run_in_background` and wait for it.
- Tests that check local times set `process.env.TZ = "UTC"` in `beforeAll` and restore it in `afterAll` (Node reads TZ at call time).
- Copy rules for every user-facing string: no em dashes or en dashes as dashes, no hype, a shrink is always "possible".
- Commit after each task: `git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`. Do not push, do not tag.
- Shell commands are Git Bash. Before Tasks 12, 14 and 15 set `SCRATCH="$(cygpath -m "<session scratchpad directory>")"` (never a folder inside the repo). `cygpath -m` gives `C:/...` paths, which both Bash and Node accept, so the paths below can be passed to `node` in environment variables as they are.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/modules/agents/codex/rateLimits.ts` | create | `scanCodexRateLimits(content, meta)`: `rate_limits` lines of one rollout → `LimitReading[]` + malformed count |
| `src/modules/limits/periods.ts` | create | `buildPeriods(readings)`: windows (limit id + length) and their periods; running maximum; `compareReadings`, `driftToleranceMs` |
| `src/modules/limits/pace.ts` | create | `projectRunOut(period, now)`: runs-out / lasts / reached / reset-since / too-early |
| `src/modules/limits/attribute.ts` | create | `attribute(period, requests)`: each rise split by tokens; `summarizeShares` per session + codex-auto-review line; `folderName`; `requestsInPeriod` |
| `src/modules/limits/shrink.ts` | create | `tokensPerPercent(window, requests, opts)`: comparable periods per model and the possible cut |
| `src/modules/limits/report.ts` | create | `windowLabel`, `buildLimitsReport`, `newestReading`, `pickTodayWindow` |
| `src/modules/limits/format-terminal.ts` | create | `formatLimitsTerminal`, `formatTodayLimitLine` and the time / token / percent helpers |
| `src/modules/limits/format-json.ts` | create | `formatLimitsJson` (also the MCP tool's text) |
| `src/modules/limits/load.ts` | create | Disk side: `loadCodexReadings`, `limitRequests` (loadSessions `analyze`), `todayLimitLine` |
| `src/commands/limits.ts` | create | `runLimits(opts, deps)`: flags, empty / error states, wiring |
| `src/lib/messages.ts` | modify | `limitsCodexOnly`, `limitsNoReadings`, `limitsMalformed`; `statsBadSince` takes the command name |
| `src/cli.ts` | modify | Register `limits` and its help text |
| `src/modules/today/format-terminal.ts` | modify | Optional `limitLine`, printed last |
| `src/commands/today.ts` | modify | Codex section: compute the line in terminal mode |
| `src/mcp/server.ts` | modify | `toolGetCodexLimits`, the `get_codex_limits` definition and dispatch case; 16 tools |
| `scripts/verify-counts.mjs` | modify | Independent limits computation compared with `limits --json --since all` |
| `tests/integration/codex-fixtures.ts` | modify | Optional `limit` per turn; weekly and shrink scenarios |
| `tests/modules/agents/codex/rateLimits.test.ts`, `tests/modules/limits/*.test.ts`, `tests/modules/today/format-terminal.test.ts`, `tests/integration/limits.integration.test.ts`, `tests/integration/today-limits.integration.test.ts`, `tests/mcp/codex-limits.test.ts` | create | Tests per unit, command, today line, MCP tool |
| `tests/mcp/agent-param.test.ts`, `tests/mcp/server.integration.test.ts`, `tests/e2e/release-smoke.test.ts`, `tests/e2e/mcp-import-side-effect.test.ts` | modify | Tool count 16, `get_codex_limits`, `limits` in `--help` |
| `README.md`, `CHANGELOG.md`, `PRIVACY.md`, `package.json` (description), `docs/site/public/llms.txt`, `docs/site/public/llms-full.txt`, `docs/site/src/components/{FaqSection,LayersSection}.astro` | modify | Docs, 15 → 16 tools |
| `package.json`, `package-lock.json`, `server.json`, `docs/site/src/components/{Hero,Footer}.astro`, llms files, README badge | modify | v1.7.1 and the test count (release task) |

---

### Task 1: Codex rate-limit scanner

**Files:**
- Create: `src/modules/agents/codex/rateLimits.ts`
- Test: `tests/modules/agents/codex/rateLimits.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanCodexRateLimits } from "../../../../src/modules/agents/codex/rateLimits.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(path.resolve(__dirname, "../../../fixtures/codex", name), "utf-8");

const tokenCount = (timestamp: string | undefined, rate_limits: unknown): string =>
  JSON.stringify({ timestamp, type: "event_msg", payload: { type: "token_count", info: null, rate_limits } });

const win = (used_percent: number, window_minutes: number, resetsIso: string) => ({
  used_percent,
  window_minutes,
  resets_at: Date.parse(resetsIso) / 1000,
});

const T = "2026-10-07T10:00:00.000Z";

describe("scanCodexRateLimits", () => {
  it("returns one reading per non-null window, times in ms", () => {
    const content = [
      JSON.stringify({ timestamp: "2026-10-07T09:00:00.000Z", type: "session_meta", payload: { id: "s1" } }),
      tokenCount(T, {
        limit_id: "codex",
        limit_name: null,
        plan_type: "plus",
        primary: win(12, 300, "2026-10-07T14:00:00.000Z"),
        secondary: win(40, 10080, "2026-10-14T08:30:00.000Z"),
        credits: null,
      }),
    ].join("\n");
    const r = scanCodexRateLimits(content, { sessionId: "s1" });
    expect(r.malformed).toBe(0);
    expect(r.readings).toEqual([
      {
        at: Date.parse(T),
        sessionId: "s1",
        limitId: "codex",
        planType: "plus",
        windowMinutes: 300,
        slot: "primary",
        usedPercent: 12,
        resetsAt: Date.parse("2026-10-07T14:00:00.000Z"),
      },
      {
        at: Date.parse(T),
        sessionId: "s1",
        limitId: "codex",
        planType: "plus",
        windowMinutes: 10080,
        slot: "secondary",
        usedPercent: 40,
        resetsAt: Date.parse("2026-10-14T08:30:00.000Z"),
      },
    ]);
  });

  it("skips a null rate_limits and null windows without counting them", () => {
    const content = [
      tokenCount(T, null),
      tokenCount(T, { limit_id: "codex", primary: null, secondary: null }),
      tokenCount(T, { limit_id: "premium", plan_type: "go", primary: win(3, 43200, "2026-11-01T00:00:00.000Z"), secondary: null }),
    ].join("\n");
    const r = scanCodexRateLimits(content, { sessionId: "s1" });
    expect(r.malformed).toBe(0);
    expect(r.readings.map((x) => [x.limitId, x.windowMinutes, x.usedPercent])).toEqual([["premium", 43200, 3]]);
  });

  it("counts a cut-off line, a reading without a timestamp and windows with bad numbers", () => {
    const content = [
      '{"timestamp":"2026-10-07T10:00:00.000Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary"',
      tokenCount(undefined, { primary: win(5, 300, "2026-10-07T14:00:00.000Z") }),
      tokenCount(T, {
        primary: { used_percent: "5", window_minutes: 300, resets_at: 1 },
        secondary: { used_percent: 5, window_minutes: 0, resets_at: 1 },
      }),
    ].join("\n");
    const r = scanCodexRateLimits(content, { sessionId: "s1" });
    expect(r.readings).toEqual([]);
    expect(r.malformed).toBe(4);
  });

  it("ignores the words rate_limits outside token_count events", () => {
    const content = JSON.stringify({
      timestamp: T,
      type: "response_item",
      payload: { type: "message", content: [{ type: "output_text", text: 'the "rate_limits" field' }] },
    });
    expect(scanCodexRateLimits(content, { sessionId: "s1" })).toEqual({ readings: [], malformed: 0 });
  });

  it("defaults the limit id to codex and leaves a missing plan type undefined", () => {
    const r = scanCodexRateLimits(tokenCount(T, { primary: win(7, 10080, "2026-10-14T08:30:00.000Z") }), {
      sessionId: "s1",
    });
    expect(r.readings[0]?.limitId).toBe("codex");
    expect(r.readings[0]?.planType).toBeUndefined();
  });

  it("reads the anonymised fixtures (one rate_limits line in compacted.jsonl has a null window)", () => {
    const compacted = scanCodexRateLimits(fixture("compacted.jsonl"), { sessionId: "c" });
    expect(compacted.readings).toHaveLength(167);
    expect(compacted.malformed).toBe(0);
    expect(new Set(compacted.readings.map((r) => r.windowMinutes))).toEqual(new Set([10080]));
    const records = scanCodexRateLimits(fixture("token-usage-record.jsonl"), { sessionId: "r" });
    expect(records.readings).toHaveLength(47);
    expect(records.readings.at(-1)?.usedPercent).toBe(50);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/modules/agents/codex/rateLimits.test.ts`
Expected: FAIL, `Failed to resolve import "../../../../src/modules/agents/codex/rateLimits.js"` (the module does not exist yet).

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Usage-limit readings from a Codex rollout. Pure.
 *
 * Codex writes `payload.rate_limits` on its `event_msg` / `token_count`
 * lines: { limit_id, plan_type, primary, secondary, ... }, each window
 * { used_percent, window_minutes, resets_at (epoch seconds) } or null.
 * One reading per non-null window. Only lines containing "rate_limits" are
 * parsed. A null rate_limits or a null window is skipped quietly (Codex
 * writes them; they are not errors). A line that does not parse, a reading
 * without a timestamp, or a window with a missing or invalid number is
 * skipped and counted in `malformed`. Unknown fields are ignored.
 */
export type LimitSlot = "primary" | "secondary";

export interface LimitReading {
  /** Time of the log line, epoch ms. */
  readonly at: number;
  readonly sessionId: string;
  /** `limit_id` ("codex", "premium", ...); "codex" when the line has none. */
  readonly limitId: string;
  readonly planType: string | undefined;
  readonly windowMinutes: number;
  readonly slot: LimitSlot;
  /** Percent used (Codex reports whole numbers). */
  readonly usedPercent: number;
  /** When the window resets, epoch ms. */
  readonly resetsAt: number;
}

export interface RateLimitScan {
  readonly readings: LimitReading[];
  /** Lines or windows that could not be read (skipped). */
  readonly malformed: number;
}

const SLOTS: readonly LimitSlot[] = ["primary", "secondary"];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

export function scanCodexRateLimits(content: string, meta: { readonly sessionId: string }): RateLimitScan {
  const readings: LimitReading[] = [];
  let malformed = 0;
  for (const raw of content.split(/\r?\n/)) {
    if (!raw.includes('"rate_limits"')) continue;
    let line: unknown;
    try {
      line = JSON.parse(raw);
    } catch {
      malformed++;
      continue;
    }
    if (!isObject(line)) {
      malformed++;
      continue;
    }
    const payload = line.payload;
    if (line.type !== "event_msg" || !isObject(payload) || payload.type !== "token_count") continue;
    const limits = payload.rate_limits;
    if (limits === null || limits === undefined) continue;
    const at = typeof line.timestamp === "string" ? Date.parse(line.timestamp) : Number.NaN;
    if (!isObject(limits) || !Number.isFinite(at)) {
      malformed++;
      continue;
    }
    for (const slot of SLOTS) {
      const w = limits[slot];
      if (w === null || w === undefined) continue;
      const used = isObject(w) ? w.used_percent : undefined;
      const minutes = isObject(w) ? w.window_minutes : undefined;
      const resets = isObject(w) ? w.resets_at : undefined;
      if (!isNum(used) || used < 0 || !isNum(minutes) || minutes <= 0 || !isNum(resets) || resets <= 0) {
        malformed++;
        continue;
      }
      readings.push({
        at,
        sessionId: meta.sessionId,
        limitId: text(limits.limit_id) ?? "codex",
        planType: text(limits.plan_type),
        windowMinutes: minutes,
        slot,
        usedPercent: used,
        resetsAt: resets * 1000,
      });
    }
  }
  return { readings, malformed };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/modules/agents/codex/rateLimits.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/codex/rateLimits.ts tests/modules/agents/codex/rateLimits.test.ts
git commit -m "feat(codex): scan usage-limit readings from rollouts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Windows and periods

**Files:**
- Create: `src/modules/limits/periods.ts`
- Test: `tests/modules/limits/periods.test.ts`

- [ ] **Step 1: Write the failing test**

Covers: one reset time (running maximum, a concurrent session's lower value), a reset between readings, drift inside / beyond the tolerance (30-day and 5-hour), the early reset seen on real data (and 66-second jitter that must not split), 5-hour + weekly + a second limit id, input order.

```ts
import { describe, expect, it } from "vitest";
import type { LimitReading } from "../../../src/modules/agents/codex/rateLimits.js";
import { buildPeriods, driftToleranceMs } from "../../../src/modules/limits/periods.js";

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
const T0 = Date.parse("2026-10-07T00:00:00.000Z");

function reading(at: number, usedPercent: number, resetsAt: number, extra: Partial<LimitReading> = {}): LimitReading {
  return {
    at,
    sessionId: "s1",
    limitId: "codex",
    planType: "plus",
    windowMinutes: 10080,
    slot: "primary",
    usedPercent,
    resetsAt,
    ...extra,
  };
}

describe("driftToleranceMs", () => {
  it("is the larger of 15 minutes and 1% of the window", () => {
    expect(driftToleranceMs(300)).toBe(15 * MIN);
    expect(driftToleranceMs(10080)).toBe(100.8 * MIN);
    expect(driftToleranceMs(43200)).toBe(432 * MIN);
  });
});

describe("buildPeriods", () => {
  it("keeps one period for one reset time; a lower percent from a concurrent session never lowers it", () => {
    const reset = T0 + 5 * DAY;
    const [w] = buildPeriods([
      reading(T0 + H, 10, reset),
      reading(T0 + 2 * H, 8, reset, { sessionId: "s2" }),
      reading(T0 + 3 * H, 15, reset),
    ]);
    expect(w?.periods).toHaveLength(1);
    const p = w!.periods[0]!;
    expect(p.usedPercent).toBe(15);
    expect(p.points.map((x) => x.usedPercent)).toEqual([10, 10, 15]);
    expect(p.resetsAt).toBe(reset);
    expect(p.startedAt).toBe(reset - 7 * DAY);
    expect(p.newestAt).toBe(T0 + 3 * H);
  });

  it("starts a new period when a reading comes after the reset time", () => {
    const [w] = buildPeriods([
      reading(T0 + H, 40, T0 + DAY),
      reading(T0 + DAY + H, 2, T0 + 8 * DAY),
    ]);
    expect(w?.periods.map((p) => [p.usedPercent, p.resetsAt])).toEqual([
      [40, T0 + DAY],
      [2, T0 + 8 * DAY],
    ]);
  });

  it("reads reset-time drift within the tolerance as the same period, and beyond it as a new one", () => {
    const thirty = { windowMinutes: 43200 };
    const r30 = T0 + 20 * DAY;
    const [w30] = buildPeriods([
      reading(T0 + H, 10, r30, thirty),
      reading(T0 + 2 * H, 12, r30 + 2 * H, thirty),
    ]);
    expect(w30?.periods).toHaveLength(1);
    expect(w30?.periods[0]?.resetsAt).toBe(r30 + 2 * H);
    const five = { windowMinutes: 300 };
    const r5 = T0 + 4 * H;
    const [w5] = buildPeriods([
      reading(T0 + H, 10, r5, five),
      reading(T0 + 2 * H, 12, r5 + 20 * MIN, five),
    ]);
    expect(w5?.periods).toHaveLength(2);
  });

  it("an early reset (reset time over 15 minutes later, lower percent) starts a new period", () => {
    const thirty = { windowMinutes: 43200 };
    const r = T0 + 30 * DAY;
    const [w] = buildPeriods([
      reading(T0 + H, 99, r, thirty),
      reading(T0 + H + 10 * MIN, 100, r, thirty),
      reading(T0 + H + 11 * MIN, 5, r + 76 * MIN, thirty),
      reading(T0 + H + 12 * MIN, 6, r + 76 * MIN + 66_000, thirty),
      reading(T0 + H + 13 * MIN, 5, r + 76 * MIN + 66_000, { ...thirty, sessionId: "s2" }),
    ]);
    expect(w?.periods.map((p) => p.usedPercent)).toEqual([100, 6]);
    expect(w?.periods[1]?.points.map((x) => x.usedPercent)).toEqual([5, 6, 6]);
  });

  it("keeps windows apart by limit id and length, shortest first", () => {
    const windows = buildPeriods([
      reading(T0 + H, 30, T0 + 6 * DAY, { limitId: "premium" }),
      reading(T0 + H, 20, T0 + 6 * DAY),
      reading(T0 + H, 50, T0 + 3 * H, { windowMinutes: 300 }),
    ]);
    expect(windows.map((w) => [w.limitId, w.windowMinutes])).toEqual([
      ["codex", 300],
      ["codex", 10080],
      ["premium", 10080],
    ]);
  });

  it("orders readings by time, so input order does not matter", () => {
    const rs = [
      reading(T0 + H, 10, T0 + DAY),
      reading(T0 + 2 * H, 20, T0 + DAY),
      reading(T0 + DAY + H, 1, T0 + 8 * DAY),
    ];
    expect(buildPeriods([...rs].reverse())).toEqual(buildPeriods(rs));
  });

  it("returns no windows for no readings", () => {
    expect(buildPeriods([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/modules/limits/periods.test.ts`
Expected: FAIL, `Failed to resolve import "../../../src/modules/limits/periods.js"`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Codex limit readings grouped into windows and periods. Pure.
 *
 * A window is one limit: limit id + window length. A period is the stretch
 * between two resets of that window. Readings from every session are sorted
 * by time, then reset time, then percent (compareReadings), so the result
 * never depends on which file was read first. A reading starts a new period
 * when:
 *   - its reset time differs from the period's by more than the drift
 *     tolerance (the larger of 15 minutes and 1% of the window), or
 *   - its time is past the period's reset time, or
 *   - its reset time is more than 15 minutes later than the period's and its
 *     percent is below the period's running maximum: the limit reset early.
 *     On the maintainer's 30-day window a limit that reached 100% started
 *     again at 5% with a reset time 76 and 129 minutes later, inside the
 *     7.2-hour tolerance; real drift between readings was at most 66 seconds.
 * Within a period the percent is the running maximum, so a lower value from a
 * concurrent session never lowers it. A period's reset time is its newest
 * reading's; it started one window length before that.
 */
import type { LimitReading } from "../agents/codex/rateLimits.js";

const MINUTE_MS = 60_000;
const EARLY_RESET_MS = 15 * MINUTE_MS;

/** Largest reset-time change still read as drift within one period. */
export function driftToleranceMs(windowMinutes: number): number {
  return Math.max(15 * MINUTE_MS, windowMinutes * MINUTE_MS * 0.01);
}

/** Reading order: time, then reset time, then percent. */
export function compareReadings(a: LimitReading, b: LimitReading): number {
  return a.at - b.at || a.resetsAt - b.resetsAt || a.usedPercent - b.usedPercent;
}

export interface PeriodPoint {
  /** Reading time, epoch ms. */
  readonly at: number;
  /** The period's running maximum at this reading. */
  readonly usedPercent: number;
}

export interface LimitPeriod {
  readonly limitId: string;
  readonly windowMinutes: number;
  /** resetsAt minus the window length, epoch ms. */
  readonly startedAt: number;
  /** Reset time of the period's newest reading, epoch ms. */
  readonly resetsAt: number;
  /** Running maximum at the newest reading. */
  readonly usedPercent: number;
  /** Time of the newest reading, epoch ms. */
  readonly newestAt: number;
  /** One point per reading, oldest first. */
  readonly points: readonly PeriodPoint[];
}

export interface LimitWindow {
  readonly limitId: string;
  readonly windowMinutes: number;
  /** Oldest first; never empty. */
  readonly periods: readonly LimitPeriod[];
}

interface OpenPeriod {
  resetsAt: number;
  usedPercent: number;
  newestAt: number;
  readonly points: PeriodPoint[];
}

function startsNewPeriod(cur: OpenPeriod, r: LimitReading): boolean {
  const shift = r.resetsAt - cur.resetsAt;
  return (
    Math.abs(shift) > driftToleranceMs(r.windowMinutes) ||
    r.at > cur.resetsAt ||
    (shift > EARLY_RESET_MS && r.usedPercent < cur.usedPercent)
  );
}

/** Windows ordered by length (shortest first), then limit id. */
export function buildPeriods(readings: readonly LimitReading[]): LimitWindow[] {
  const sorted = [...readings].sort(compareReadings);
  const open = new Map<string, { limitId: string; windowMinutes: number; periods: OpenPeriod[] }>();
  for (const r of sorted) {
    const key = `${r.limitId}\u0000${r.windowMinutes}`;
    let w = open.get(key);
    if (!w) {
      w = { limitId: r.limitId, windowMinutes: r.windowMinutes, periods: [] };
      open.set(key, w);
    }
    const cur = w.periods[w.periods.length - 1];
    if (!cur || startsNewPeriod(cur, r)) {
      w.periods.push({
        resetsAt: r.resetsAt,
        usedPercent: r.usedPercent,
        newestAt: r.at,
        points: [{ at: r.at, usedPercent: r.usedPercent }],
      });
      continue;
    }
    cur.usedPercent = Math.max(cur.usedPercent, r.usedPercent);
    cur.resetsAt = r.resetsAt;
    cur.newestAt = r.at;
    cur.points.push({ at: r.at, usedPercent: cur.usedPercent });
  }
  return [...open.values()]
    .sort((a, b) => a.windowMinutes - b.windowMinutes || (a.limitId < b.limitId ? -1 : a.limitId > b.limitId ? 1 : 0))
    .map((w) => ({
      limitId: w.limitId,
      windowMinutes: w.windowMinutes,
      periods: w.periods.map((p) => ({
        limitId: w.limitId,
        windowMinutes: w.windowMinutes,
        startedAt: p.resetsAt - w.windowMinutes * MINUTE_MS,
        resetsAt: p.resetsAt,
        usedPercent: p.usedPercent,
        newestAt: p.newestAt,
        points: p.points,
      })),
    }));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/modules/limits/periods.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/limits/periods.ts tests/modules/limits/periods.test.ts
git commit -m "feat(limits): group Codex limit readings into windows and periods" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pace and run-out projection

**Files:**
- Create: `src/modules/limits/pace.ts`
- Test: `tests/modules/limits/pace.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { projectRunOut } from "../../../src/modules/limits/pace.js";
import type { LimitPeriod } from "../../../src/modules/limits/periods.js";

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
const START = Date.parse("2026-10-07T00:00:00.000Z");

function period(usedPercent: number, newestAt: number, extra: Partial<LimitPeriod> = {}): LimitPeriod {
  return {
    limitId: "codex",
    windowMinutes: 10080,
    startedAt: START,
    resetsAt: START + 7 * DAY,
    usedPercent,
    newestAt,
    points: [],
    ...extra,
  };
}

describe("projectRunOut", () => {
  it("runs out before the reset at the current pace", () => {
    // 40% in 2 days = 20%/day; 60% left takes 3 more days: day 5, before the day-7 reset.
    expect(projectRunOut(period(40, START + 2 * DAY), new Date(START + 2 * DAY))).toEqual({
      kind: "runs-out",
      at: START + 5 * DAY,
    });
  });

  it("the pace counts the time up to now, not only up to the newest reading", () => {
    // Newest reading 1 day in (40%), now 2 days in: 20%/day, run-out 3 days after now.
    expect(projectRunOut(period(40, START + DAY), new Date(START + 2 * DAY))).toEqual({
      kind: "runs-out",
      at: START + 5 * DAY,
    });
    // 30-day window: 50% read 16 minutes in, now 3 days in: 50% in 3 days, out on day 6.
    const month = { windowMinutes: 43_200, resetsAt: START + 30 * DAY };
    expect(projectRunOut(period(50, START + 16 * MIN, month), new Date(START + 3 * DAY))).toEqual({
      kind: "runs-out",
      at: START + 6 * DAY,
    });
  });

  it("a clock behind the newest reading counts up to the newest reading", () => {
    expect(projectRunOut(period(40, START + 2 * DAY), new Date(START + 2 * DAY - H))).toEqual({
      kind: "runs-out",
      at: START + 5 * DAY,
    });
  });

  it("lasts until the reset when the run-out time is after it", () => {
    expect(projectRunOut(period(10, START + 2 * DAY), new Date(START + 2 * DAY))).toEqual({ kind: "lasts" });
    expect(projectRunOut(period(0, START + 3 * H), new Date(START + 3 * H))).toEqual({ kind: "lasts" });
    // 40% at day 1 would run out on day 2.5; by now (day 5) the pace is 8%/day: it lasts.
    expect(projectRunOut(period(40, START + DAY), new Date(START + 5 * DAY))).toEqual({ kind: "lasts" });
  });

  it("a run-out exactly at the reset still runs out", () => {
    // 50% in 3.5 days: the other 50% takes 3.5 days, ending exactly at the reset.
    expect(projectRunOut(period(50, START + 3.5 * DAY), new Date(START + 3.5 * DAY))).toEqual({
      kind: "runs-out",
      at: START + 7 * DAY,
    });
  });

  it("is reached at 100%", () => {
    expect(projectRunOut(period(100, START + DAY), new Date(START + DAY))).toEqual({ kind: "reached" });
  });

  it("is reset-since once the reset time has passed, whatever the percent", () => {
    expect(projectRunOut(period(100, START + DAY), new Date(START + 7 * DAY))).toEqual({ kind: "reset-since" });
    expect(projectRunOut(period(30, START + DAY), new Date(START + 8 * DAY))).toEqual({ kind: "reset-since" });
  });

  it("is too early only while less than an hour has passed since the period start", () => {
    expect(projectRunOut(period(5, START + 30 * MIN), new Date(START + 59 * MIN))).toEqual({ kind: "too-early" });
    expect(projectRunOut(period(5, START + 59 * MIN), new Date(START + 30 * MIN))).toEqual({ kind: "too-early" });
    // An hour since the start, counted to now or to the newest reading: a pace.
    expect(projectRunOut(period(5, START + 30 * MIN), new Date(START + H)).kind).toBe("runs-out");
    expect(projectRunOut(period(5, START + H), new Date(START + 30 * MIN)).kind).toBe("runs-out");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/modules/limits/pace.test.ts`
Expected: FAIL, `Failed to resolve import "../../../src/modules/limits/pace.js"`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * When a limit period runs out at its current pace. Pure.
 *
 * The percent is as of the newest reading, but the period has run until now:
 * pace = percent used ÷ (latest − period start), where latest = the later of
 * now and the newest reading (a clock behind the logs never shortens it).
 * Run-out = latest + (100 − percent) ÷ pace; "lasts" when that is after the
 * reset. Checked in this order: the reset already passed (`now` is at or past
 * the newest reading's reset time), the limit is reached (100%), less than an
 * hour from the period start to latest (too early for a pace).
 */
import type { LimitPeriod } from "./periods.js";

export type Projection =
  | { readonly kind: "runs-out"; readonly at: number }
  | { readonly kind: "lasts" }
  | { readonly kind: "reached" }
  | { readonly kind: "reset-since" }
  | { readonly kind: "too-early" };

/** Least time from the period start to now (or the newest reading, if later) before a pace is shown. */
export const MIN_PACE_MS = 60 * 60 * 1000;

export function projectRunOut(period: LimitPeriod, now: Date): Projection {
  if (period.resetsAt <= now.getTime()) return { kind: "reset-since" };
  if (period.usedPercent >= 100) return { kind: "reached" };
  const latest = Math.max(now.getTime(), period.newestAt);
  const elapsed = latest - period.startedAt;
  if (elapsed < MIN_PACE_MS) return { kind: "too-early" };
  if (period.usedPercent <= 0) return { kind: "lasts" };
  // (100 − percent) ÷ pace, with pace = percent ÷ elapsed.
  const at = latest + ((100 - period.usedPercent) * elapsed) / period.usedPercent;
  return at > period.resetsAt ? { kind: "lasts" } : { kind: "runs-out", at };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/modules/limits/pace.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/limits/pace.ts tests/modules/limits/pace.test.ts
git commit -m "feat(limits): project when a Codex limit runs out at the current pace" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: What used a period

**Files:**
- Create: `src/modules/limits/attribute.ts`
- Test: `tests/modules/limits/attribute.test.ts`

- [ ] **Step 1: Write the failing test**

Covers: split by tokens since the previous rise, a rise seen only on the next turn's first reading (older Codex), unattributed rises, a request at the same instant as a reading, out-of-period requests, the exact-sum property, folder names, per-session totals, the codex-auto-review line, `include` (--here).

```ts
import { describe, expect, it } from "vitest";
import {
  attribute,
  folderName,
  summarizeShares,
  type LimitRequest,
} from "../../../src/modules/limits/attribute.js";
import type { LimitPeriod, PeriodPoint } from "../../../src/modules/limits/periods.js";

const H = 3_600_000;
const S = Date.parse("2026-10-07T00:00:00.000Z");

function period(points: PeriodPoint[]): LimitPeriod {
  const last = points[points.length - 1]!;
  return {
    limitId: "codex",
    windowMinutes: 10080,
    startedAt: S,
    resetsAt: S + 7 * 24 * H,
    usedPercent: last.usedPercent,
    newestAt: last.at,
    points,
  };
}

function req(at: number, tokens: number, sessionId = "a", extra: Partial<LimitRequest> = {}): LimitRequest {
  return { at, sessionId, cwd: `C:\\work\\${sessionId}`, model: "gpt-5.4", tokens, ...extra };
}

const percents = (a: ReturnType<typeof attribute>) => a.shares.map((s) => [s.request.sessionId, s.percent]);

describe("attribute", () => {
  it("splits each rise across the requests since the previous rise, by tokens", () => {
    const p = period([
      { at: S + 2 * H, usedPercent: 4 },
      { at: S + 3 * H, usedPercent: 4 },
      { at: S + 4 * H, usedPercent: 4 },
      { at: S + 5 * H, usedPercent: 6 },
    ]);
    const a = attribute(p, [req(S + H, 100, "a"), req(S + 2 * H, 300, "b"), req(S + 3.5 * H, 500, "a")]);
    expect(percents(a)).toEqual([
      ["a", 1],
      ["b", 3],
      ["a", 2],
    ]);
    expect(a.unattributedPercent).toBe(0);
  });

  it("a rise seen only on a later reading goes to the requests before it (older Codex refreshes per turn)", () => {
    // Turn 1: requests at 1h and 2h, readings stay at the stale 10%; turn 2 starts at 5h showing 16%.
    const p = period([
      { at: S + 0.5 * H, usedPercent: 10 },
      { at: S + H, usedPercent: 10 },
      { at: S + 2 * H, usedPercent: 10 },
      { at: S + 5 * H, usedPercent: 16 },
    ]);
    const a = attribute(p, [req(S + 0.25 * H, 50, "x"), req(S + H, 200, "a"), req(S + 2 * H, 400, "a")]);
    expect(percents(a)).toEqual([
      ["x", 10],
      ["a", 2],
      ["a", 4],
    ]);
  });

  it("a rise with no local request since the previous rise is unattributed", () => {
    const p = period([
      { at: S + H, usedPercent: 3 },
      { at: S + 2 * H, usedPercent: 5 },
      { at: S + 3 * H, usedPercent: 9 },
    ]);
    const a = attribute(p, [req(S + 1.5 * H, 10)]);
    expect(percents(a)).toEqual([["a", 2]]);
    expect(a.unattributedPercent).toBe(7);
  });

  it("a request logged at the same instant as a reading counts toward it", () => {
    const a = attribute(period([{ at: S + H, usedPercent: 2 }]), [req(S + H, 10)]);
    expect(percents(a)).toEqual([["a", 2]]);
  });

  it("ignores requests outside (period start, newest reading] and requests with no tokens", () => {
    const p = period([{ at: S + H, usedPercent: 2 }]);
    const a = attribute(p, [req(S - 1, 10, "before"), req(S + 2 * H, 10, "after"), req(S + 0.5 * H, 0, "empty"), req(S + 0.5 * H, 10)]);
    expect(percents(a)).toEqual([["a", 2]]);
  });

  it("attributed plus unattributed equals the period's percent", () => {
    const points: PeriodPoint[] = [];
    const requests: LimitRequest[] = [];
    let pct = 0;
    for (let i = 1; i <= 60; i++) {
      if (i % 3 === 0) pct += 1 + (i % 4);
      points.push({ at: S + i * H, usedPercent: pct });
      if (i % 5 !== 0) requests.push(req(S + i * H - 1000, 7 + ((i * 13) % 11), i % 2 ? "a" : "b"));
    }
    const a = attribute(period(points), requests);
    const sum = a.shares.reduce((n, s) => n + s.percent, 0) + a.unattributedPercent;
    expect(sum).toBeCloseTo(pct, 9);
  });
});

describe("folderName", () => {
  it("returns the last folder of a Windows or POSIX path, never the path", () => {
    expect(folderName("C:\\Users\\me\\proj-a")).toBe("proj-a");
    expect(folderName("/home/me/proj-b/")).toBe("proj-b");
    expect(folderName(undefined)).toBeNull();
    expect(folderName("/")).toBeNull();
  });
});

describe("summarizeShares", () => {
  const shares = [
    { request: req(S + H, 100, "a", { cwd: "C:\\Users\\me\\proj-a" }), percent: 1 },
    { request: req(S + 2 * H, 300, "b", { cwd: "/home/me/proj-b" }), percent: 3 },
    { request: req(S + 3 * H, 500, "a", { cwd: "C:\\Users\\me\\proj-a" }), percent: 1.5 },
    { request: req(S + 4 * H, 20, "c", { model: "codex-auto-review" }), percent: 0.25 },
    { request: req(S + 5 * H, 30, "d", { model: "codex-auto-review", cwd: "/home/me/proj-b" }), percent: 0.5 },
    { request: req(S + 6 * H, 40, "e"), percent: 0 },
  ];

  it("totals each session, highest percent first, and names the project by folder only", () => {
    const s = summarizeShares(shares);
    expect(s.sessions).toEqual([
      { sessionId: "b", project: "proj-b", percent: 3, tokens: 300 },
      { sessionId: "a", project: "proj-a", percent: 2.5, tokens: 600 },
      { sessionId: "e", project: "e", percent: 0, tokens: 40 },
    ]);
  });

  it("groups codex-auto-review requests into one line", () => {
    expect(summarizeShares(shares).autoReview).toEqual({ percent: 0.75, tokens: 50, requests: 2 });
  });

  it("include narrows the list (--here)", () => {
    const s = summarizeShares(shares, (r) => (r.cwd ?? "").startsWith("/home/me/proj-b"));
    expect(s.sessions.map((x) => x.sessionId)).toEqual(["b"]);
    expect(s.autoReview).toEqual({ percent: 0.5, tokens: 30, requests: 1 });
  });

  it("no auto-review line when those requests used none of the limit", () => {
    const s = summarizeShares([{ request: req(S, 10, "c", { model: "codex-auto-review" }), percent: 0 }]);
    expect(s.autoReview).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/modules/limits/attribute.test.ts`
Expected: FAIL, `Failed to resolve import "../../../src/modules/limits/attribute.js"`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Which requests used a limit period. Pure.
 *
 * Each rise of the period's running maximum is split across the requests made
 * since the previous rise (since the period start for the first one), in
 * proportion to their tokens (input + output; cached input is part of input).
 * Readings that do not raise the maximum do not end that interval: older Codex
 * versions refresh the limit only when a turn starts, so a rise shows on the
 * first reading of the next turn, after the requests that caused it; and at
 * 1% resolution several small requests add up to one step. A rise with no
 * local request since the previous rise is unattributed (Codex on another
 * device or in the cloud, or usage from before these logs). Attributed plus
 * unattributed equals the period's percent exactly (floating sums; rounding is
 * for display only).
 */
import type { LimitPeriod } from "./periods.js";

/** Codex's automatic review requests: shown as one line of their own. */
export const AUTO_REVIEW_MODEL = "codex-auto-review";

export interface LimitRequest {
  /** Request time, epoch ms. */
  readonly at: number;
  readonly sessionId: string;
  /** The session's working folder. */
  readonly cwd: string | undefined;
  readonly model: string | undefined;
  /** Input + output tokens. */
  readonly tokens: number;
}

export interface RequestShare {
  readonly request: LimitRequest;
  /** Percent of the limit this request used (0 when it raised nothing). */
  readonly percent: number;
}

export interface Attribution {
  /** Every request in (period start, newest reading], oldest first. */
  readonly shares: readonly RequestShare[];
  readonly unattributedPercent: number;
}

/** Requests with tokens in (period start, newest reading], oldest first. */
export function requestsInPeriod(period: LimitPeriod, requests: readonly LimitRequest[]): LimitRequest[] {
  return requests
    .filter((r) => r.tokens > 0 && r.at > period.startedAt && r.at <= period.newestAt)
    .sort((a, b) => a.at - b.at);
}

export function attribute(period: LimitPeriod, requests: readonly LimitRequest[]): Attribution {
  const inPeriod = requestsInPeriod(period, requests);
  const percent = new Array<number>(inPeriod.length).fill(0);
  let unattributed = 0;
  let previous = 0;
  let next = 0;
  for (const point of period.points) {
    const rise = point.usedPercent - previous;
    if (rise <= 0) continue;
    previous = point.usedPercent;
    const from = next;
    while (next < inPeriod.length && inPeriod[next]!.at <= point.at) next++;
    let tokens = 0;
    for (let i = from; i < next; i++) tokens += inPeriod[i]!.tokens;
    if (tokens === 0) {
      unattributed += rise;
      continue;
    }
    for (let i = from; i < next; i++) percent[i] = (percent[i] ?? 0) + (rise * inPeriod[i]!.tokens) / tokens;
  }
  return {
    shares: inPeriod.map((request, i) => ({ request, percent: percent[i] ?? 0 })),
    unattributedPercent: unattributed,
  };
}

export interface SessionUse {
  readonly sessionId: string;
  /** Folder name of the session's working folder (never the full path); null when unknown. */
  readonly project: string | null;
  readonly percent: number;
  readonly tokens: number;
}

export interface AutoReviewUse {
  readonly percent: number;
  readonly tokens: number;
  readonly requests: number;
}

export interface UsageSummary {
  /** Highest percent first. */
  readonly sessions: readonly SessionUse[];
  /** codex-auto-review requests as one line; null when they used none of the limit. */
  readonly autoReview: AutoReviewUse | null;
}

/** Last segment of a working folder, in either path style. */
export function folderName(cwd: string | undefined): string | null {
  if (cwd === undefined) return null;
  const parts = cwd.split(/[\\/]+/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? null;
}

/** Per-session totals of the shares `include` keeps (--here); codex-auto-review grouped. */
export function summarizeShares(
  shares: readonly RequestShare[],
  include: (r: LimitRequest) => boolean = () => true,
): UsageSummary {
  const bySession = new Map<string, { project: string | null; percent: number; tokens: number }>();
  let review: AutoReviewUse = { percent: 0, tokens: 0, requests: 0 };
  for (const { request: r, percent } of shares) {
    if (!include(r)) continue;
    if (r.model === AUTO_REVIEW_MODEL) {
      review = { percent: review.percent + percent, tokens: review.tokens + r.tokens, requests: review.requests + 1 };
      continue;
    }
    const s = bySession.get(r.sessionId) ?? { project: folderName(r.cwd), percent: 0, tokens: 0 };
    s.percent += percent;
    s.tokens += r.tokens;
    bySession.set(r.sessionId, s);
  }
  const sessions = [...bySession]
    .map(([sessionId, s]) => ({ sessionId, project: s.project, percent: s.percent, tokens: s.tokens }))
    .sort(
      (a, b) =>
        b.percent - a.percent ||
        b.tokens - a.tokens ||
        (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0),
    );
  return { sessions, autoReview: review.percent > 0 ? review : null };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/modules/limits/attribute.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/limits/attribute.ts tests/modules/limits/attribute.test.ts
git commit -m "feat(limits): attribute each rise of a Codex limit to the requests behind it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Tokens per 1% and the possible cut

**Files:**
- Create: `src/modules/limits/shrink.ts`
- Test: `tests/modules/limits/shrink.test.ts`

- [ ] **Step 1: Write the failing test**

The first case mirrors the real weekly series (425K, 357K, then a drop); the others pin each exclusion and the alert rule's edges.

```ts
import { describe, expect, it } from "vitest";
import type { LimitRequest } from "../../../src/modules/limits/attribute.js";
import type { LimitPeriod, LimitWindow } from "../../../src/modules/limits/periods.js";
import { median, tokensPerPercent } from "../../../src/modules/limits/shrink.js";

const H = 3_600_000;
const WEEK = 7 * 24 * H;
const W0 = Date.parse("2026-08-03T00:00:00.000Z");

/** Week n of the series: one request per model entry, an hour into the week. */
function week(n: number, usedPercent: number, tokens: Record<string, number>): { period: LimitPeriod; requests: LimitRequest[] } {
  const start = W0 + n * WEEK;
  const requests = Object.entries(tokens).map(([model, t], i) => ({
    at: start + H + i,
    sessionId: `s${n}`,
    cwd: "/w",
    model,
    tokens: t,
  }));
  return {
    period: {
      limitId: "codex",
      windowMinutes: 10080,
      startedAt: start,
      resetsAt: start + WEEK,
      usedPercent,
      newestAt: start + 2 * H,
      points: [{ at: start + 2 * H, usedPercent }],
    },
    requests,
  };
}

function series(weeks: Array<ReturnType<typeof week>>, opts: { asOf?: number; sinceMs?: number } = {}) {
  const window: LimitWindow = { limitId: "codex", windowMinutes: 10080, periods: weeks.map((w) => w.period) };
  return tokensPerPercent(
    window,
    weeks.flatMap((w) => w.requests),
    { asOf: opts.asOf ?? W0 + 52 * WEEK, sinceMs: opts.sinceMs ?? 0 },
  );
}

describe("median", () => {
  it("is the middle value, or the mean of the two middle values", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([425_000, 357_000])).toBe(391_000);
    expect(median([])).toBe(0);
  });
});

describe("tokensPerPercent", () => {
  it("gives tokens per 1% per finished period and flags a drop to half the baseline median or less", () => {
    const s = series([
      week(0, 60, { "gpt-5.4": 25_500_000 }),
      week(1, 100, { "gpt-5.4": 35_700_000 }),
      week(2, 92, { "gpt-5.4": 9_200_000 }),
    ]);
    expect(s.points).toEqual([
      { model: "gpt-5.4", periodStart: W0, tokensPerPercent: 425_000 },
      { model: "gpt-5.4", periodStart: W0 + WEEK, tokensPerPercent: 357_000 },
      { model: "gpt-5.4", periodStart: W0 + 2 * WEEK, tokensPerPercent: 100_000 },
    ]);
    expect(s.possibleCut).toEqual({
      model: "gpt-5.4",
      periodStart: W0 + 2 * WEEK,
      tokensPerPercent: 100_000,
      baselineMedian: 391_000,
      factor: 3.9,
    });
  });

  it("skips unfinished, under-20%, mixed-model and before-since periods", () => {
    const weeks = [
      week(0, 50, { "gpt-5.4": 20_000_000 }),
      week(1, 15, { "gpt-5.4": 6_000_000 }),
      week(2, 50, { "gpt-5.4": 17_000_000, "gpt-5.5": 3_000_000 }),
      week(3, 50, { "gpt-5.4": 20_000_000 }),
      week(4, 50, { "gpt-5.4": 20_000_000 }),
    ];
    const s = series(weeks, { asOf: W0 + 4 * WEEK + 3 * H, sinceMs: W0 + 1 });
    expect(s.points.map((p) => p.periodStart)).toEqual([W0 + 3 * WEEK]);
  });

  it("a period with 90% of its tokens from one model counts, named after that model", () => {
    const s = series([week(0, 50, { "gpt-5.4": 18_000_000, "codex-auto-review": 2_000_000 })]);
    expect(s.points).toEqual([{ model: "gpt-5.4", periodStart: W0, tokensPerPercent: 400_000 }]);
  });

  it("needs two earlier periods on the same model before it flags", () => {
    const s = series([
      week(0, 50, { "gpt-5.4": 20_000_000 }),
      week(1, 50, { "gpt-5.5": 20_000_000 }),
      week(2, 50, { "gpt-5.4": 5_000_000 }),
    ]);
    expect(s.points).toHaveLength(3);
    expect(s.possibleCut).toBeNull();
  });

  it("flags at exactly half the median, not above it", () => {
    const base = [week(0, 50, { "gpt-5.4": 20_000_000 }), week(1, 50, { "gpt-5.4": 20_000_000 })];
    expect(series([...base, week(2, 50, { "gpt-5.4": 10_500_000 })]).possibleCut).toBeNull();
    expect(series([...base, week(2, 50, { "gpt-5.4": 10_000_000 })]).possibleCut?.factor).toBe(2);
  });

  it("names the first flagged period", () => {
    const s = series([
      week(0, 50, { "gpt-5.4": 20_000_000 }),
      week(1, 50, { "gpt-5.4": 20_000_000 }),
      week(2, 50, { "gpt-5.4": 5_000_000 }),
      week(3, 50, { "gpt-5.4": 5_000_000 }),
    ]);
    expect(s.possibleCut?.periodStart).toBe(W0 + 2 * WEEK);
    expect(s.possibleCut?.factor).toBe(4);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/modules/limits/shrink.test.ts`
Expected: FAIL, `Failed to resolve import "../../../src/modules/limits/shrink.js"`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * How many tokens 1% of a limit bought, per finished period, with a cautious
 * "possible limit cut" flag. Pure.
 *
 * A period is comparable when it finished (its reset time is before the
 * newest reading), started inside --since, had at least 20% used, and at
 * least 90% of its tokens came from one model, which names the period.
 * Tokens per 1% = tokens of the period's requests ÷ percent used.
 * A period is flagged when its tokens per 1% is at most half the median of at
 * least two earlier comparable periods of the same window on the same model.
 * The first flagged period is the possible cut; its factor is that median ÷
 * its tokens per 1%, to one decimal. Usage on other devices raises the percent
 * without local tokens and can look like a cut, so the wording is always
 * "possible".
 */
import { requestsInPeriod, type LimitRequest } from "./attribute.js";
import type { LimitWindow } from "./periods.js";

export const MIN_USED_PERCENT = 20;
export const MIN_MODEL_SHARE = 0.9;
export const MIN_BASELINE_PERIODS = 2;
export const CUT_RATIO = 0.5;

export interface TokensPerPercentPoint {
  readonly model: string;
  /** Period start, epoch ms. */
  readonly periodStart: number;
  readonly tokensPerPercent: number;
}

export interface PossibleCut {
  readonly model: string;
  readonly periodStart: number;
  readonly tokensPerPercent: number;
  readonly baselineMedian: number;
  /** baselineMedian ÷ tokensPerPercent, to one decimal. */
  readonly factor: number;
}

export interface ShrinkSeries {
  /** Comparable periods, oldest first. */
  readonly points: readonly TokensPerPercentPoint[];
  readonly possibleCut: PossibleCut | null;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2 : (s[mid] ?? 0);
}

export function tokensPerPercent(
  window: LimitWindow,
  requests: readonly LimitRequest[],
  opts: { readonly asOf: number; readonly sinceMs: number },
): ShrinkSeries {
  const points: TokensPerPercentPoint[] = [];
  for (const p of window.periods) {
    if (p.resetsAt >= opts.asOf || p.startedAt < opts.sinceMs || p.usedPercent < MIN_USED_PERCENT) continue;
    const byModel = new Map<string, number>();
    let total = 0;
    for (const r of requestsInPeriod(p, requests)) {
      total += r.tokens;
      if (r.model !== undefined) byModel.set(r.model, (byModel.get(r.model) ?? 0) + r.tokens);
    }
    let model: string | undefined;
    let top = 0;
    for (const [m, t] of byModel) {
      if (t > top) {
        model = m;
        top = t;
      }
    }
    if (model === undefined || total === 0 || top / total < MIN_MODEL_SHARE) continue;
    points.push({ model, periodStart: p.startedAt, tokensPerPercent: total / p.usedPercent });
  }
  for (let i = 0; i < points.length; i++) {
    const pt = points[i]!;
    const earlier = points.slice(0, i).filter((q) => q.model === pt.model).map((q) => q.tokensPerPercent);
    if (earlier.length < MIN_BASELINE_PERIODS) continue;
    const base = median(earlier);
    if (pt.tokensPerPercent <= base * CUT_RATIO) {
      return {
        points,
        possibleCut: {
          model: pt.model,
          periodStart: pt.periodStart,
          tokensPerPercent: pt.tokensPerPercent,
          baselineMedian: base,
          factor: Math.round((base / pt.tokensPerPercent) * 10) / 10,
        },
      };
    }
  }
  return { points, possibleCut: null };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/modules/limits/shrink.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/limits/shrink.ts tests/modules/limits/shrink.test.ts
git commit -m "feat(limits): tokens per 1% per period and a cautious possible-cut flag" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Report assembly and the window `today` names

**Files:**
- Create: `src/modules/limits/report.ts`
- Test: `tests/modules/limits/report.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { LimitReading } from "../../../src/modules/agents/codex/rateLimits.js";
import type { LimitRequest } from "../../../src/modules/limits/attribute.js";
import { buildPeriods } from "../../../src/modules/limits/periods.js";
import {
  buildLimitsReport,
  newestReading,
  pickTodayWindow,
  windowLabel,
} from "../../../src/modules/limits/report.js";

const H = 3_600_000;
const DAY = 24 * H;
const T0 = Date.parse("2026-10-07T00:00:00.000Z");

function reading(at: number, usedPercent: number, resetsAt: number, extra: Partial<LimitReading> = {}): LimitReading {
  return { at, sessionId: "a", limitId: "codex", planType: "plus", windowMinutes: 10080, slot: "primary", usedPercent, resetsAt, ...extra };
}

function req(at: number, tokens: number, sessionId: string, cwd: string): LimitRequest {
  return { at, sessionId, cwd, model: "gpt-5.4", tokens };
}

describe("windowLabel", () => {
  it("names windows from their length", () => {
    expect(windowLabel(300)).toBe("5-hour");
    expect(windowLabel(10_080)).toBe("Weekly");
    expect(windowLabel(43_200)).toBe("30-day");
    expect(windowLabel(1_440)).toBe("1-day");
    expect(windowLabel(120)).toBe("2-hour");
    expect(windowLabel(90)).toBe("1.5-hour");
  });
});

describe("newestReading", () => {
  it("is the last reading in reading order, whatever the input order", () => {
    const a = reading(T0 + H, 5, T0 + 6 * DAY, { planType: "go" });
    const b = reading(T0 + 2 * H, 6, T0 + 6 * DAY, { planType: "plus" });
    expect(newestReading([b, a])).toBe(b);
    expect(newestReading([])).toBeUndefined();
  });
});

describe("buildLimitsReport", () => {
  const weekReset = T0 + 6 * DAY;
  const fiveReset = T0 + 3 * H;
  const readings = [
    reading(T0 + H, 10, weekReset),
    reading(T0 + 2 * H, 30, weekReset, { sessionId: "b" }),
    reading(T0 + 2 * H, 90, fiveReset, { windowMinutes: 300, sessionId: "b" }),
  ];
  const requests = [req(T0 + H, 100, "a", "C:\\work\\app"), req(T0 + 2 * H, 300, "b", "/home/me/site")];

  it("returns null without readings", () => {
    expect(buildLimitsReport({ readings: [], requests, now: new Date(T0), sinceMs: 0 })).toBeNull();
  });

  it("reports every window: plan, newest time, percent, pace and what used it", () => {
    const r = buildLimitsReport({ readings, requests, now: new Date(T0 + 2 * H), sinceMs: 0 })!;
    expect(r.planType).toBe("plus");
    expect(r.asOf).toBe(T0 + 2 * H);
    expect(r.windows.map((w) => [w.label, w.period.usedPercent, w.periodCount, w.projection.kind])).toEqual([
      ["5-hour", 90, 1, "runs-out"],
      ["Weekly", 30, 1, "runs-out"],
    ]);
    const weekly = r.windows[1]!;
    expect(weekly.usedBy).toEqual([
      { sessionId: "b", project: "site", percent: 20, tokens: 300 },
      { sessionId: "a", project: "app", percent: 10, tokens: 100 },
    ]);
    expect(weekly.unattributedPercent).toBe(0);
    expect(weekly.autoReview).toBeNull();
    expect(weekly.shrink).toEqual({ points: [], possibleCut: null });
  });

  it("--here narrows only what used it; percent and unattributed stay account-wide", () => {
    const r = buildLimitsReport({
      readings,
      requests,
      now: new Date(T0 + 2 * H),
      sinceMs: 0,
      include: (q) => q.cwd === "C:\\work\\app",
    })!;
    const weekly = r.windows[1]!;
    expect(weekly.usedBy.map((u) => u.sessionId)).toEqual(["a"]);
    expect(weekly.period.usedPercent).toBe(30);
    expect(weekly.unattributedPercent).toBe(0);
  });
});

describe("pickTodayWindow", () => {
  const now = new Date(T0 + 2 * DAY);
  const at = T0 + 2 * DAY - H;

  it("picks the window that runs out first", () => {
    const windows = buildPeriods([
      // Weekly, started 1 day before T0: 70% in 3 days runs out ~1.3 days later.
      reading(at, 70, T0 + 6 * DAY),
      // 30-day, started 26 days before T0: 30% in 28 days lasts until the reset.
      reading(at, 30, T0 + 4 * DAY, { windowMinutes: 43_200 }),
    ]);
    const w = pickTodayWindow(windows, now)!;
    expect(w.label).toBe("Weekly");
    expect(w.projection.kind).toBe("runs-out");
  });

  it("a reached limit comes first", () => {
    const windows = buildPeriods([
      reading(at, 70, T0 + 6 * DAY),
      reading(at, 100, T0 + 4 * DAY, { windowMinutes: 43_200 }),
    ]);
    expect(pickTodayWindow(windows, now)?.label).toBe("30-day");
  });

  it("with no run-out anywhere, the highest percent", () => {
    const windows = buildPeriods([
      reading(at, 5, T0 + 6 * DAY),
      reading(at, 10, T0 + 26 * DAY, { windowMinutes: 43_200 }),
    ]);
    const w = pickTodayWindow(windows, now)!;
    expect(w.label).toBe("30-day");
    expect(w.projection.kind).toBe("lasts");
  });

  it("skips windows that reset since their newest reading; none left gives null", () => {
    const windows = buildPeriods([
      reading(T0 - 6 * DAY, 90, T0 + DAY),
      reading(at, 10, T0 + 26 * DAY, { windowMinutes: 43_200 }),
    ]);
    expect(pickTodayWindow(windows, now)?.label).toBe("30-day");
    expect(pickTodayWindow(buildPeriods([reading(T0 - 6 * DAY, 90, T0 + DAY)]), now)).toBeNull();
    expect(pickTodayWindow([], now)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/modules/limits/report.test.ts`
Expected: FAIL, `Failed to resolve import "../../../src/modules/limits/report.js"`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * The `sipcode limits` report, and the window the `today` line names. Pure.
 */
import type { LimitReading } from "../agents/codex/rateLimits.js";
import {
  attribute,
  summarizeShares,
  type AutoReviewUse,
  type LimitRequest,
  type SessionUse,
} from "./attribute.js";
import { projectRunOut, type Projection } from "./pace.js";
import { buildPeriods, compareReadings, type LimitPeriod, type LimitWindow } from "./periods.js";
import { tokensPerPercent, type ShrinkSeries } from "./shrink.js";

/** 300 → "5-hour", 10,080 → "Weekly", 43,200 → "30-day"; otherwise "N-day" or "N-hour". */
export function windowLabel(minutes: number): string {
  if (minutes === 10_080) return "Weekly";
  if (minutes % 1440 === 0) return `${minutes / 1440}-day`;
  return `${Number((minutes / 60).toFixed(1))}-hour`;
}

export interface WindowReport {
  readonly limitId: string;
  readonly windowMinutes: number;
  readonly label: string;
  /** The window's newest period (the current one, unless it has reset since). */
  readonly period: LimitPeriod;
  readonly periodCount: number;
  readonly projection: Projection;
  /** Sessions in the newest period that --here keeps, highest percent first. */
  readonly usedBy: readonly SessionUse[];
  readonly autoReview: AutoReviewUse | null;
  readonly unattributedPercent: number;
  readonly shrink: ShrinkSeries;
}

export interface LimitsReport {
  readonly planType: string | null;
  /** Time of the newest reading, epoch ms. */
  readonly asOf: number;
  readonly windows: readonly WindowReport[];
}

export interface BuildLimitsReportInput {
  readonly readings: readonly LimitReading[];
  readonly requests: readonly LimitRequest[];
  readonly now: Date;
  /** Start of the tokens-per-1% history (--since), epoch ms. */
  readonly sinceMs: number;
  /** --here: the requests the "what used it" list keeps. Default: all. */
  readonly include?: ((r: LimitRequest) => boolean) | undefined;
}

/** The newest reading (last in reading order), or undefined for none. */
export function newestReading(readings: readonly LimitReading[]): LimitReading | undefined {
  let newest: LimitReading | undefined;
  for (const r of readings) if (!newest || compareReadings(r, newest) > 0) newest = r;
  return newest;
}

export function buildLimitsReport(input: BuildLimitsReportInput): LimitsReport | null {
  const newest = newestReading(input.readings);
  if (!newest) return null;
  const asOf = newest.at;
  const windows = buildPeriods(input.readings).map((w): WindowReport => {
    const period = w.periods[w.periods.length - 1]!;
    const a = attribute(period, input.requests);
    const used = summarizeShares(a.shares, input.include);
    return {
      limitId: w.limitId,
      windowMinutes: w.windowMinutes,
      label: windowLabel(w.windowMinutes),
      period,
      periodCount: w.periods.length,
      projection: projectRunOut(period, input.now),
      usedBy: used.sessions,
      autoReview: used.autoReview,
      unattributedPercent: a.unattributedPercent,
      shrink: tokensPerPercent(w, input.requests, { asOf, sinceMs: input.sinceMs }),
    };
  });
  return { planType: newest.planType ?? null, asOf, windows };
}

export interface TodayWindow {
  readonly label: string;
  readonly period: LimitPeriod;
  readonly projection: Projection;
}

interface Candidate {
  readonly window: TodayWindow;
  /** When it runs out: -Infinity once reached; undefined when no run-out is projected. */
  readonly runsOut: number | undefined;
  readonly minutes: number;
}

function closer(a: Candidate, b: Candidate): boolean {
  if (a.runsOut !== undefined || b.runsOut !== undefined) {
    if (a.runsOut === undefined) return false;
    if (b.runsOut === undefined) return true;
    if (a.runsOut !== b.runsOut) return a.runsOut < b.runsOut;
  } else if (a.window.period.usedPercent !== b.window.period.usedPercent) {
    return a.window.period.usedPercent > b.window.period.usedPercent;
  }
  return a.minutes < b.minutes;
}

/**
 * The window closest to running out, among those whose newest reading is in
 * the current period (not reset since): a reached limit first, then the
 * earliest run-out time; with no run-out at all, the highest percent; ties go
 * to the shorter window. Null when no window qualifies.
 */
export function pickTodayWindow(windows: readonly LimitWindow[], now: Date): TodayWindow | null {
  let best: Candidate | null = null;
  for (const w of windows) {
    const period = w.periods[w.periods.length - 1];
    if (!period) continue;
    const projection = projectRunOut(period, now);
    if (projection.kind === "reset-since") continue;
    const runsOut =
      projection.kind === "reached"
        ? Number.NEGATIVE_INFINITY
        : projection.kind === "runs-out"
          ? projection.at
          : undefined;
    const c: Candidate = { window: { label: windowLabel(w.windowMinutes), period, projection }, runsOut, minutes: w.windowMinutes };
    if (!best || closer(c, best)) best = c;
  }
  return best ? best.window : null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/modules/limits/report.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/limits/report.ts tests/modules/limits/report.test.ts
git commit -m "feat(limits): assemble the limits report and pick the window today shows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Terminal and JSON formatters

**Files:**
- Create: `src/modules/limits/format-terminal.ts`, `src/modules/limits/format-json.ts`
- Test: `tests/modules/limits/format.test.ts`

- [ ] **Step 1: Write the failing test**

The first terminal case is the spec's example layout (2026 weekdays); every projection kind, the today line and the JSON shape are pinned.

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LimitPeriod } from "../../../src/modules/limits/periods.js";
import type { LimitsReport, WindowReport } from "../../../src/modules/limits/report.js";
import {
  formatAgo,
  formatApprox,
  formatLimitsTerminal,
  formatPercent,
  formatTodayLimitLine,
  formatTokensCompact,
  formatWhen,
} from "../../../src/modules/limits/format-terminal.js";
import { formatLimitsJson } from "../../../src/modules/limits/format-json.js";

const H = 3_600_000;
const DAY = 24 * H;
const NOW = new Date("2026-10-09T10:00:00.000Z");
const iso = (s: string) => Date.parse(s);

let savedTz: string | undefined;
beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = "UTC";
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

function period(extra: Partial<LimitPeriod> = {}): LimitPeriod {
  return {
    limitId: "codex",
    windowMinutes: 10080,
    startedAt: iso("2026-10-07T14:00:00.000Z"),
    resetsAt: iso("2026-10-14T14:00:00.000Z"),
    usedPercent: 62,
    newestAt: iso("2026-10-09T08:00:00.000Z"),
    points: [],
    ...extra,
  };
}

function win(extra: Partial<WindowReport> = {}): WindowReport {
  return {
    limitId: "codex",
    windowMinutes: 10080,
    label: "Weekly",
    period: period(),
    periodCount: 1,
    projection: { kind: "runs-out", at: iso("2026-10-13T17:50:00.000Z") },
    usedBy: [],
    autoReview: null,
    unattributedPercent: 0,
    shrink: { points: [], possibleCut: null },
    ...extra,
  };
}

describe("helpers", () => {
  it("formatWhen shows the hour within a week, the date otherwise", () => {
    expect(formatWhen(iso("2026-10-14T14:00:00.000Z"), NOW.getTime())).toBe("Wed 14 Oct 14:00");
    expect(formatWhen(iso("2026-11-02T00:00:00.000Z"), NOW.getTime())).toBe("Mon 2 Nov");
    expect(formatWhen(iso("2026-04-20T06:03:00.000Z"), NOW.getTime())).toBe("Mon 20 Apr");
  });

  it("formatApprox rounds to the nearest hour", () => {
    expect(formatApprox(iso("2026-10-13T17:50:00.000Z"), NOW.getTime())).toBe("Tue 13 Oct ~18:00");
    expect(formatApprox(iso("2026-10-13T17:29:00.000Z"), NOW.getTime())).toBe("Tue 13 Oct ~17:00");
    expect(formatApprox(iso("2026-10-31T17:29:00.000Z"), NOW.getTime())).toBe("Sat 31 Oct");
  });

  it("formatAgo", () => {
    const n = NOW.getTime();
    expect(formatAgo(n - 30_000, n)).toBe("just now");
    expect(formatAgo(n - (36 * 60_000 + 25_000), n)).toBe("36m ago");
    expect(formatAgo(n - 2 * H, n)).toBe("2h ago");
    expect(formatAgo(n - 47 * H, n)).toBe("47h ago");
    expect(formatAgo(n - 3 * DAY, n)).toBe("3d ago");
  });

  it("formatPercent and formatTokensCompact", () => {
    expect(formatPercent(19.4)).toBe("19%");
    expect(formatPercent(0.44)).toBe("0.4%");
    expect(formatPercent(100)).toBe("100%");
    expect(formatTokensCompact(3_100_000)).toBe("3.1M");
    expect(formatTokensCompact(425_000)).toBe("425K");
    expect(formatTokensCompact(80_400)).toBe("80K");
    expect(formatTokensCompact(999_600)).toBe("1.0M");
    expect(formatTokensCompact(512)).toBe("512");
  });
});

describe("formatLimitsTerminal", () => {
  it("renders the header, one row per window and the sections under them", () => {
    const report: LimitsReport = {
      planType: "go",
      asOf: NOW.getTime() - 2 * H,
      windows: [
        win({
          usedBy: [
            { sessionId: "0199a1b2-c3d4-7a11-8000-00000000000a", project: "sipcode", percent: 19.2, tokens: 3_100_000 },
            { sessionId: "0199a0f7-11aa-7b02-8000-00000000000b", project: "my-app", percent: 12, tokens: 1_400_000 },
            { sessionId: "0199a0f7-11aa-7b03-8000-00000000000c", project: "a-very-long-project-name", percent: 0.4, tokens: 2_000 },
            { sessionId: "0199a0f7-11aa-7b04-8000-00000000000d", project: null, percent: 0, tokens: 900 },
          ],
          autoReview: { percent: 6, tokens: 180_000, requests: 9 },
          unattributedPercent: 3,
          shrink: {
            points: [
              { model: "gpt-5.4", periodStart: iso("2026-03-28T15:11:00.000Z"), tokensPerPercent: 425_000 },
              { model: "gpt-5.4", periodStart: iso("2026-04-01T08:37:00.000Z"), tokensPerPercent: 357_000 },
              { model: "gpt-5.4", periodStart: iso("2026-04-13T06:03:00.000Z"), tokensPerPercent: 80_000 },
              { model: "gpt-5.5", periodStart: iso("2026-05-01T00:00:00.000Z"), tokensPerPercent: 90_000 },
            ],
            possibleCut: {
              model: "gpt-5.4",
              periodStart: iso("2026-04-13T06:03:00.000Z"),
              tokensPerPercent: 80_000,
              baselineMedian: 391_000,
              factor: 4.9,
            },
          },
        }),
        win({
          limitId: "codex",
          windowMinutes: 43200,
          label: "30-day",
          period: period({ windowMinutes: 43200, usedPercent: 41, resetsAt: iso("2026-11-02T00:00:00.000Z") }),
          projection: { kind: "lasts" },
        }),
      ],
    };
    expect(formatLimitsTerminal(report, NOW)).toBe(
      [
        "sipcode limits · Codex · plan: go · as of 2h ago (your last Codex request)",
        "",
        "Weekly limit    62% used   resets Wed 14 Oct 14:00   at this pace: runs out Tue 13 Oct ~18:00",
        "30-day limit    41% used   resets Mon 2 Nov          at this pace: lasts until reset",
        "",
        "What used your weekly limit (since Wed 7 Oct)",
        "  0199a1b2-c3d4-7a11   sipcode       19%   3.1M tokens",
        "  0199a0f7-11aa-7b02   my-app        12%   1.4M tokens",
        "  0199a0f7-11aa-7b03   a-very-long-… 0.4%   2K tokens",
        "  codex-auto-review (9 requests)      6%",
        "  unattributed (no Codex requests on this computer)  3%",
        "",
        "Tokens per 1% of your weekly limit (gpt-5.4)",
        "  Mar 28: 425K   Apr 1: 357K   Apr 13: 80K",
        "  Possible limit cut around Apr 13: 4.9x fewer tokens per 1%.",
        "  Limits cover your whole account. Codex use on other devices or in the cloud",
        "  is not in these logs and can look like a cut.",
      ].join("\n"),
    );
  });

  it("reached, too-early and reset-since rows; no plan, no sections", () => {
    const report: LimitsReport = {
      planType: null,
      asOf: NOW.getTime() - 30_000,
      windows: [
        win({
          label: "5-hour",
          windowMinutes: 300,
          period: period({ usedPercent: 3, resetsAt: iso("2026-10-09T14:00:00.000Z") }),
          projection: { kind: "too-early" },
        }),
        win({ period: period({ usedPercent: 100 }), projection: { kind: "reached" } }),
        win({
          label: "30-day",
          period: period({ resetsAt: iso("2026-04-20T06:03:00.000Z") }),
          projection: { kind: "reset-since" },
          unattributedPercent: 62,
        }),
      ],
    };
    expect(formatLimitsTerminal(report, NOW)).toBe(
      [
        "sipcode limits · Codex · as of just now (your last Codex request)",
        "",
        "5-hour limit    3% used    resets Fri 9 Oct 14:00    not enough data yet for a pace",
        "Weekly limit    100% used  limit reached, resets Wed 14 Oct 14:00",
        "30-day limit    reset since your last Codex request (at Mon 20 Apr)",
      ].join("\n"),
    );
  });
});

describe("formatTodayLimitLine", () => {
  const line = (w: Partial<WindowReport>) => {
    const full = win(w);
    return formatTodayLimitLine({ label: full.label, period: full.period, projection: full.projection }, NOW);
  };

  it("runs out", () => {
    expect(line({})).toBe("Codex weekly limit: 62% used, resets Wed 14:00. At this pace you run out Tue ~18:00.");
  });

  it("lasts, with a reset more than a week away", () => {
    expect(
      line({
        label: "30-day",
        period: period({ usedPercent: 41, resetsAt: iso("2026-11-02T00:00:00.000Z") }),
        projection: { kind: "lasts" },
      }),
    ).toBe("Codex 30-day limit: 41% used, resets Mon 2 Nov. At this pace it lasts until the reset.");
  });

  it("reached and too early", () => {
    expect(line({ period: period({ usedPercent: 100 }), projection: { kind: "reached" } })).toBe(
      "Codex weekly limit: limit reached, resets Wed 14:00.",
    );
    expect(
      line({
        label: "5-hour",
        period: period({ usedPercent: 3, resetsAt: iso("2026-10-09T14:00:00.000Z") }),
        projection: { kind: "too-early" },
      }),
    ).toBe("Codex 5-hour limit: 3% used, resets Fri 14:00. Not enough data yet for a pace.");
  });
});

describe("formatLimitsJson", () => {
  it("prints the documented shape", () => {
    const report: LimitsReport = {
      planType: "go",
      asOf: iso("2026-10-09T08:00:00.000Z"),
      windows: [
        win({
          usedBy: [{ sessionId: "s1", project: "sipcode", percent: 50, tokens: 3_100_000 }],
          autoReview: { percent: 6, tokens: 180_000, requests: 9 },
          unattributedPercent: 6,
          periodCount: 4,
          shrink: {
            points: [{ model: "gpt-5.4", periodStart: iso("2026-04-13T06:03:00.000Z"), tokensPerPercent: 77_400.5 }],
            possibleCut: {
              model: "gpt-5.4",
              periodStart: iso("2026-04-13T06:03:00.000Z"),
              tokensPerPercent: 77_400.5,
              baselineMedian: 390_761,
              factor: 5,
            },
          },
        }),
      ],
    };
    expect(JSON.parse(formatLimitsJson(report))).toEqual({
      agent: "codex",
      planType: "go",
      asOf: "2026-10-09T08:00:00.000Z",
      windows: [
        {
          limitId: "codex",
          windowMinutes: 10080,
          label: "Weekly",
          usedPercent: 62,
          resetsAt: "2026-10-14T14:00:00.000Z",
          projection: { kind: "runs-out", at: "2026-10-13T17:50:00.000Z" },
          usedBy: [
            { sessionId: "s1", project: "sipcode", percent: 50, tokens: 3_100_000 },
            { sessionId: "codex-auto-review", project: null, percent: 6, tokens: 180_000 },
          ],
          unattributedPercent: 6,
          tokensPerPercent: [{ model: "gpt-5.4", periodStart: "2026-04-13T06:03:00.000Z", tokensPerPercent: 77_401 }],
          possibleCut: { at: "2026-04-13", factor: 5 },
          periodCount: 4,
        },
      ],
    });
  });

  it("projection kinds other than runs-out carry no time; no data gives an empty list", () => {
    const report: LimitsReport = { planType: null, asOf: 0, windows: [win({ projection: { kind: "lasts" } })] };
    expect(JSON.parse(formatLimitsJson(report)).windows[0].projection).toEqual({ kind: "lasts" });
    expect(JSON.parse(formatLimitsJson(null))).toEqual({ agent: "codex", planType: null, asOf: null, windows: [] });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/modules/limits/format.test.ts`
Expected: FAIL, `Failed to resolve import "../../../src/modules/limits/format-terminal.js"`.

- [ ] **Step 3: Write the terminal formatter**

```ts
/**
 * Terminal renderers for `sipcode limits` and the `today` limit line. Pure.
 *
 * Times are local. A time within a week of now shows its hour ("Tue 14 Oct
 * 14:00"); a later or earlier one shows the date only ("Sun 2 Nov"). Run-out
 * times are estimates, rounded to the nearest hour and marked "~".
 */
import { shortSessionId } from "../../lib/session-id.js";
import { AUTO_REVIEW_MODEL } from "./attribute.js";
import type { LimitsReport, TodayWindow, WindowReport } from "./report.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const pad2 = (n: number): string => String(n).padStart(2, "0");
const weekday = (d: Date): string => WEEKDAYS[d.getDay()]!;
const clock = (d: Date): string => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const soon = (ms: number, now: number): boolean => Math.abs(ms - now) < WEEK;

/** The nearest whole local hour. */
function roundHour(ms: number): Date {
  const d = new Date(ms + 30 * MINUTE);
  d.setMinutes(0, 0, 0);
  return d;
}

/** "Tue 7 Oct" */
export function formatDay(ms: number): string {
  const d = new Date(ms);
  return `${weekday(d)} ${d.getDate()} ${MONTHS[d.getMonth()]!}`;
}

/** "Mar 28" */
export function formatMonthDay(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]!} ${d.getDate()}`;
}

/** "Tue 14 Oct 14:00" within a week of now, else "Sun 2 Nov". */
export function formatWhen(ms: number, now: number): string {
  return soon(ms, now) ? `${formatDay(ms)} ${clock(new Date(ms))}` : formatDay(ms);
}

/** "Mon 13 Oct ~18:00" within a week of now, else "Mon 13 Oct". */
export function formatApprox(ms: number, now: number): string {
  const d = roundHour(ms);
  return soon(ms, now) ? `${formatDay(d.getTime())} ~${pad2(d.getHours())}:00` : formatDay(ms);
}

/** "just now", "36m ago", "2h ago" (under 48 hours), "3d ago". */
export function formatAgo(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < 48 * HOUR) return `${Math.floor(diff / HOUR)}h ago`;
  return `${Math.floor(diff / DAY)}d ago`;
}

/** Whole percent; one decimal below 1%. */
export function formatPercent(p: number): string {
  return p < 1 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`;
}

/** "3.1M", "425K", "512". */
export function formatTokensCompact(n: number): string {
  if (Math.round(n / 1000) >= 1000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(Math.round(n));
}

const lower = (label: string): string => label.toLowerCase();

function fit(s: string, width: number): string {
  return (s.length > width ? `${s.slice(0, width - 1)}…` : s).padEnd(width);
}

/** A "what used it" line: 34 columns of name, the percent, then tokens when given. */
function useLine(left: string, percent: number, tokens?: number): string {
  const t = tokens === undefined ? "" : `   ${formatTokensCompact(tokens)} tokens`;
  return `  ${left.padEnd(34)} ${formatPercent(percent).padStart(3)}${t}`;
}

function windowRow(w: WindowReport, now: number): string {
  const name = `${w.label} limit`.padEnd(16);
  const used = `${Math.round(w.period.usedPercent)}% used`.padEnd(11);
  const resets = formatWhen(w.period.resetsAt, now);
  const p = w.projection;
  switch (p.kind) {
    case "reset-since":
      return `${name}reset since your last Codex request (at ${resets})`;
    case "reached":
      return `${name}${used}limit reached, resets ${resets}`;
    case "too-early":
      return `${name}${used}${`resets ${resets}`.padEnd(26)}not enough data yet for a pace`;
    case "lasts":
      return `${name}${used}${`resets ${resets}`.padEnd(26)}at this pace: lasts until reset`;
    case "runs-out":
      return `${name}${used}${`resets ${resets}`.padEnd(26)}at this pace: runs out ${formatApprox(p.at, now)}`;
  }
}

/** Top 5 sessions, the codex-auto-review line, the unattributed line. None for a window that reset since. */
function usedBySection(w: WindowReport): string[] {
  if (w.projection.kind === "reset-since") return [];
  const lines = w.usedBy
    .filter((s) => s.percent > 0)
    .slice(0, 5)
    .map((s) => useLine(`${shortSessionId(s.sessionId, "codex").padEnd(21)}${fit(s.project ?? "", 13)}`, s.percent, s.tokens));
  if (w.autoReview) {
    const n = w.autoReview.requests;
    lines.push(useLine(`${AUTO_REVIEW_MODEL} (${n} request${n === 1 ? "" : "s"})`, w.autoReview.percent));
  }
  if (w.unattributedPercent > 0) {
    lines.push(useLine("unattributed (no Codex requests on this computer)", w.unattributedPercent));
  }
  if (lines.length === 0) return [];
  return ["", `What used your ${lower(w.label)} limit (since ${formatDay(w.period.startedAt)})`, ...lines];
}

/** One block per model with two or more comparable periods; the alert under the flagged model. */
function shrinkSection(w: WindowReport): string[] {
  const out: string[] = [];
  const models = [...new Set(w.shrink.points.map((p) => p.model))];
  for (const model of models) {
    const points = w.shrink.points.filter((p) => p.model === model);
    if (points.length < 2) continue;
    out.push("", `Tokens per 1% of your ${lower(w.label)} limit (${model})`);
    for (let i = 0; i < points.length; i += 6) {
      const row = points.slice(i, i + 6).map((p) => `${formatMonthDay(p.periodStart)}: ${formatTokensCompact(p.tokensPerPercent)}`);
      out.push(`  ${row.join("   ")}`);
    }
    const cut = w.shrink.possibleCut;
    if (cut && cut.model === model) {
      out.push(
        `  Possible limit cut around ${formatMonthDay(cut.periodStart)}: ${cut.factor.toFixed(1)}x fewer tokens per 1%.`,
        "  Limits cover your whole account. Codex use on other devices or in the cloud",
        "  is not in these logs and can look like a cut.",
      );
    }
  }
  return out;
}

export function formatLimitsTerminal(report: LimitsReport, now: Date): string {
  const n = now.getTime();
  const head = [
    "sipcode limits",
    "Codex",
    ...(report.planType ? [`plan: ${report.planType}`] : []),
    `as of ${formatAgo(report.asOf, n)} (your last Codex request)`,
  ].join(" · ");
  const lines = [head, "", ...report.windows.map((w) => windowRow(w, n))];
  for (const w of report.windows) lines.push(...usedBySection(w), ...shrinkSection(w));
  return lines.join("\n");
}

/** "Tue 14:00" within a week of now, else "Sun 2 Nov". */
function shortWhen(ms: number, now: number): string {
  return soon(ms, now) ? `${weekday(new Date(ms))} ${clock(new Date(ms))}` : formatDay(ms);
}

/** "Mon ~18:00" within a week of now, else "Mon 13 Oct". */
function shortApprox(ms: number, now: number): string {
  const d = roundHour(ms);
  return soon(ms, now) ? `${weekday(d)} ~${pad2(d.getHours())}:00` : formatDay(ms);
}

/** The one line `today` adds for the Codex limit closest to running out. */
export function formatTodayLimitLine(w: TodayWindow, now: Date): string {
  const n = now.getTime();
  const name = `Codex ${lower(w.label)} limit`;
  const resets = shortWhen(w.period.resetsAt, n);
  const used = `${Math.round(w.period.usedPercent)}% used`;
  const p = w.projection;
  switch (p.kind) {
    case "reached":
      return `${name}: limit reached, resets ${resets}.`;
    case "runs-out":
      return `${name}: ${used}, resets ${resets}. At this pace you run out ${shortApprox(p.at, n)}.`;
    case "lasts":
      return `${name}: ${used}, resets ${resets}. At this pace it lasts until the reset.`;
    case "too-early":
      return `${name}: ${used}, resets ${resets}. Not enough data yet for a pace.`;
    case "reset-since":
      return `${name}: reset since your last Codex request.`;
  }
}
```

- [ ] **Step 4: Write the JSON formatter**

```ts
/**
 * JSON renderer for `sipcode limits --json` and the get_codex_limits MCP
 * tool. Pure. Times are ISO 8601 (UTC); `project` is a folder name, never a
 * path. `usedBy` lists every session of the newest period that --here keeps,
 * then codex-auto-review as one entry; with `unattributedPercent` it adds up
 * to `usedPercent` (without --here). `periodCount` is how many periods the
 * logs show for the window (the independent checker compares it).
 */
import { AUTO_REVIEW_MODEL } from "./attribute.js";
import type { LimitsReport } from "./report.js";

const iso = (ms: number): string => new Date(ms).toISOString();

export function formatLimitsJson(report: LimitsReport | null): string {
  if (report === null) {
    return JSON.stringify({ agent: "codex", planType: null, asOf: null, windows: [] }, null, 2);
  }
  return JSON.stringify(
    {
      agent: "codex",
      planType: report.planType,
      asOf: iso(report.asOf),
      windows: report.windows.map((w) => ({
        limitId: w.limitId,
        windowMinutes: w.windowMinutes,
        label: w.label,
        usedPercent: w.period.usedPercent,
        resetsAt: iso(w.period.resetsAt),
        projection: w.projection.kind === "runs-out" ? { kind: "runs-out", at: iso(w.projection.at) } : { kind: w.projection.kind },
        usedBy: [
          ...w.usedBy.map((s) => ({ sessionId: s.sessionId, project: s.project, percent: s.percent, tokens: s.tokens })),
          ...(w.autoReview
            ? [{ sessionId: AUTO_REVIEW_MODEL, project: null, percent: w.autoReview.percent, tokens: w.autoReview.tokens }]
            : []),
        ],
        unattributedPercent: w.unattributedPercent,
        tokensPerPercent: w.shrink.points.map((p) => ({
          model: p.model,
          periodStart: iso(p.periodStart),
          tokensPerPercent: Math.round(p.tokensPerPercent),
        })),
        possibleCut: w.shrink.possibleCut
          ? { at: iso(w.shrink.possibleCut.periodStart).slice(0, 10), factor: w.shrink.possibleCut.factor }
          : null,
        periodCount: w.periodCount,
      })),
    },
    null,
    2,
  );
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run tests/modules/limits/format.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add src/modules/limits/format-terminal.ts src/modules/limits/format-json.ts tests/modules/limits/format.test.ts
git commit -m "feat(limits): terminal and JSON output for Codex limits" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The `limits` command

**Files:**
- Create: `src/modules/limits/load.ts`, `src/commands/limits.ts`
- Modify: `src/lib/messages.ts`, `tests/integration/codex-fixtures.ts`
- Test: `tests/integration/limits.integration.test.ts`

- [ ] **Step 1: Let the fixture builders log limit readings**

In `tests/integration/codex-fixtures.ts`, replace the `CodexTurn` interface and the comment above `codexRollout`:

```ts
export interface CodexTurn {
  readonly model: string;
  readonly input: number;
  readonly output: number;
  readonly at: string;
}

/** One rollout: session_meta, then per turn a turn_context and a token_usage_record. */
```

with:

```ts
/** A usage-limit reading Codex logs after a request (event_msg token_count rate_limits). */
export interface CodexLimit {
  readonly usedPercent: number;
  readonly windowMinutes: number;
  readonly resetsAt: string;
  readonly planType?: string;
}

export interface CodexTurn {
  readonly model: string;
  readonly input: number;
  readonly output: number;
  readonly at: string;
  /** When set, a token_count line with this reading follows the turn's usage record. */
  readonly limit?: CodexLimit;
}

/**
 * One rollout: session_meta, then per turn a turn_context and a
 * token_usage_record (plus a token_count line with rate_limits when the turn
 * has a `limit`; the parser skips token_count lines once records exist).
 */
```

In `codexRollout`, replace the end of the per-turn loop:

```ts
            total_tokens: t.input + t.output,
          },
        },
      }),
    );
  });
  return lines.join("\n");
```

with:

```ts
            total_tokens: t.input + t.output,
          },
        },
      }),
    );
    if (t.limit) {
      lines.push(
        line({
          timestamp: t.at,
          type: "event_msg",
          payload: {
            type: "token_count",
            info: null,
            rate_limits: {
              limit_id: "codex",
              limit_name: null,
              plan_type: t.limit.planType ?? "plus",
              primary: {
                used_percent: t.limit.usedPercent,
                window_minutes: t.limit.windowMinutes,
                resets_at: Date.parse(t.limit.resetsAt) / 1000,
              },
              secondary: null,
              credits: null,
            },
          },
        }),
      );
    }
  });
  return lines.join("\n");
```

Append at the end of the file:

```ts
// ---------------------------------------------------------------------------
// Usage-limit scenarios (limits, today, MCP get_codex_limits)
// ---------------------------------------------------------------------------

export const LIMITS_SESSION_A = "0199a1b2-c3d4-7a11-8000-00000000000a";
export const LIMITS_SESSION_B = "0199a0f7-11aa-7b02-8000-00000000000b";
export const LIMITS_REVIEW = "0199a0f7-11aa-7b03-8000-00000000000c";
export const LIMITS_SHRINK_SESSION = "0199a000-0000-7000-8000-000000000001";

const weekly = (usedPercent: number, resetsAt = "2026-10-14T08:30:00.000Z"): CodexLimit => ({
  usedPercent,
  windowMinutes: 10080,
  resetsAt,
});

const bigTurn = (at: string, usedPercent: number): CodexTurn => ({
  model: "gpt-5.4",
  input: 1_500_000,
  output: 50_000,
  at,
  limit: weekly(usedPercent),
});

/**
 * One weekly period (reset 2026-10-14T08:30Z, started 2026-10-07T08:30Z), 62%
 * used by 2026-10-09T08:00Z: session A in C:\work\sipcode raised it 10 + 20,
 * a codex-auto-review thread 5, session B in /home/u/my-app 5 + 22.
 */
export function addWeeklyLimitScenario(fs: InMemoryFs, opts: { readonly readings?: boolean } = {}): void {
  // readings: false writes the same requests without their limit readings.
  const keep = (turns: CodexTurn[]): CodexTurn[] =>
    opts.readings === false ? turns.map((t) => ({ model: t.model, input: t.input, output: t.output, at: t.at })) : turns;
  addCodexRollout(
    fs,
    LIMITS_SESSION_A,
    keep([bigTurn("2026-10-07T10:00:00.000Z", 10), bigTurn("2026-10-08T10:00:00.000Z", 30)]),
    "C:\\work\\sipcode",
  );
  addCodexRollout(
    fs,
    LIMITS_REVIEW,
    keep([{ ...autoReviewTurn("2026-10-08T15:00:00.000Z"), limit: weekly(35) }]),
    "C:\\work\\sipcode",
  );
  addCodexRollout(
    fs,
    LIMITS_SESSION_B,
    keep([bigTurn("2026-10-08T20:00:00.000Z", 40), bigTurn("2026-10-09T08:00:00.000Z", 62)]),
    "/home/u/my-app",
  );
}

/**
 * Four weekly periods of one gpt-5.4 session: three finished ones at 400K,
 * 400K and 100K tokens per 1% (a possible cut on Sep 15, 4.0x), then the
 * current one at 10% (reading 2026-10-08T00:00Z, reset 2026-10-13T00:00Z).
 */
export function addShrinkScenario(fs: InMemoryFs): void {
  const turn = (at: string, input: number, usedPercent: number, resetsAt: string): CodexTurn => ({
    model: "gpt-5.4",
    input,
    output: 0,
    at,
    limit: weekly(usedPercent, resetsAt),
  });
  addCodexRollout(
    fs,
    LIMITS_SHRINK_SESSION,
    [
      turn("2026-09-01T01:00:00.000Z", 20_000_000, 50, "2026-09-08T00:00:00.000Z"),
      turn("2026-09-08T01:00:00.000Z", 20_000_000, 50, "2026-09-15T00:00:00.000Z"),
      turn("2026-09-15T01:00:00.000Z", 5_000_000, 50, "2026-09-22T00:00:00.000Z"),
      turn("2026-10-08T00:00:00.000Z", 1_000_000, 10, "2026-10-13T00:00:00.000Z"),
    ],
    "/home/u/proj",
  );
}
```

Check that nothing else changed: `npx vitest run tests/integration tests/mcp` → PASS (no existing turn sets `limit`).

- [ ] **Step 2: Write the failing test**

```ts
/** `sipcode limits` end to end on in-memory Codex logs. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLimits } from "../../src/commands/limits.js";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import {
  addCodexRollout,
  addShrinkScenario,
  addWeeklyLimitScenario,
  CODEX_SESSIONS,
  LIMITS_REVIEW,
  LIMITS_SESSION_A,
  LIMITS_SESSION_B,
  solTurn,
} from "./codex-fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "../fixtures/codex");
const NOW = new Date("2026-10-09T10:00:00.000Z");

let savedTz: string | undefined;
beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = "UTC";
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

async function run(opts: Parameters<typeof runLimits>[0], fs: InMemoryFs, now = NOW) {
  const out: string[] = [];
  const err: string[] = [];
  const r = await runLimits(opts, {
    fs,
    env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
    clock: new FakeClock(now),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  });
  return { exitCode: r.exitCode, out: out.join("\n"), err: err.join("\n") };
}

function weeklyFs(): InMemoryFs {
  const fs = new InMemoryFs();
  addWeeklyLimitScenario(fs);
  return fs;
}

describe("sipcode limits: empty and error states", () => {
  it("no Codex logs: says so and exits 0", async () => {
    const r = await run({}, new InMemoryFs());
    expect(r.exitCode).toBe(0);
    expect(r.out).toBe("no Codex limit readings found yet (Codex records them after each request).");
  });

  it("Codex logs without limit readings: the same message", async () => {
    const fs = new InMemoryFs();
    addCodexRollout(fs, "cx1", [solTurn("2026-10-08T10:00:00Z")]);
    const r = await run({}, fs);
    expect(r.exitCode).toBe(0);
    expect(r.out).toBe("no Codex limit readings found yet (Codex records them after each request).");
  });

  it("--json without readings prints an empty windows list", async () => {
    const r = await run({ json: true }, new InMemoryFs());
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ agent: "codex", planType: null, asOf: null, windows: [] });
  });

  it("--agent claude-code (or cursor) stops with E009: limits are recorded only by Codex", async () => {
    for (const agent of ["claude-code", "cursor"]) {
      const r = await run({ agent }, weeklyFs());
      expect(r.exitCode).toBe(1);
      expect(r.out).toBe("");
      expect(r.err).toContain("[E009] sipcode limits reads Codex limits only.");
      expect(r.err).toContain("limits are recorded only by Codex");
    }
  });

  it("--agent codex and --agent auto read Codex", async () => {
    for (const agent of ["codex", "auto"]) {
      const r = await run({ agent, json: true }, weeklyFs());
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.out).windows).toHaveLength(1);
    }
  });

  it("an unknown --agent is rejected", async () => {
    const r = await run({ agent: "gemini" }, weeklyFs());
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain("gemini");
  });

  it("a bad --since is E010 and points at limits", async () => {
    const r = await run({ since: "yesterday" }, weeklyFs());
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain('[E010] couldn\'t parse --since "yesterday".');
    expect(r.err).toContain("next: npx sipcode limits --since 30d");
  });

  it("a damaged reading line is skipped with a note on stderr", async () => {
    const fs = weeklyFs();
    fs.writeFile(
      `${CODEX_SESSIONS}/2026/10/09/rollout-broken.jsonl`,
      '{"timestamp":"2026-10-09T09:00:00.000Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary"',
      Date.parse("2026-10-09T09:00:00.000Z"),
    );
    const r = await run({ json: true }, fs);
    expect(r.exitCode).toBe(0);
    expect(r.err).toContain("note: 1 Codex limit reading(s) could not be read and were skipped.");
    expect(JSON.parse(r.out).windows[0].usedPercent).toBe(62);
  });
});

describe("sipcode limits: one weekly period", () => {
  it("shows the window, the pace and what used it", async () => {
    const r = await run({}, weeklyFs());
    expect(r.exitCode).toBe(0);
    expect(r.out).toBe(
      [
        "sipcode limits · Codex · plan: plus · as of 2h ago (your last Codex request)",
        "",
        "Weekly limit    62% used   resets Wed 14 Oct 08:30   at this pace: runs out Sat 10 Oct ~13:00",
        "",
        "What used your weekly limit (since Wed 7 Oct)",
        "  0199a1b2-c3d4-7a11   sipcode       30%   3.1M tokens",
        "  0199a0f7-11aa-7b02   my-app        27%   3.1M tokens",
        "  codex-auto-review (1 request)       5%",
      ].join("\n"),
    );
  });

  it("--json: the documented shape, and the lines add up to the percent used", async () => {
    const r = await run({ json: true }, weeklyFs());
    const j = JSON.parse(r.out);
    expect(j.agent).toBe("codex");
    expect(j.planType).toBe("plus");
    expect(j.asOf).toBe("2026-10-09T08:00:00.000Z");
    expect(j.windows).toHaveLength(1);
    const w = j.windows[0];
    expect(Object.keys(w)).toEqual([
      "limitId",
      "windowMinutes",
      "label",
      "usedPercent",
      "resetsAt",
      "projection",
      "usedBy",
      "unattributedPercent",
      "tokensPerPercent",
      "possibleCut",
      "periodCount",
    ]);
    expect(w).toMatchObject({
      limitId: "codex",
      windowMinutes: 10080,
      label: "Weekly",
      usedPercent: 62,
      resetsAt: "2026-10-14T08:30:00.000Z",
      unattributedPercent: 0,
      tokensPerPercent: [],
      possibleCut: null,
      periodCount: 1,
    });
    expect(w.projection.kind).toBe("runs-out");
    expect(Math.abs(Date.parse(w.projection.at) - Date.parse("2026-10-10T13:06:46.451Z"))).toBeLessThan(1000);
    expect(w.usedBy.map((u: { sessionId: string; project: string | null; tokens: number }) => [u.sessionId, u.project, u.tokens])).toEqual([
      [LIMITS_SESSION_A, "sipcode", 3_100_000],
      [LIMITS_SESSION_B, "my-app", 3_100_000],
      ["codex-auto-review", null, 20_503],
    ]);
    const percents = w.usedBy.map((u: { percent: number }) => u.percent);
    expect(percents[0]).toBeCloseTo(30, 9);
    expect(percents[1]).toBeCloseTo(27, 9);
    expect(percents[2]).toBeCloseTo(5, 9);
    expect(percents.reduce((a: number, b: number) => a + b, 0) + w.unattributedPercent).toBeCloseTo(62, 9);
    expect(r.out).not.toContain("C:\\\\work");
    expect(r.out).not.toContain(LIMITS_REVIEW);
  });

  it("--here keeps only this folder's sessions in what used it; the percent stays account-wide", async () => {
    const r = await run({ json: true, here: true, cwd: "C:\\work\\sipcode" }, weeklyFs());
    const w = JSON.parse(r.out).windows[0];
    expect(w.usedPercent).toBe(62);
    expect(w.usedBy.map((u: { sessionId: string }) => u.sessionId)).toEqual([LIMITS_SESSION_A, "codex-auto-review"]);
    expect(w.unattributedPercent).toBe(0);
  });

  it("once the reset time has passed, the window says so instead of a stale percent", async () => {
    const r = await run({}, weeklyFs(), new Date("2026-10-15T00:00:00.000Z"));
    expect(r.out).toBe(
      [
        "sipcode limits · Codex · plan: plus · as of 5d ago (your last Codex request)",
        "",
        "Weekly limit    reset since your last Codex request (at Wed 14 Oct 08:30)",
      ].join("\n"),
    );
  });
});

describe("sipcode limits: tokens per 1% over time", () => {
  const SHRINK_NOW = new Date("2026-10-09T00:00:00.000Z");
  const shrinkFs = () => {
    const fs = new InMemoryFs();
    addShrinkScenario(fs);
    return fs;
  };

  it("shows each finished period and a possible cut with the other-devices caveat", async () => {
    const r = await run({}, shrinkFs(), SHRINK_NOW);
    expect(r.out).toBe(
      [
        "sipcode limits · Codex · plan: plus · as of 24h ago (your last Codex request)",
        "",
        "Weekly limit    10% used   resets Tue 13 Oct 00:00   at this pace: lasts until reset",
        "",
        "What used your weekly limit (since Tue 6 Oct)",
        "  0199a000-0000-7000   proj          10%   1.0M tokens",
        "",
        "Tokens per 1% of your weekly limit (gpt-5.4)",
        "  Sep 1: 400K   Sep 8: 400K   Sep 15: 100K",
        "  Possible limit cut around Sep 15: 4.0x fewer tokens per 1%.",
        "  Limits cover your whole account. Codex use on other devices or in the cloud",
        "  is not in these logs and can look like a cut.",
      ].join("\n"),
    );
    const j = JSON.parse((await run({ json: true }, shrinkFs(), SHRINK_NOW)).out);
    expect(j.windows[0].periodCount).toBe(4);
    expect(j.windows[0].tokensPerPercent).toEqual([
      { model: "gpt-5.4", periodStart: "2026-09-01T00:00:00.000Z", tokensPerPercent: 400_000 },
      { model: "gpt-5.4", periodStart: "2026-09-08T00:00:00.000Z", tokensPerPercent: 400_000 },
      { model: "gpt-5.4", periodStart: "2026-09-15T00:00:00.000Z", tokensPerPercent: 100_000 },
    ]);
    expect(j.windows[0].possibleCut).toEqual({ at: "2026-09-15", factor: 4 });
  });

  it("--since limits how far back the history goes (default 90d)", async () => {
    const j = JSON.parse((await run({ json: true, since: "7d" }, shrinkFs(), SHRINK_NOW)).out);
    expect(j.windows[0].tokensPerPercent).toEqual([]);
    expect(j.windows[0].possibleCut).toBeNull();
    expect(j.windows[0].periodCount).toBe(4);
    const t = await run({ since: "7d" }, shrinkFs(), SHRINK_NOW);
    expect(t.out).not.toContain("Tokens per 1%");
  });
});

describe("sipcode limits: anonymised real rollout (tests/fixtures/codex/compacted.jsonl)", () => {
  const FIXTURE_NOW = new Date("2026-01-09T18:00:00.000Z");
  const fixtureFs = () => {
    const fs = new InMemoryFs();
    fs.writeFile(
      `${CODEX_SESSIONS}/2026/01/01/rollout-2026-01-01T00-00-00-019b0004-0001-7000-8000-000000000000.jsonl`,
      readFileSync(path.join(FIXTURES, "compacted.jsonl"), "utf-8"),
      Date.parse("2026-01-09T17:48:00.000Z"),
    );
    return fs;
  };

  it("limits --json --since all", async () => {
    const r = await run({ json: true, since: "all" }, fixtureFs(), FIXTURE_NOW);
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.planType).toBe("x");
    expect(j.asOf).toBe("2026-01-09T17:23:35.171Z");
    expect(j.windows).toHaveLength(1);
    const w = j.windows[0];
    expect(w).toMatchObject({
      limitId: "x",
      windowMinutes: 10080,
      label: "Weekly",
      usedPercent: 92,
      resetsAt: "2026-01-14T14:44:07.000Z",
      projection: { kind: "runs-out", at: "2026-01-09T21:47:55.067Z" },
      periodCount: 2,
      tokensPerPercent: [{ model: "gpt-5.4", periodStart: "2025-12-26T17:17:46.000Z", tokensPerPercent: 111_071 }],
      possibleCut: null,
    });
    expect(w.usedBy).toHaveLength(1);
    expect(w.usedBy[0].sessionId).toBe("019b0004-0001-7000-8000-000000000000");
    expect(w.usedBy[0].project).toBe("fixture");
    expect(w.usedBy[0].tokens).toBe(7_120_846);
    expect(w.usedBy[0].percent).toBeCloseTo(89, 9);
    expect(w.unattributedPercent).toBe(3);
  });

  it("terminal", async () => {
    const r = await run({ since: "all" }, fixtureFs(), FIXTURE_NOW);
    expect(r.out.split("\n").slice(0, 3)).toEqual([
      "sipcode limits · Codex · plan: x · as of 36m ago (your last Codex request)",
      "",
      "Weekly limit    92% used   resets Wed 14 Jan 14:44   at this pace: runs out Fri 9 Jan ~22:00",
    ]);
    expect(r.out).toContain("  019b0004-0001-7000   fixture       89%   7.1M tokens");
    expect(r.out).toContain("  unattributed (no Codex requests on this computer)  3%");
  });
});
```

The fixture test's numbers were computed independently from `tests/fixtures/codex/compacted.jsonl` (its requests counted with `scripts/verify-counts.mjs`'s own parser): 2 weekly periods; the current one 92% used, reset 2026-01-14T14:44:07Z, 7,120,846 tokens, 89% attributed and 3% unattributed (the 3% the first reading of the period already showed); the finished one 11,107,107 tokens at 100%.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/integration/limits.integration.test.ts`
Expected: FAIL, `Failed to resolve import "../../src/commands/limits.js"`.

- [ ] **Step 4: Add the messages**

In `src/lib/messages.ts`, insert before `codexNotSupportedYet: (command: string) =>`:

```ts
  // ---- Codex limits (v1.7.1) ----

  limitsCodexOnly: () =>
    [
      `[E009] sipcode limits reads Codex limits only.`,
      ``,
      `why: limits are recorded only by Codex. Claude Code's logs do not record them.`,
      ``,
      `fix: run it without --agent, or with --agent codex.`,
      ``,
      `next: npx sipcode limits`,
    ].join("\n"),

  limitsNoReadings: "no Codex limit readings found yet (Codex records them after each request).",

  limitsMalformed: (n: number) => `note: ${n} Codex limit reading(s) could not be read and were skipped.`,

```

and change `statsBadSince` so the `next:` line can name the command (existing callers pass one argument and print exactly what they printed before):

```ts
  statsBadSince: (raw: string, command = "stats") =>
    [
      `[E010] couldn't parse --since "${raw}".`,
      ``,
      `why: sipcode accepts a duration like 7d / 30d / 90d, the keyword "all", or a yyyy-mm-dd date.`,
      ``,
      `fix: try --since 30d, --since all, or --since 2026-04-01.`,
      ``,
      `next: npx sipcode ${command} --since 30d`,
    ].join("\n"),
```

- [ ] **Step 5: Write the disk side**

`src/modules/limits/load.ts`:

```ts
/**
 * Codex limit inputs from disk: readings, scanned from every rollout Codex
 * discovery lists, and requests, from the shared session loader (so dedupe
 * and the usage cache are reused unchanged). Files that cannot be read are
 * skipped here; the session loader's stderr note counts them.
 */
import { scanCodexRateLimits, type LimitReading } from "../agents/codex/rateLimits.js";
import { discoverAgentSessions, type LoadedSession } from "../agents/loadSessions.js";
import { getAgentById } from "../agents/registry.js";
import type { AgentDeps } from "../agents/types.js";
import type { LimitRequest } from "./attribute.js";
import { formatTodayLimitLine } from "./format-terminal.js";
import { buildPeriods } from "./periods.js";
import { pickTodayWindow } from "./report.js";

export interface CodexReadings {
  readonly readings: LimitReading[];
  /** Lines or windows that could not be read (MESSAGES.limitsMalformed). */
  readonly malformed: number;
}

export async function loadCodexReadings(deps: AgentDeps): Promise<CodexReadings> {
  const readings: LimitReading[] = [];
  let malformed = 0;
  const found = await discoverAgentSessions(getAgentById("codex"), deps);
  if (!found.ok) return { readings, malformed };
  for (const meta of found.value.sessions) {
    let text: string;
    try {
      text = await deps.fs.readFile(meta.filePath);
    } catch {
      continue;
    }
    const scan = scanCodexRateLimits(text, { sessionId: meta.sessionId });
    for (const r of scan.readings) readings.push(r);
    malformed += scan.malformed;
  }
  return { readings, malformed };
}

/** A loaded Codex session's requests with tokens and a time (loadSessions `analyze`). */
export function limitRequests({ meta, parsed }: LoadedSession): LimitRequest[] {
  const cwd = meta.cwd ?? parsed.cwd;
  const out: LimitRequest[] = [];
  for (const t of parsed.assistantTurns) {
    const at = t.timestamp === undefined ? Number.NaN : Date.parse(t.timestamp);
    const tokens = t.inputTokens + t.cacheReadTokens + t.cacheCreationTokens + t.outputTokens;
    if (!Number.isFinite(at) || tokens <= 0) continue;
    out.push({ at, sessionId: meta.sessionId, cwd, model: t.model, tokens });
  }
  return out;
}

/** The line `today` adds for the Codex limit closest to running out; undefined without limit data. */
export async function todayLimitLine(deps: AgentDeps, now: Date): Promise<string | undefined> {
  const { readings } = await loadCodexReadings(deps);
  const w = pickTodayWindow(buildPeriods(readings), now);
  return w ? formatTodayLimitLine(w, now) : undefined;
}
```

- [ ] **Step 6: Write the command**

`src/commands/limits.ts`:

```ts
/**
 * `sipcode limits`: Codex usage limits, read from the readings Codex writes
 * into its own logs after each request. Zero network calls.
 *
 * Thin orchestrator: readings (loadCodexReadings) + requests (loadSessions)
 * → buildLimitsReport → terminal or JSON. Codex only: Claude Code's logs do
 * not record limits, so --agent claude-code (or cursor) is E009.
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import { MESSAGES } from "../lib/messages.js";
import { parseAgentFlag } from "../modules/agents/cli.js";
import { isWithinFolder } from "../modules/agents/codex/adapter.js";
import { discoveryNotes, loadSessions } from "../modules/agents/loadSessions.js";
import { getAgentById } from "../modules/agents/registry.js";
import { defaultUsageCaches, type UsageCaches } from "../modules/agents/usageSessions.js";
import { parseSince } from "../modules/stats/window.js";
import type { LimitRequest } from "../modules/limits/attribute.js";
import { formatLimitsJson } from "../modules/limits/format-json.js";
import { formatLimitsTerminal } from "../modules/limits/format-terminal.js";
import { limitRequests, loadCodexReadings } from "../modules/limits/load.js";
import { buildLimitsReport } from "../modules/limits/report.js";

export interface LimitsOptions {
  json?: boolean;
  /** How far back the tokens-per-1% history goes. Default 90d. */
  since?: string;
  /** Narrow only the "what used it" list to sessions in the current folder. */
  here?: boolean;
  agent?: string;
  cwd?: string;
}

export interface LimitsDeps {
  fs?: FileSystem;
  clock?: Clock;
  env?: ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  /** Usage cache per agent. Default: defaultUsageCaches. */
  usageCaches?: UsageCaches;
}

export interface LimitsExit {
  readonly exitCode: 0 | 1;
}

export async function runLimits(opts: LimitsOptions = {}, deps: LimitsDeps = {}): Promise<LimitsExit> {
  const fs = deps.fs ?? new RealFileSystem();
  const clock = deps.clock ?? new RealClock();
  const env = deps.env ?? new RealProcessEnv();
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s + "\n"));

  const agent = parseAgentFlag(opts.agent);
  if (!agent.ok) {
    stderr(agent.message);
    return { exitCode: 1 };
  }
  if (agent.selector !== "auto" && agent.selector !== "codex") {
    stderr(MESSAGES.limitsCodexOnly());
    return { exitCode: 1 };
  }
  const now = clock.now();
  const rawSince = opts.since ?? "90d";
  const since = parseSince(rawSince, now);
  if (!since.ok) {
    stderr(MESSAGES.statsBadSince(rawSince, "limits"));
    return { exitCode: 1 };
  }
  const empty = (): LimitsExit => {
    stdout(opts.json ? formatLimitsJson(null) : MESSAGES.limitsNoReadings);
    return { exitCode: 0 };
  };

  const agentDeps = { fs, env, clock };
  const scan = await loadCodexReadings(agentDeps);
  if (scan.malformed > 0) stderr(MESSAGES.limitsMalformed(scan.malformed));
  if (scan.readings.length === 0) return empty();

  const cwd = opts.cwd ?? process.cwd();
  const loaded = await loadSessions({
    agent: getAgentById("codex"),
    deps: agentDeps,
    cwd,
    cache: (deps.usageCaches ?? defaultUsageCaches(fs, env))("codex"),
    needsToolCalls: () => false,
    analyze: limitRequests,
  });
  if (!loaded.ok) {
    stderr(loaded.error.map((e) => e.message).join("\n"));
    return { exitCode: 1 };
  }
  for (const n of discoveryNotes(loaded.value)) stderr(n);
  const requests: LimitRequest[] = [];
  for (const s of loaded.value.sessions) for (const r of s.value) requests.push(r);

  const report = buildLimitsReport({
    readings: scan.readings,
    requests,
    now,
    sinceMs: Date.parse(since.value.sinceIso),
    include: opts.here ? (r) => r.cwd !== undefined && isWithinFolder(r.cwd, cwd) : undefined,
  });
  if (report === null) return empty();
  stdout(opts.json ? formatLimitsJson(report) : formatLimitsTerminal(report, now));
  return { exitCode: 0 };
}
```

- [ ] **Step 7: Run it to verify it passes**

Run: `npx vitest run tests/integration/limits.integration.test.ts`
Expected: PASS, 16 tests.
Run: `npx vitest run tests/privacy tests/modules/stats` → PASS (every command imports `ASSERT_NO_NETWORK`; `statsBadSince` output unchanged for stats).
Run: `npm run lint` → no errors.

- [ ] **Step 8: Commit**

```bash
git add src/modules/limits/load.ts src/commands/limits.ts src/lib/messages.ts tests/integration/codex-fixtures.ts tests/integration/limits.integration.test.ts
git commit -m "feat(limits): sipcode limits command for Codex usage limits" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Register `limits` in the CLI

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/e2e/release-smoke.test.ts` (the `--help lists every documented command` case)

- [ ] **Step 1: Write the failing test**

In `tests/e2e/release-smoke.test.ts`, in the `--help lists every documented command` list, replace:

```ts
      "benchmark",
    ]) {
```

with:

```ts
      "benchmark",
      "limits",
    ]) {
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build && npx vitest run tests/e2e/release-smoke.test.ts -t "lists every documented command"`
Expected: FAIL, `expected '…' to contain 'limits'`.

- [ ] **Step 3: Register the command**

In `src/cli.ts`, after the `forecast` command block (the one ending in `const r = await runForecastCmd(opts);` / `if (r?.exitCode) process.exit(r.exitCode);` / `});`), insert:

```ts

program
  .command("limits")
  .description("Codex usage limits: percent used, when you run out at this pace, what used them, and tokens per 1% over time.")
  .option("--json", "machine-readable output")
  .option("--since <window>", "how far back the tokens-per-1% history goes: 7d | 30d | 90d | all | yyyy-mm-dd", "90d")
  .option("--here", "list only sessions from the current folder under \"what used it\" (limits are account-wide)")
  .option("--agent <id>", "codex (limits are recorded only by Codex)")
  .action(async (opts) => {
    const { runLimits } = await import("./commands/limits.js");
    const r = await runLimits(opts);
    if (r?.exitCode) process.exit(r.exitCode);
  });
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run build && npx vitest run tests/e2e/release-smoke.test.ts -t "lists every documented command"`
Expected: PASS.
Run: `node dist/cli.js limits --help`
Expected: the description and `--json`, `--since <window>` (default: "90d"), `--here`, `--agent <id>`.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/e2e/release-smoke.test.ts
git commit -m "feat(cli): register sipcode limits" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The `today` line

**Files:**
- Modify: `src/modules/today/format-terminal.ts`, `src/commands/today.ts`
- Test: `tests/modules/today/format-terminal.test.ts`, `tests/integration/today-limits.integration.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/modules/today/format-terminal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatTodayTerminal } from "../../../src/modules/today/format-terminal.js";
import { runToday } from "../../../src/modules/today/runToday.js";

const NOW = new Date("2026-10-09T10:00:00.000Z");
const LINE = "Codex weekly limit: 62% used, resets Wed 08:30. At this pace you run out Sat ~13:00.";

describe("formatTodayTerminal limitLine", () => {
  const empty = runToday({ sessions: [], now: NOW, agent: { name: "Codex", command: "codex" } });
  const one = runToday({
    sessions: [
      {
        sessionId: "s1",
        startedAt: "2026-10-09T09:00:00.000Z",
        totalTokens: 1000,
        outputTokens: 100,
        estCostUSD: 0.01,
        duplicateReadTokenCost: 0,
      },
    ],
    now: NOW,
  });

  it("without a line the output is unchanged", () => {
    expect(formatTodayTerminal(empty, { limitLine: undefined })).toBe(formatTodayTerminal(empty));
    expect(formatTodayTerminal(one, { limitLine: undefined })).toBe(formatTodayTerminal(one));
  });

  it("the line is printed last, in every status", () => {
    expect(formatTodayTerminal(empty, { limitLine: LINE })).toBe(`${formatTodayTerminal(empty)}\n${LINE}`);
    expect(formatTodayTerminal(one, { limitLine: LINE })).toBe(`${formatTodayTerminal(one)}\n${LINE}`);
  });
});
```

`tests/integration/today-limits.integration.test.ts` (the second case is the byte-identical guarantee: the same requests with and without limit readings differ by exactly the final line; `--json` is identical):

```ts
/**
 * `sipcode today` adds one Codex limit line in the terminal, and nothing else
 * changes: without limit readings the output is byte-identical, and --json
 * never carries the line.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runTodayCmd } from "../../src/commands/today.js";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import { addWeeklyLimitScenario } from "./codex-fixtures.js";

const NOW = new Date("2026-10-09T10:00:00.000Z");
const LINE = "Codex weekly limit: 62% used, resets Wed 08:30. At this pace you run out Sat ~13:00.";

let savedTz: string | undefined;
beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = "UTC";
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

async function run(opts: Parameters<typeof runTodayCmd>[0], fs: InMemoryFs, now = NOW) {
  const out: string[] = [];
  const err: string[] = [];
  const r = await runTodayCmd(opts, {
    fs,
    env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
    clock: new FakeClock(now),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  });
  return { exitCode: r.exitCode, out: out.join("\n"), err: err.join("\n") };
}

function scenario(readings: boolean): InMemoryFs {
  const fs = new InMemoryFs();
  addWeeklyLimitScenario(fs, { readings });
  return fs;
}

describe("today: Codex limit line", () => {
  it("the Codex output ends with the line for the limit closest to running out", async () => {
    const r = await run({}, scenario(true));
    expect(r.exitCode).toBe(0);
    expect(r.out.split("\n").at(-1)).toBe(LINE);
  });

  it("the line is the only difference from the same requests without limit readings", async () => {
    const withLine = await run({}, scenario(true));
    const without = await run({}, scenario(false));
    expect(without.out).not.toContain("Codex weekly limit");
    expect(withLine.out).toBe(`${without.out}\n${LINE}`);
    expect(withLine.err).toBe(without.err);
  });

  it("--json is unchanged by limit readings", async () => {
    const withLine = await run({ json: true }, scenario(true));
    const without = await run({ json: true }, scenario(false));
    expect(withLine.out).toBe(without.out);
    expect(withLine.out).not.toContain("limit");
  });

  it("no line once the window has reset since its newest reading", async () => {
    const later = new Date("2026-10-15T00:00:00.000Z");
    const withReadings = await run({}, scenario(true), later);
    const without = await run({}, scenario(false), later);
    expect(withReadings.out).toBe(without.out);
  });

  it("--agent claude-code never shows the line", async () => {
    const r = await run({ agent: "claude-code" }, scenario(true));
    expect(r.out).not.toContain("Codex weekly limit");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/modules/today/format-terminal.test.ts tests/integration/today-limits.integration.test.ts`
Expected: FAIL: `the line is printed last, in every status` (no line printed), `the Codex output ends with the line…` and `the line is the only difference…` (last line is the headline). The other cases pass already.

- [ ] **Step 3: Print the line in the formatter**

In `src/modules/today/format-terminal.ts`, replace:

```ts
  opts: { unpricedNote?: string | undefined } = {},
): string {
  const lines: string[] = [];
  const dateLabel = report.today?.dateLocal ?? "today";
  lines.push(`sipcode today · ${dateLabel}`);
  lines.push("");

  if (report.status === "no-data") {
    lines.push("  " + report.headline);
    return lines.join("\n");
  }
```

with:

```ts
  opts: {
    unpricedNote?: string | undefined;
    /** Codex limit line (terminal only), printed last; absent: output unchanged. */
    limitLine?: string | undefined;
  } = {},
): string {
  const lines: string[] = [];
  const dateLabel = report.today?.dateLocal ?? "today";
  lines.push(`sipcode today · ${dateLabel}`);
  lines.push("");

  if (report.status === "no-data") {
    lines.push("  " + report.headline);
    if (opts.limitLine) lines.push(opts.limitLine);
    return lines.join("\n");
  }
```

and at the end of the function replace:

```ts
  lines.push(report.headline);
  return lines.join("\n");
}
```

with:

```ts
  lines.push(report.headline);
  if (opts.limitLine) lines.push(opts.limitLine);
  return lines.join("\n");
}
```

- [ ] **Step 4: Compute the line for the Codex section**

In `src/commands/today.ts`, after `import { formatTodayJson } from "../modules/today/format-json.js";` add:

```ts
import { todayLimitLine } from "../modules/limits/load.js";
```

and replace:

```ts
  } else {
    stdout(
      formatTodayTerminal(report, {
        unpricedNote: hasUnpriced ? MESSAGES.unpricedTokens(unpriced) : undefined,
      }),
    );
  }
```

with:

```ts
  } else {
    // Codex limit line: terminal only, and only when Codex logged limit readings.
    const limitLine = agent.id === "codex" ? await todayLimitLine({ fs, env, clock }, now) : undefined;
    stdout(
      formatTodayTerminal(report, {
        unpricedNote: hasUnpriced ? MESSAGES.unpricedTokens(unpriced) : undefined,
        limitLine,
      }),
    );
  }
```

- [ ] **Step 5: Run them to verify they pass**

Run: `npx vitest run tests/modules/today tests/integration/today-limits.integration.test.ts tests/integration/today.integration.test.ts tests/integration/period-commands-cache.integration.test.ts`
Expected: PASS (the existing today tests are unchanged: their rollouts have no limit readings).

- [ ] **Step 6: Commit**

```bash
git add src/modules/today/format-terminal.ts src/commands/today.ts tests/modules/today/format-terminal.test.ts tests/integration/today-limits.integration.test.ts
git commit -m "feat(today): one line for the Codex limit closest to running out" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: MCP tool `get_codex_limits` (16 tools)

**Files:**
- Modify: `src/mcp/server.ts`, `tests/mcp/agent-param.test.ts`, `tests/mcp/server.integration.test.ts`, `tests/e2e/release-smoke.test.ts`, `tests/e2e/mcp-import-side-effect.test.ts`
- Test: `tests/mcp/codex-limits.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/mcp/codex-limits.test.ts`:

```ts
/** MCP get_codex_limits: the JSON of `sipcode limits --json`, with an optional `since`. */
import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import { callTool, listToolDefinitions, type McpToolDeps } from "../../src/mcp/server.js";
import { addShrinkScenario, addWeeklyLimitScenario } from "../integration/codex-fixtures.js";

function deps(fs: InMemoryFs, now: string): McpToolDeps {
  return {
    fs,
    env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
    clock: new FakeClock(new Date(now)),
    cwd: "/w",
  };
}

async function call(args: Record<string, unknown>, fs: InMemoryFs, now = "2026-10-09T10:00:00.000Z") {
  const r = await callTool("get_codex_limits", args, deps(fs, now));
  const texts = r.content.map((c) => (c.type === "text" ? c.text : ""));
  return { isError: r.isError === true, texts, text: texts[0] ?? "" };
}

describe("get_codex_limits", () => {
  it("is registered with an optional since and no agent input", () => {
    const def = listToolDefinitions().find((d) => d.name === "get_codex_limits");
    expect(def).toBeDefined();
    const props = (def!.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toEqual(["since"]);
    expect(def!.description).toContain("Codex");
  });

  it("returns the limits --json output as one text item", async () => {
    const fs = new InMemoryFs();
    addWeeklyLimitScenario(fs);
    const r = await call({}, fs);
    expect(r.isError).toBe(false);
    expect(r.texts).toHaveLength(1);
    const j = JSON.parse(r.text);
    expect(j.agent).toBe("codex");
    expect(j.windows[0].usedPercent).toBe(62);
    expect(j.windows[0].label).toBe("Weekly");
  });

  it("since narrows the tokens-per-1% history", async () => {
    const fs = new InMemoryFs();
    addShrinkScenario(fs);
    const all = JSON.parse((await call({}, fs, "2026-10-09T00:00:00.000Z")).text);
    expect(all.windows[0].possibleCut).toEqual({ at: "2026-09-15", factor: 4 });
    const recent = JSON.parse((await call({ since: "7d" }, fs, "2026-10-09T00:00:00.000Z")).text);
    expect(recent.windows[0].tokensPerPercent).toEqual([]);
  });

  it("no Codex logs: an empty windows list, not an error", async () => {
    const r = await call({}, new InMemoryFs());
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.text)).toEqual({ agent: "codex", planType: null, asOf: null, windows: [] });
  });

  it("a bad since is a tool error with the E010 message", async () => {
    const fs = new InMemoryFs();
    addWeeklyLimitScenario(fs);
    const r = await call({ since: "yesterday" }, fs);
    expect(r.isError).toBe(true);
    expect(r.text).toContain("[E010]");
  });

  it("a since that is not a string is an argument error", async () => {
    const r = await call({ since: 5 }, new InMemoryFs());
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^Invalid arguments for get_codex_limits: since/);
  });
});
```

Update the count everywhere it is asserted:

- `tests/mcp/agent-param.test.ts`: `it("the seven tools that read session logs take an optional agent; the count stays 15", () => {` → `it("the seven tools that read session logs take an optional agent; the count is 16", () => {`, and `expect(defs).toHaveLength(15);` → `expect(defs).toHaveLength(16);`.
- `tests/mcp/server.integration.test.ts`: `it("registers exactly the fifteen documented tools", () => {` → `it("registers exactly the sixteen documented tools", () => {`; replace `      expect(result.tools).toHaveLength(15);` with:

```ts
      expect(result.tools).toContain("get_codex_limits");
      expect(result.tools).toHaveLength(16);
```

- `tests/e2e/release-smoke.test.ts`: `expect(r.startupLog).toContain("15 tools");` → `expect(r.startupLog).toContain("16 tools");`; `"registers exactly the 15 documented MCP tools",` → `"registers exactly the 16 documented MCP tools",`; in the sorted name list insert `"get_codex_limits",` between `"get_agent_score",` and `"get_drift_report",`.
- `tests/e2e/mcp-import-side-effect.test.ts`: `expect(output).toContain("TOOLS=15");` → `expect(output).toContain("TOOLS=16");`.

(`tests/commands/init-system-setup.test.ts` mocks its own count and does not read the registry; leave it.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/mcp/codex-limits.test.ts tests/mcp/agent-param.test.ts`
Expected: FAIL: `get_codex_limits` is not defined (`expected undefined to be defined`, `Unknown tool: get_codex_limits`) and `expected [...] to have a length of 16 but got 15`.

- [ ] **Step 3: Add the tool**

In `src/mcp/server.ts`, update the header comment:

```ts
 * Tools exposed: the 15 in TOOL_DEFS below (session audits and lists,
 * stats, today, forecast, drift, impact, manifest, estimate, score, proxy
 * status / install / uninstall, server info). The seven that read session
 * logs take an optional `agent` ("claude-code" | "codex").
```

→

```ts
 * Tools exposed: the 16 in TOOL_DEFS below (session audits and lists,
 * stats, today, forecast, drift, impact, Codex limits, manifest, estimate,
 * score, proxy status / install / uninstall, server info). The seven that
 * read session logs take an optional `agent` ("claude-code" | "codex");
 * get_codex_limits reads Codex only and takes an optional `since`.
```

After `toolForecastMonthlySpend` (the function ending in `return commandResult(r.exitCode, c, "forecast failed");` / `}`), add:

```ts

/** `sipcode limits --json` as a tool: Codex usage limits from the local Codex logs. */
export async function toolGetCodexLimits(
  opts: { since?: string } = {},
  deps: McpToolDeps = {},
): Promise<CallToolResult> {
  const { runLimits } = await import("../commands/limits.js");
  const { fs, env, clock, cwd } = resolveDeps(deps);
  const c = new Captured();
  const r = await runLimits(
    { json: true, cwd, ...(opts.since !== undefined ? { since: opts.since } : {}) },
    { fs, env, clock, stdout: c.stdout, stderr: c.stderr },
  );
  return commandResult(r.exitCode, c, "limits failed");
}
```

At the end of `TOOL_DEFS`, replace the closing of the `get_drift_report` entry:

```ts
    inputSchema: { type: "object", properties: { agent: AGENT_INPUT } },
    schema: z.object({ agent: z.enum(AGENT_IDS).optional() }),
  },
] as const;
```

with:

```ts
    inputSchema: { type: "object", properties: { agent: AGENT_INPUT } },
    schema: z.object({ agent: z.enum(AGENT_IDS).optional() }),
  },
  {
    name: "get_codex_limits",
    description:
      "Codex usage limits from the readings Codex writes into its local logs (zero network calls). For each limit window (5-hour, weekly, 30-day): percent used, reset time, and when it runs out at the current pace; which sessions and projects used it; and how many tokens 1% of the limit bought per finished period, with a cautious possible-limit-cut flag. Returns the JSON of `sipcode limits --json`. Use when the user asks 'when will I hit my Codex limit?', 'what used up my Codex limit?' or 'did my Codex limit shrink?'. Codex only: Claude Code's logs do not record limits.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description: "How far back the tokens-per-1% history goes: 7d | 30d | 90d | all | yyyy-mm-dd. Default 90d.",
        },
      },
    },
    schema: z.object({ since: z.string().min(1).optional() }),
  },
] as const;
```

In `callTool`'s switch, after the `forecast_monthly_spend` case:

```ts
      case "forecast_monthly_spend": {
        return await withTimeout(name, 10_000, toolForecastMonthlySpend(agentOpt, deps));
      }
```

add:

```ts
      case "get_codex_limits": {
        const since = args["since"] as string | undefined;
        return await withTimeout(
          name,
          15_000,
          toolGetCodexLimits(since !== undefined ? { since } : {}, deps),
          "your Codex logs may be large: run `sipcode limits` in your terminal",
        );
      }
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run tests/mcp tests/guards/mcp-tool-timeouts.test.ts tests/guards/mcp-safety-nets.test.ts`
Expected: PASS (`server.integration.test.ts` is skipped until a build exists).
Run: `npm run build && npx vitest run tests/e2e tests/mcp/server.integration.test.ts` (background)
Expected: PASS: `connected (sipcode v1.7.0, 16 tools)`, 16 names, `TOOLS=16`.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts tests/mcp/codex-limits.test.ts tests/mcp/agent-param.test.ts tests/mcp/server.integration.test.ts tests/e2e/release-smoke.test.ts tests/e2e/mcp-import-side-effect.test.ts
git commit -m "feat(mcp): get_codex_limits tool (16 tools)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Independent limits check in `scripts/verify-counts.mjs`

**Files:**
- Modify: `scripts/verify-counts.mjs` (dev only, not shipped; it must import nothing from `src/` or `dist/`)

- [ ] **Step 1: Document the re-implemented rules**

In the header comment, replace the line `// - Days: today = local calendar day; stats/trend/baseline buckets = UTC days.` with:

```js
// - Days: today = local calendar day; stats/trend/baseline buckets = UTC days.
// - Codex limits (`limits --json --since all`): a reading is payload.rate_limits
//   on an event_msg / token_count line, one per non-null window (resets_at in
//   epoch seconds; above 1e12 already ms). Readings sorted by time, reset time,
//   percent. Window = limit_id + window_minutes. Stale readings are skipped:
//   one logged after its own reset time, and one whose reset time is more than
//   15 min earlier than the open period's. A new period starts when the reset
//   time moves by more than max(15 min, 1% of the window), when the reading is
//   past the period's reset time, or when the reset time moves more than 15 min
//   later while the percent is below the period's running maximum. Period
//   start = min(newest reset time minus the window, first reading), but never
//   before the previous period's newest reading. A rise of the running maximum
//   is shared by the requests since the previous rise, by tokens; with none it
//   is unattributed. Tokens per 1%: finished periods (not the window's last, or
//   reset before the newest reading), 20% or more used, 90% or more of tokens
//   from one model; a cut is the first period at or below half the median of
//   2+ earlier ones (same model).
```

- [ ] **Step 2: Share the rollout walk**

Replace the start of `readCodex()`:

```js
function readCodex() {
  const byName = new Map();
  for (const sub of ["sessions", "archived_sessions"]) {
    const walk = (dir) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl") && !byName.has(e.name))
          byName.set(e.name, p);
      }
    };
    walk(join(CODEX_HOME, sub));
  }
  const out = [];
```

with:

```js
/** Rollout files by name; sessions/ is walked first and wins over archived_sessions/. */
function listRollouts() {
  const byName = new Map();
  for (const sub of ["sessions", "archived_sessions"]) {
    const walk = (dir) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl") && !byName.has(e.name))
          byName.set(e.name, p);
      }
    };
    walk(join(CODEX_HOME, sub));
  }
  return byName;
}

function readCodex() {
  const byName = listRollouts();
  const out = [];
```

- [ ] **Step 3: Add the limits computation and comparison**

Insert before the `// Main` section header (the three lines `// ---…`, `// Main`, `// ---…`):

```js
// ---------------------------------------------------------------------------
// Codex limits
// ---------------------------------------------------------------------------

const MIN = 60_000;
const AUTO_REVIEW = "codex-auto-review";

/** Every limit reading in the Codex logs, in reading order. */
function limitReadings() {
  const out = [];
  let malformed = 0;
  for (const p of listRollouts().values()) {
    for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
      if (!raw.includes('"rate_limits"')) continue;
      let e;
      try {
        e = JSON.parse(raw);
      } catch {
        malformed++;
        continue;
      }
      if (!e || e.type !== "event_msg" || e.payload?.type !== "token_count") continue;
      const rl = e.payload.rate_limits;
      if (rl === null || rl === undefined) continue;
      const at = typeof e.timestamp === "string" ? Date.parse(e.timestamp) : NaN;
      if (typeof rl !== "object" || !Number.isFinite(at)) {
        malformed++;
        continue;
      }
      for (const slot of ["primary", "secondary"]) {
        const w = rl[slot];
        if (w === null || w === undefined) continue;
        const ok = [w.used_percent, w.window_minutes, w.resets_at].every((x) => typeof x === "number" && Number.isFinite(x));
        if (!ok || w.used_percent < 0 || w.window_minutes <= 0 || w.resets_at <= 0) {
          malformed++;
          continue;
        }
        out.push({
          at,
          limitId: (typeof rl.limit_id === "string" && rl.limit_id) || "codex",
          plan: (typeof rl.plan_type === "string" && rl.plan_type) || null,
          wm: w.window_minutes,
          pct: w.used_percent,
          resetsAt: w.resets_at > 1e12 ? w.resets_at : w.resets_at * 1000,
        });
      }
    }
  }
  out.sort((a, b) => a.at - b.at || a.resetsAt - b.resetsAt || a.pct - b.pct);
  return { readings: out, malformed };
}

/** Windows (key "limitId|minutes") with their periods: reset time, max, newest time, rises. */
function limitWindows(readings) {
  const windows = new Map();
  for (const r of readings) {
    if (r.at > r.resetsAt) continue; // stale: logged after its own reset time
    const key = `${r.limitId}|${r.wm}`;
    let w = windows.get(key);
    if (!w) windows.set(key, (w = { limitId: r.limitId, wm: r.wm, periods: [] }));
    const cur = w.periods.at(-1);
    if (cur && cur.resetsAt - r.resetsAt > 15 * MIN) continue; // stale: an earlier reset time than the open period's
    const shift = cur ? r.resetsAt - cur.resetsAt : 0;
    if (
      !cur ||
      Math.abs(shift) > Math.max(15 * MIN, r.wm * MIN * 0.01) ||
      r.at > cur.resetsAt ||
      (shift > 15 * MIN && r.pct < cur.max)
    ) {
      w.periods.push({ resetsAt: r.resetsAt, max: r.pct, first: r.at, newest: r.at, rises: r.pct > 0 ? [{ at: r.at, rise: r.pct }] : [] });
      continue;
    }
    if (r.pct > cur.max) {
      cur.rises.push({ at: r.at, rise: r.pct - cur.max });
      cur.max = r.pct;
    }
    cur.resetsAt = r.resetsAt;
    cur.newest = r.at;
  }
  for (const w of windows.values())
    w.periods.forEach((p, i) => {
      p.start = Math.max(Math.min(p.resetsAt - w.wm * MIN, p.first), i > 0 ? w.periods[i - 1].newest : -Infinity);
    });
  return windows;
}

const inPeriod = (p, requests) =>
  requests.filter((r) => r.at > p.start && r.at <= p.newest).sort((a, b) => a.at - b.at);

/** Per line of "what used it" (session id, or codex-auto-review): percent and tokens; plus unattributed. */
function attributeLimit(p, requests) {
  const rs = inPeriod(p, requests);
  const lines = new Map();
  const line = (r) => {
    const key = r.model === AUTO_REVIEW ? AUTO_REVIEW : r.session;
    let l = lines.get(key);
    if (!l) lines.set(key, (l = { percent: 0, tokens: 0 }));
    return l;
  };
  for (const r of rs) line(r).tokens += r.tokens;
  let unattributed = 0;
  let k = 0;
  for (const { at, rise } of p.rises) {
    const group = [];
    while (k < rs.length && rs[k].at <= at) group.push(rs[k++]);
    const t = group.reduce((a, r) => a + r.tokens, 0);
    if (t === 0) {
      unattributed += rise;
      continue;
    }
    for (const r of group) line(r).percent += (rise * r.tokens) / t;
  }
  if (lines.get(AUTO_REVIEW)?.percent === 0) lines.delete(AUTO_REVIEW);
  return { lines, unattributed };
}

/** Comparable periods (tokens per 1%) and the first possible cut. */
function shrinkLimit(w, requests, asOf) {
  const points = [];
  const last = w.periods.at(-1);
  for (const p of w.periods) {
    if (!(p !== last || p.resetsAt < asOf) || p.max < 20) continue;
    const rs = inPeriod(p, requests);
    const total = rs.reduce((a, r) => a + r.tokens, 0);
    const byModel = new Map();
    for (const r of rs) if (r.model) byModel.set(r.model, (byModel.get(r.model) ?? 0) + r.tokens);
    let top;
    for (const [m, t] of byModel) if (!top || t > top[1]) top = [m, t];
    if (!top || total === 0 || top[1] / total < 0.9) continue;
    points.push({ model: top[0], start: p.start, raw: total / p.max, share: top[1] / total });
  }
  let cut = null;
  for (let i = 0; i < points.length && !cut; i++) {
    const earlier = points.slice(0, i).filter((q) => q.model === points[i].model).map((q) => q.raw);
    if (earlier.length < 2) continue;
    const base = median(earlier);
    if (points[i].raw <= base / 2)
      cut = { at: new Date(points[i].start).toISOString().slice(0, 10), factor: Math.round((base / points[i].raw) * 10) / 10 };
  }
  return { points, cut };
}

function limitsChecks(codexFiles, pass) {
  const tag = `[codex limits ${pass}]`;
  const { readings, malformed } = limitReadings();
  const run = sipcode(["limits", "--json", "--since", "all"]);
  const j = run.json;
  console.log(`${tag} ${readings.length} readings, ${malformed} unreadable`);
  if (readings.length === 0) {
    check(`${tag} windows (no readings)`, 0, j?.windows?.length ?? -1);
    return;
  }
  const newest = readings.at(-1);
  const asOf = newest.at;
  const windows = limitWindows(readings);
  check(`${tag} as of`, new Date(asOf).toISOString(), j?.asOf);
  check(`${tag} plan`, newest.plan, j?.planType);
  check(`${tag} windows`, windows.size, j?.windows?.length);
  const requests = codexFiles
    .flatMap((f) => f.own.map((r) => ({ at: ms(r.ts), tokens: tokensOf(r), model: r.model, session: f.id })))
    .filter((r) => r.at !== undefined && r.tokens > 0);
  let mixed = 0;
  for (const w of windows.values()) {
    const label = `${tag} ${w.limitId} ${w.wm}-minute window`;
    const theirs = j?.windows?.find((x) => x.limitId === w.limitId && x.windowMinutes === w.wm);
    const cur = w.periods.at(-1);
    check(`${label} periods`, w.periods.length, theirs?.periodCount);
    check(`${label} newest percent`, cur.max, theirs?.usedPercent);
    check(`${label} resets at`, new Date(cur.resetsAt).toISOString(), theirs?.resetsAt);

    // What used the newest period: attributed + unattributed = observed rise, line by line equal.
    const a = attributeLimit(cur, requests);
    const usedBy = theirs?.usedBy ?? [];
    const mine = [...a.lines.values()].reduce((s, l) => s + l.percent, 0) + a.unattributed;
    const sip = usedBy.reduce((s, u) => s + u.percent, 0) + (theirs?.unattributedPercent ?? NaN);
    check(`${label} attributed + unattributed = observed rise (independent)`, cur.max, mine, 1e-9);
    check(`${label} attributed + unattributed = observed rise (sipcode)`, cur.max, sip, 1e-9);
    check(`${label} unattributed percent`, a.unattributed, theirs?.unattributedPercent, 1e-9);
    check(`${label} what-used lines`, a.lines.size, usedBy.length);
    let differing = 0;
    for (const [key, l] of a.lines) {
      const u = usedBy.find((x) => x.sessionId === key);
      if (!u || Math.abs(u.percent - l.percent) > 1e-9 || u.tokens !== l.tokens) differing++;
    }
    check(`${label} what-used lines differing`, 0, differing);

    // Tokens per 1% and the possible cut.
    const s = shrinkLimit(w, requests, asOf);
    const tpp = theirs?.tokensPerPercent ?? [];
    check(`${label} tokens-per-1% periods`, s.points.length, tpp.length);
    differing = 0;
    s.points.forEach((p, i) => {
      const t = tpp[i];
      if (!t || t.model !== p.model || t.periodStart !== new Date(p.start).toISOString() || t.tokensPerPercent !== Math.round(p.raw))
        differing++;
    });
    check(`${label} tokens-per-1% periods differing`, 0, differing);
    check(`${label} possible cut`, JSON.stringify(s.cut), JSON.stringify(theirs?.possibleCut ?? null));
    // Mixed-model periods are never compared: every period Sipcode lists has 90%+ of its tokens from its model.
    for (const t of tpp) {
      const p = s.points.find((x) => new Date(x.start).toISOString() === t.periodStart);
      if (!p || p.model !== t.model || p.share < 0.9) mixed++;
    }
    if (s.cut) console.log(`${label}: possible cut around ${s.cut.at} (${s.cut.factor}x)`);
  }
  check(`${tag} periods compared with mixed models`, 0, mixed);
}

```

(`median`, `ms`, `tokensOf`, `check` and `sipcode` already exist in the script.)

- [ ] **Step 4: Run it in both cache passes**

In `main()`, replace:

```js
        compareAgent(agent, files, pass);
    }
```

with:

```js
        compareAgent(agent, files, pass);
      limitsChecks(codex, pass);
    }
```

- [ ] **Step 5: Run it on the real Codex logs**

Run (background; an empty Claude folder keeps the run short, Sipcode runs with a temporary HOME so nothing under `~/.sipcode` changes):

```bash
mkdir -p "$SCRATCH/empty-claude"
npm run build
SIPCODE_PROJECTS_DIR="$SCRATCH/empty-claude" CODEX_HOME="$(cygpath -m "$HOME/.codex")" node scripts/verify-counts.mjs > "$SCRATCH/verify-limits.txt" 2>&1; echo "exit $?"
grep -E "limits|all checks match|mismatch" "$SCRATCH/verify-limits.txt"
```

Expected (maintainer's machine): exit 0, `all checks match`, and for each pass `1146 readings, 0 unreadable`, `codex 10080-minute window periods: independent 3, sipcode 3`, `codex 43200-minute window periods: independent 5, sipcode 5`, `codex 10080-minute window possible cut: independent {"at":"2026-04-13","factor":5.1}, sipcode {"at":"2026-04-13","factor":5.1}`, `periods compared with mixed models: independent 0, sipcode 0`.

- [ ] **Step 6: Prove the check catches a wrong period rule**

Temporarily delete the line `(shift > EARLY_RESET_MS && r.usedPercent < cur.usedPercent)` and the `||` before it in `src/modules/limits/periods.ts`, run `npm run build`, rerun Step 5's command.
Expected: exit 1 with `MISMATCH … codex 43200-minute window periods: independent 5, sipcode 3`.
Restore the file (`git checkout src/modules/limits/periods.ts`), `npm run build`, rerun Step 5: exit 0.

- [ ] **Step 7: Commit**

```bash
git add scripts/verify-counts.mjs
git commit -m "chore(verify): independent Codex limits computation in verify-counts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Docs (README, CHANGELOG, PRIVACY, site, 16 tools)

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `PRIVACY.md`, `package.json` (description only), `docs/site/public/llms.txt`, `docs/site/public/llms-full.txt`, `docs/site/src/components/FaqSection.astro`, `docs/site/src/components/LayersSection.astro`

- [ ] **Step 1: README**

Comparison table:
- `| **Self-introspection MCP tools** | ✓ 15 tools | ✗ | ✗ | partial |` → `| **Self-introspection MCP tools** | ✓ 16 tools | ✗ | ✗ | partial |`
- In the `**Agents covered**` row: `OpenAI Codex (spend analytics only, no hook)` → `OpenAI Codex (spend analytics and usage limits, no hook)`

In `## Codex`, replace the line starting `**Commands that read Codex:**` with:

```markdown
**Commands that read Codex:** `stats`, `today`, `forecast`, `trend`, `impact`, `why`, `receipt`, `drift` and `limits` (Codex only), plus the session tools in the MCP server (they take an optional `agent` input: `"claude-code"` or `"codex"`) and `get_codex_limits`.
```

After the paragraph starting `**Not supported for Codex yet:**` (before the `---` that ends the section), insert:

````markdown

### Codex limits: `sipcode limits`

Codex writes your plan's usage-limit readings into its own logs after each request. `sipcode limits` reads them, with zero network calls, and answers three questions: when will I hit my limit, what used it, and did it shrink.

```
sipcode limits · Codex · plan: go · as of 2h ago (your last Codex request)

Weekly limit    62% used   resets Wed 14 Oct 14:00   at this pace: runs out Tue 13 Oct ~18:00
30-day limit    41% used   resets Mon 2 Nov          at this pace: lasts until reset

What used your weekly limit (since Wed 7 Oct)
  0199a1b2-c3d4-7a11   sipcode       19%   3.1M tokens
  0199a0f7-11aa-7b02   my-app        12%   1.4M tokens
  codex-auto-review (9 requests)      6%

Tokens per 1% of your weekly limit (gpt-5.4)
  Mar 28: 425K   Apr 1: 357K   Apr 13: 80K
  Possible limit cut around Apr 13: 4.9x fewer tokens per 1%.
  Limits cover your whole account. Codex use on other devices or in the cloud
  is not in these logs and can look like a cut.
```

- **Every limit window the logs report** (5-hour, weekly, 30-day): percent used, reset time, and when it runs out at the pace of the current period. "as of" is your last Codex request: the numbers are only as fresh as that.
- **What used it:** the current period's top 5 sessions and projects (folder name only), plus Codex's automatic reviews as one line. Each rise in the percent is shared by the requests made since the previous rise, in proportion to their tokens. A rise with no request on this computer shows as `unattributed`, because limits are shared with your other devices and Codex cloud.
- **Did it shrink:** how many tokens 1% of the limit bought in each finished period with at least 20% used, compared only within one model (a period counts when 90% or more of its tokens came from one model). `Possible limit cut` appears when a period bought at most half the median of at least two earlier periods. It always says "possible": Codex use on another device raises the percent without local tokens.
- **Options:** `--json`; `--since <window>` (default `90d`), how far back the tokens-per-1% history goes; `--here` narrows only the "what used it" list to sessions from the current folder (limits are account-wide).
- `sipcode today` adds one line for the Codex limit closest to running out, when Codex has logged limit readings. `today --json` is unchanged.
- MCP: `get_codex_limits` (optional `since`) returns the same JSON as `sipcode limits --json`.
- Claude Code's logs do not record limits, so `limits --agent claude-code` stops with error E009.
````

`## What you get` table:
- `| MCP server | 15 tools registered for Claude Desktop, so you can ask Claude itself about your usage |` → `| MCP server | 16 tools registered for Claude Desktop, so you can ask Claude itself about your usage |`
- After the `| Spend telemetry | … |` row add: `| Codex limits | When you will hit your Codex limit, what used it, and whether it may have shrunk |`

`## Commands` table, after the `` | `sipcode forecast` | … | `` row add:

```markdown
| `sipcode limits` | Codex usage limits: when you run out at this pace, what used them, tokens per 1% over time |
```

- [ ] **Step 2: CHANGELOG**

Replace:

```markdown
## [Unreleased]

_Nothing landed since [1.7.0]._
```

with:

```markdown
## [Unreleased]

_Nothing landed since [1.7.1]._

## [1.7.1] - 2026-10-11

Sipcode now reads the usage-limit readings Codex writes into its own logs: when you will hit your Codex limit, what used it, and whether it may have shrunk.

### Added
- **`sipcode limits` (Codex).** For each limit window the logs report (5-hour, weekly, 30-day, named from the window length): percent used, reset time, and when it runs out at the current pace. Zero network calls; "as of" is your last Codex request.
- **What used it.** The current period's top 5 sessions and projects (folder name only), with Codex's automatic reviews (`codex-auto-review`) as one line. Each rise in the percent is shared by the requests made since the previous rise, in proportion to their tokens; a rise with no request on this computer is shown as unattributed, since limits are shared with other devices and Codex cloud. Attributed plus unattributed equals the percent used.
- **Tokens per 1%, and a possible limit cut.** How many tokens 1% of a limit bought in each finished period with at least 20% used, compared only within one model (90% or more of the period's tokens). A period that bought at most half the median of at least two earlier periods is flagged as a possible limit cut, with a note that Codex use on other devices or in the cloud can look like one. On the maintainer's logs this flags the week of Apr 13 (77K tokens per 1% against 425K and 357K, gpt-5.4).
- **Options:** `--json`, `--since <window>` (default `90d`, how far back the tokens-per-1% history goes), `--here` (narrows only the "what used it" list). `--agent claude-code` stops with E009: Claude Code's logs do not record limits.
- **`today`** adds one line for the Codex limit closest to running out, when Codex has logged limit readings. Without them the output is byte-identical; `today --json` is unchanged.
- **MCP:** new tool `get_codex_limits` (optional `since`) returns the same JSON as `sipcode limits --json`. 16 tools.
- **Independent check:** `scripts/verify-counts.mjs` recomputes the limits from the raw logs without Sipcode code (newest percent and number of periods per window, the "what used it" lines of the current period, tokens per 1%, the possible cut) and compares them with `limits --json`. All match on the maintainer's 15 Codex logs (1,146 readings).

### Notes
- A limit that resets early (seen on a 30-day window right after it reached 100%) starts a new period even when the new reset time is within the drift tolerance.
- Older Codex versions refresh the limit reading once per turn, so a rise is shared by the requests since the previous rise, not only those since the previous reading.
```

- [ ] **Step 3: PRIVACY.md**

In the `~/.codex/sessions/` bullet, replace:

```markdown
read-only, by `stats`, `today`, `forecast`, `trend`, `impact`, `why`, `receipt` and `drift` (and the MCP session tools) when Codex is installed.
```

with:

```markdown
read-only, by `stats`, `today`, `forecast`, `trend`, `impact`, `why`, `receipt`, `drift` and `limits` (and the MCP session tools and `get_codex_limits`) when Codex is installed. `limits` and `today` also read the usage-limit readings Codex writes into those logs (percent used, window length, reset time, plan type); nothing new is stored.
```

In the usage-cache bullet, replace ``(`today`, `forecast`):`` with ``(`today`, `forecast`, `limits`):``.

- [ ] **Step 4: package.json description, site and llms files (15 → 16 tools)**

Exact replacements (old → new):

| File | Old | New |
|---|---|---|
| `package.json` | `and 15 MCP tools for Claude Desktop.` | `and 16 MCP tools for Claude Desktop.` |
| `docs/site/src/components/FaqSection.astro` | `Sipcode ships 15 MCP tools.` | `Sipcode ships 16 MCP tools.` |
| `docs/site/src/components/FaqSection.astro` | `via 15 MCP tools` | `via 16 MCP tools` |
| `docs/site/src/components/LayersSection.astro` | `15 MCP tools · zero network calls` | `16 MCP tools · zero network calls` |
| `docs/site/public/llms.txt` and `llms-full.txt` | `exposes 15 MCP tools` | `exposes 16 MCP tools` |
| `docs/site/public/llms.txt` | `exposing 15 tools` | `exposing 16 tools` |
| `docs/site/public/llms-full.txt` (the "MCP server" table row) | `15 tools registered for Claude Desktop` | `16 tools registered for Claude Desktop` |
| `docs/site/public/llms-full.txt` | `server with 15 tools` | `server with 16 tools` |

In both llms files, line 9 ends with `The proxy, hooks and rules are not supported for Codex yet.`; append to that line:

```markdown
 `sipcode limits` reads the usage-limit readings Codex writes into its logs: percent used per limit window, when it runs out at the current pace, which sessions used it, and how many tokens 1% bought over time, with a cautious possible-limit-cut flag.
```

In `docs/site/public/llms.txt`, after the line ``- `verify_sipcode_impact`: before vs after comparison sourced from transcripts`` add:

```markdown
- `get_codex_limits`: when you will hit your Codex limit, what used it, and whether it may have shrunk
```

In `docs/site/public/llms-full.txt`, after the line ``- `forecast_monthly_spend`: month-end projection with confidence range`` add:

```markdown
- `get_codex_limits`: Codex usage limits: percent used, run-out time at the current pace, what used them, tokens per 1% over time
```

- [ ] **Step 5: Check no stale count or dash slipped in**

Run: `grep -rnE "15 (MCP )?tools|fifteen" README.md package.json docs/site/public/llms.txt docs/site/public/llms-full.txt docs/site/src/components`
Expected: no output.
Run: `git diff -U0 | grep -nP "^\+.*[\x{2013}\x{2014}]"`
Expected: one hit only, the `FaqSection.astro` answer whose two em dashes predate this change (only its tool count changed). No new en or em dashes.

- [ ] **Step 6: Commit**

```bash
git add README.md CHANGELOG.md PRIVACY.md package.json docs/site/public/llms.txt docs/site/public/llms-full.txt docs/site/src/components/FaqSection.astro docs/site/src/components/LayersSection.astro
git commit -m "docs: Codex limits (README, CHANGELOG, PRIVACY, site, 16 MCP tools)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Full verification on frozen real logs

**Files:** none changed (fix and re-run on any failure; each fix is its own commit with a test that fails without it).

- [ ] **Step 1: Typecheck, build, tests**

```bash
npm run lint
npm run build
NO_COLOR=1 npx vitest run > "$SCRATCH/vitest-full.txt" 2>&1; echo "exit $?"   # background
npm run test:e2e                                                             # background
```

Expected: lint clean; build ends `copy-assets: 7 file(s) copied to dist/.`; vitest exit 0 with no failed or skipped tests; e2e 19 tests pass (`16 tools`, `get_codex_limits`, `limits` in `--help`).
Known load flake, unrelated to this change: `tests/modules/hygiene/hookScript.test.ts > emits a hint after a git commit bash call` spawns a hook with a 5-second timeout and can time out while the whole suite runs. If it is the only failure, rerun `npx vitest run tests/modules/hygiene/hookScript.test.ts` alone: it must pass (22 tests).

- [ ] **Step 2: Freeze a copy of the real logs** (background; the Claude folder can be several GB)

```bash
SNAP="$SCRATCH/snap"
mkdir -p "$SNAP/claude" "$SNAP/codex" "$SCRATCH/empty-codex"
cp -r "$HOME/.claude/projects/." "$SNAP/claude/"
cp -r "$HOME/.codex/sessions" "$SNAP/codex/sessions"
if [ -d "$HOME/.codex/archived_sessions" ]; then cp -r "$HOME/.codex/archived_sessions" "$SNAP/codex/archived_sessions"; fi
```

- [ ] **Step 3: Independent cross-check on the frozen copy** (background)

```bash
SIPCODE_PROJECTS_DIR="$SNAP/claude" CODEX_HOME="$SNAP/codex" node scripts/verify-counts.mjs > "$SCRATCH/verify-full.txt" 2>&1; echo "exit $?"
tail -3 "$SCRATCH/verify-full.txt"; grep -c MISMATCH "$SCRATCH/verify-full.txt"
```

Expected: exit 0, `all checks match`, 0 MISMATCH (every period command for both tools, plus the limits checks in both cache passes).

- [ ] **Step 4: Real-data checks** (temporary HOME so the real `~/.sipcode` cache is untouched)

```bash
mkdir -p "$SCRATCH/home-limits"
export HOME_LIMITS="$SCRATCH/home-limits"
HOME="$HOME_LIMITS" USERPROFILE="$HOME_LIMITS" CODEX_HOME="$SNAP/codex" node dist/cli.js limits --since all
HOME="$HOME_LIMITS" USERPROFILE="$HOME_LIMITS" CODEX_HOME="$SNAP/codex" node dist/cli.js limits --since all --json > "$SCRATCH/limits-all.json"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); for (const w of j.windows) console.log(w.label, w.periodCount, JSON.stringify(w.possibleCut), w.tokensPerPercent.map(p=>p.model+"@"+p.periodStart.slice(0,10)+"="+p.tokensPerPercent).join(" "))' "$SCRATCH/limits-all.json"
```

Expected on the maintainer's logs:
- Terminal: under `Tokens per 1% of your weekly limit (gpt-5.4)`: `Mar 28: 425K   Apr 1: 357K   Apr 13: 77K` and `Possible limit cut around Apr 13: 5.1x fewer tokens per 1%.` plus the two caveat lines. The weekly row reads `reset since your last Codex request (at Mon 20 Apr)`.
- JSON summary: `Weekly 3 {"at":"2026-04-13","factor":5.1} gpt-5.4@2026-03-28=424592 gpt-5.4@2026-04-01=357451 gpt-5.4@2026-04-13=77401` and `30-day 5 null gpt-5.5@2026-06-22=31597 gpt-5.5@2026-07-05=46343 gpt-5.5@2026-07-05=50824 gpt-5.5@2026-07-05=38518`.
- Mixed models are never compared: the current 30-day period (95.5% gpt-5.6-terra, not finished) is absent, every listed period has one model, and verify-counts printed `periods compared with mixed models: independent 0, sipcode 0`.

- [ ] **Step 5: `today` byte-identical without Codex limit data, against main's build**

```bash
git worktree add --detach "$SCRATCH/main-wt" main
cmd //c mklink /J "$(cygpath -w "$SCRATCH/main-wt/node_modules")" "$(cygpath -w "$PWD/node_modules")"
(cd "$SCRATCH/main-wt" && npx tsc -p tsconfig.json && node scripts/copy-assets.mjs)
mkdir -p "$SCRATCH/home-main" "$SCRATCH/home-branch"
HOME="$SCRATCH/home-main" USERPROFILE="$SCRATCH/home-main" CODEX_HOME="$SCRATCH/empty-codex" SIPCODE_PROJECTS_DIR="$SNAP/claude" node "$SCRATCH/main-wt/dist/cli.js" today > "$SCRATCH/today-main.txt"
HOME="$SCRATCH/home-branch" USERPROFILE="$SCRATCH/home-branch" CODEX_HOME="$SCRATCH/empty-codex" SIPCODE_PROJECTS_DIR="$SNAP/claude" node dist/cli.js today > "$SCRATCH/today-branch.txt"
cmp "$SCRATCH/today-main.txt" "$SCRATCH/today-branch.txt" && echo "today: byte-identical"
HOME="$SCRATCH/home-main" USERPROFILE="$SCRATCH/home-main" CODEX_HOME="$SNAP/codex" SIPCODE_PROJECTS_DIR="$SNAP/claude" node "$SCRATCH/main-wt/dist/cli.js" today --json --agent codex > "$SCRATCH/today-json-main.txt"
HOME="$SCRATCH/home-branch" USERPROFILE="$SCRATCH/home-branch" CODEX_HOME="$SNAP/codex" SIPCODE_PROJECTS_DIR="$SNAP/claude" node dist/cli.js today --json --agent codex > "$SCRATCH/today-json-branch.txt"
cmp "$SCRATCH/today-json-main.txt" "$SCRATCH/today-json-branch.txt" && echo "today --json: byte-identical"
HOME="$SCRATCH/home-main" USERPROFILE="$SCRATCH/home-main" CODEX_HOME="$SNAP/codex" SIPCODE_PROJECTS_DIR="$SNAP/claude" node "$SCRATCH/main-wt/dist/cli.js" today --agent codex > "$SCRATCH/today-codex-main.txt"
HOME="$SCRATCH/home-branch" USERPROFILE="$SCRATCH/home-branch" CODEX_HOME="$SNAP/codex" SIPCODE_PROJECTS_DIR="$SNAP/claude" node dist/cli.js today --agent codex > "$SCRATCH/today-codex-branch.txt"
diff "$SCRATCH/today-codex-main.txt" "$SCRATCH/today-codex-branch.txt"
```

Expected: `today: byte-identical`, `today --json: byte-identical`, and the last `diff` shows exactly one added line, the Codex limit line (on the maintainer's logs: `> Codex 30-day limit: 50% used, resets Sat 7 Nov. At this pace you run out <day> ~<hour>.`; the pace counts time up to now, so the run-out time depends on when it runs).

- [ ] **Step 6: Clean up** (remove the junction first: deleting the worktree through it would delete the repo's real `node_modules`)

```bash
cmd //c rmdir "$(cygpath -w "$SCRATCH/main-wt/node_modules")"
git worktree remove --force "$SCRATCH/main-wt"
rm -rf "$SNAP" "$SCRATCH/empty-codex" "$SCRATCH/empty-claude" "$SCRATCH/home-limits" "$SCRATCH/home-main" "$SCRATCH/home-branch"
git worktree list
ls node_modules | head -3
```

Expected: only the main working tree is listed; `node_modules` is intact.

---

### Task 15: Version 1.7.1 and release counts

**Files:**
- Modify: `package.json`, `package-lock.json`, `server.json`, `docs/site/src/components/Hero.astro`, `docs/site/src/components/Footer.astro`, `docs/site/public/llms.txt`, `docs/site/public/llms-full.txt`, `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Bump the version**

Run: `npm version 1.7.1 --no-git-tag-version`
Expected: `v1.7.1`; `package.json` and `package-lock.json` changed.

- [ ] **Step 2: Count the tests** (background; the build must exist so the e2e and MCP integration tests run)

```bash
npm run build
NO_COLOR=1 npx vitest run > "$SCRATCH/vitest-release.txt" 2>&1; echo "exit $?"
COUNT=$(sed -n 's/^ *Tests  *\([0-9][0-9]*\) passed.*/\1/p' "$SCRATCH/vitest-release.txt")
echo "$COUNT"; grep -E "Tests " "$SCRATCH/vitest-release.txt"
```

Expected: exit 0, one number (2,084 when this plan was written, with 87 new tests), the `Tests` line shows no failed or skipped tests. If only the hookScript load flake (Task 14 Step 1) failed, rerun the full command; the count must come from a run with no failures.

- [ ] **Step 3: Write the version and the count everywhere they are stated**

```bash
COUNT="$COUNT" node - <<'EOF'
const fs = require("node:fs");
const n = Number(process.env.COUNT);
if (!Number.isInteger(n) || n < 2000) throw new Error("COUNT must be the passed-test count from vitest");
const pretty = n.toLocaleString("en-US");
const d = new Date();
const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function edit(file, pairs) {
  const raw = fs.readFileSync(file, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  let s = raw.split("\r\n").join("\n");
  for (const [from, to] of pairs) {
    if (!s.includes(from)) throw new Error(`${file}: not found: ${from}`);
    s = s.split(from).join(to);
  }
  fs.writeFileSync(file, s.split("\n").join(eol));
}
edit("server.json", [['"version": "1.7.0"', '"version": "1.7.1"']]);
edit("docs/site/src/components/Hero.astro", [
  ["// Last bumped: 2026-10-09 (v1.7.0: Codex analytics; `npx vitest run` count, e2e included).", `// Last bumped: ${day} (v1.7.1: Codex limits; \`npx vitest run\` count, e2e included).`],
  ["const TEST_COUNT = 1996;", `const TEST_COUNT = ${n};`],
  ["v1.7.0 · MIT licensed", "v1.7.1 · MIT licensed"],
]);
edit("docs/site/src/components/Footer.astro", [["v1.7.0", "v1.7.1"], ["1,996 tests passing", `${pretty} tests passing`]]);
edit("docs/site/public/llms.txt", [
  ["has 1,996 passing tests", `has ${pretty} passing tests`],
  ["MIT licensed source, 1,996 tests", `MIT licensed source, ${pretty} tests`],
  ["current version 1.7.0", "current version 1.7.1"],
]);
edit("docs/site/public/llms-full.txt", [
  ["has 1,996 passing tests", `has ${pretty} passing tests`],
  ["should show 1.7.0 or higher", "should show 1.7.1 or higher"],
]);
edit("README.md", [
  ["tests-1%2C996%20passing", `tests-${pretty.split(",").join("%2C")}%20passing`],
  ['alt="1996 tests passing"', `alt="${n} tests passing"`],
  ["You should see `1.7.0` or higher.", "You should see `1.7.1` or higher."],
]);
edit("CHANGELOG.md", [
  ["## [1.7.1] - 2026-10-11", `## [1.7.1] - ${day}`],
  [
    "not only those since the previous reading.\n",
    `not only those since the previous reading.\n- Test count: 1,996 to ${pretty} (\`npx vitest run\`, which includes the 19 e2e tests).\n`,
  ],
]);
console.log(`v1.7.1, ${pretty} tests, ${day}`);
EOF
```

Expected: `v1.7.1, <count> tests, <today>`; any missing text stops the script with `not found`.

- [ ] **Step 4: Re-run the version-sensitive checks**

Run: `npm run build && npm run test:e2e` (background)
Expected: PASS (`--version` prints `1.7.1`, MCP startup log `connected (sipcode v1.7.1, 16 tools)`).
Run: `grep -rn "1\.7\.0" server.json package.json docs/site/src/components/Hero.astro docs/site/src/components/Footer.astro docs/site/public/llms.txt docs/site/public/llms-full.txt README.md`
Expected: no output.

- [ ] **Step 5: Commit** (patch bump: no `[minor-ok]` marker needed; do not push or tag, tagging `v*` publishes to npm)

```bash
git add package.json package-lock.json server.json docs/site/src/components/Hero.astro docs/site/src/components/Footer.astro docs/site/public/llms.txt docs/site/public/llms-full.txt README.md CHANGELOG.md
git commit -m "release: v1.7.1 (Codex limits)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -16
```

Expected: the release commit on top of the task commits on `codex-limits`.
