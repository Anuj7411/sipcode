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

  it("a period followed by a later one is finished, even when its reset time is still ahead (early reset)", () => {
    // Early resets: each period ended before its reset time, so resetsAt is after every reading.
    const far = W0 + 100 * WEEK;
    const weeks = [0, 1, 2].map((n) => {
      const w = week(n, 50, { "gpt-5.4": 20_000_000 });
      return { ...w, period: { ...w.period, resetsAt: far } };
    });
    const s = series(weeks, { asOf: W0 + 2 * WEEK + 2 * H });
    expect(s.points.map((p) => p.periodStart)).toEqual([W0, W0 + WEEK]);
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
