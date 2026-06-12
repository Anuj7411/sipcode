import { describe, it, expect } from "vitest";
import {
  computeTrend,
  enumerateDays,
  MIN_DAYS_FOR_SLOPE,
  type TrendSession,
} from "../../../src/modules/trend/compute.js";

const session = (over: Partial<TrendSession> = {}): TrendSession => ({
  startedAt: "2026-06-01T10:00:00.000Z",
  totalTokens: 100_000,
  outputTokens: 20_000,
  estCostUSD: 0.5,
  duplicateReadTokens: 5_000,
  ...over,
});

describe("enumerateDays", () => {
  it("returns inclusive day range", () => {
    expect(enumerateDays("2026-06-10", "2026-06-12")).toEqual([
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
    ]);
  });

  it("returns single day when since == until", () => {
    expect(enumerateDays("2026-06-10", "2026-06-10")).toEqual(["2026-06-10"]);
  });

  it("returns empty when until < since", () => {
    expect(enumerateDays("2026-06-12", "2026-06-10")).toEqual([]);
  });
});

describe("computeTrend — output-ratio metric", () => {
  it("buckets sessions by day and computes ratio per bucket", () => {
    const sessions = [
      session({
        startedAt: "2026-06-01T10:00:00Z",
        totalTokens: 100,
        outputTokens: 20,
      }),
      session({
        startedAt: "2026-06-01T15:00:00Z",
        totalTokens: 100,
        outputTokens: 40,
      }),
      session({
        startedAt: "2026-06-02T10:00:00Z",
        totalTokens: 200,
        outputTokens: 60,
      }),
    ];
    const result = computeTrend(
      sessions,
      "output-ratio",
      "2026-06-01",
      "2026-06-02",
    );
    expect(result.days.length).toBe(2);
    expect(result.days[0]!.value).toBeCloseTo(0.3, 5); // (20+40)/(100+100)
    expect(result.days[1]!.value).toBeCloseTo(0.3, 5); // 60/200
  });

  it("returns verdict 'insufficient-data' when fewer than MIN_DAYS_FOR_SLOPE days with sessions", () => {
    const sessions = [
      session({ startedAt: "2026-06-01T10:00:00Z" }),
    ];
    const result = computeTrend(sessions, "output-ratio", "2026-06-01", "2026-06-30");
    expect(result.verdict).toBe("insufficient-data");
  });

  it("verdict 'improving' for output-ratio with positive slope across >= MIN days", () => {
    const sessions: TrendSession[] = [];
    for (let day = 1; day <= MIN_DAYS_FOR_SLOPE + 2; day++) {
      const ratio = 0.1 + day * 0.05; // climbing
      sessions.push(
        session({
          startedAt: `2026-06-${String(day).padStart(2, "0")}T10:00:00Z`,
          totalTokens: 1000,
          outputTokens: Math.round(ratio * 1000),
        }),
      );
    }
    const result = computeTrend(
      sessions,
      "output-ratio",
      "2026-06-01",
      "2026-06-30",
    );
    expect(result.verdict).toBe("improving");
    expect(result.slopePerDay).toBeGreaterThan(0);
  });

  it("verdict 'regressing' for output-ratio with negative slope", () => {
    const sessions: TrendSession[] = [];
    for (let day = 1; day <= MIN_DAYS_FOR_SLOPE + 2; day++) {
      const ratio = 0.6 - day * 0.05; // declining
      sessions.push(
        session({
          startedAt: `2026-06-${String(day).padStart(2, "0")}T10:00:00Z`,
          totalTokens: 1000,
          outputTokens: Math.round(ratio * 1000),
        }),
      );
    }
    const result = computeTrend(sessions, "output-ratio", "2026-06-01", "2026-06-30");
    expect(result.verdict).toBe("regressing");
  });

  it("verdict 'stable' when slope is very small", () => {
    const sessions: TrendSession[] = [];
    for (let day = 1; day <= MIN_DAYS_FOR_SLOPE + 2; day++) {
      sessions.push(
        session({
          startedAt: `2026-06-${String(day).padStart(2, "0")}T10:00:00Z`,
          totalTokens: 1000,
          outputTokens: 200, // constant ratio = 0.2
        }),
      );
    }
    const result = computeTrend(sessions, "output-ratio", "2026-06-01", "2026-06-30");
    expect(result.verdict).toBe("stable");
  });
});

describe("computeTrend — cost-per-session metric", () => {
  it("computes per-day mean cost", () => {
    const sessions = [
      session({ startedAt: "2026-06-01T10:00:00Z", estCostUSD: 1.0 }),
      session({ startedAt: "2026-06-01T15:00:00Z", estCostUSD: 3.0 }),
    ];
    const result = computeTrend(sessions, "cost-per-session", "2026-06-01", "2026-06-01");
    expect(result.days[0]!.value).toBe(2.0);
  });

  it("verdict 'improving' when cost trends DOWN (lower-is-better metric)", () => {
    const sessions: TrendSession[] = [];
    for (let day = 1; day <= MIN_DAYS_FOR_SLOPE + 2; day++) {
      sessions.push(
        session({
          startedAt: `2026-06-${String(day).padStart(2, "0")}T10:00:00Z`,
          estCostUSD: 1.0 - day * 0.05,
        }),
      );
    }
    const result = computeTrend(sessions, "cost-per-session", "2026-06-01", "2026-06-30");
    expect(result.verdict).toBe("improving");
    expect(result.slopePerDay).toBeLessThan(0);
  });
});

describe("computeTrend — recoverable-tokens-per-session metric", () => {
  it("median of the per-day means", () => {
    const sessions = [
      session({ startedAt: "2026-06-01T10:00:00Z", duplicateReadTokens: 1000 }),
      session({ startedAt: "2026-06-02T10:00:00Z", duplicateReadTokens: 3000 }),
      session({ startedAt: "2026-06-03T10:00:00Z", duplicateReadTokens: 2000 }),
    ];
    const result = computeTrend(
      sessions,
      "recoverable-tokens-per-session",
      "2026-06-01",
      "2026-06-03",
    );
    expect(result.median).toBe(2000);
  });
});

describe("computeTrend — edge cases", () => {
  it("handles empty input — returns insufficient-data and zero median", () => {
    const result = computeTrend([], "output-ratio", "2026-06-01", "2026-06-30");
    expect(result.verdict).toBe("insufficient-data");
    expect(result.median).toBe(0);
    expect(result.slopePerDay).toBe(0);
    expect(result.days.length).toBe(30);
  });

  it("excludes sessions outside the window", () => {
    const sessions = [
      session({ startedAt: "2026-05-31T10:00:00Z" }),
      session({ startedAt: "2026-06-01T10:00:00Z" }),
    ];
    const result = computeTrend(sessions, "output-ratio", "2026-06-01", "2026-06-01");
    expect(result.days.length).toBe(1);
    expect(result.days[0]!.sessions).toBe(1);
  });
});
