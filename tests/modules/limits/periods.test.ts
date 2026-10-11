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

  it("never starts a period after its first reading, even when the reset time drifted later", () => {
    // Real weekly data: the reset time drifted 11 s later over the period, which put
    // the start after the first reading and left a request made 9 s after it in no period.
    const first = T0 + H;
    const [w] = buildPeriods([reading(first, 1, first + 7 * DAY), reading(T0 + 3 * H, 3, first + 7 * DAY + 60_000)]);
    expect(w?.periods[0]?.startedAt).toBe(first);
    expect(w?.periods[0]?.resetsAt).toBe(first + 7 * DAY + 60_000);
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

  it("ignores a stale reading logged after its own reset time (a turn that ran across the reset)", () => {
    // Older Codex repeats the turn-start reading on every line of a turn, so a turn
    // running past the reset logs the old reset time after it passed, from any session.
    const r1 = T0 + DAY;
    const r2 = r1 + 7 * DAY + 30 * MIN;
    const [w] = buildPeriods([
      reading(T0 + H, 40, r1),
      reading(r1 + 5 * MIN, 40, r1),
      reading(r1 + 30 * MIN, 2, r2),
      reading(r1 + H, 40, r1, { sessionId: "s2" }),
      reading(r1 + 2 * H, 3, r2),
    ]);
    expect(w?.periods.map((p) => [p.usedPercent, p.resetsAt, p.points.length])).toEqual([
      [40, r1, 1],
      [3, r2, 2],
    ]);
  });

  it("returns no windows for no readings", () => {
    expect(buildPeriods([])).toEqual([]);
  });
});
