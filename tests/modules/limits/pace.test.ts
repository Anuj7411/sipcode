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
