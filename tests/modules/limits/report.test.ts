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

  it("returns null when every reading is stale (logged after its own reset time)", () => {
    const stale = [reading(T0 + 2 * H, 40, T0 + H), reading(T0 + 3 * H, 41, T0 + H, { sessionId: "b" })];
    expect(buildLimitsReport({ readings: stale, requests, now: new Date(T0 + 3 * H), sinceMs: 0 })).toBeNull();
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
