import { describe, it, expect } from "vitest";
import { runForecast, type ForecastSession } from "../../../src/modules/forecast/runForecast.js";

// mid-month so daysRemaining is non-trivial
const now = new Date("2026-06-15T12:00:00.000Z");

function daysAgoIso(n: number): string {
  return new Date(now.getTime() - n * 86_400_000).toISOString();
}

function session(over: Partial<ForecastSession> = {}): ForecastSession {
  return {
    startedAt: now.toISOString(),
    estCostUSD: 1.0,
    ...over,
  };
}

describe("runForecast — status branches", () => {
  it("'no-data' for empty input", () => {
    const r = runForecast({ sessions: [], now });
    expect(r.status).toBe("no-data");
  });

  it("'insufficient-data' when <7 days of history", () => {
    const r = runForecast({
      sessions: [session({ startedAt: daysAgoIso(2) })],
      now,
    });
    expect(r.status).toBe("insufficient-data");
    expect(r.headline).toContain("at least 7 days");
  });

  it("'near-month-end' when ≤1 day remaining", () => {
    const lateInMonth = new Date("2026-06-30T12:00:00.000Z");
    const r = runForecast({
      sessions: [session({ startedAt: daysAgoIso(20) })],
      now: lateInMonth,
    });
    expect(r.status).toBe("near-month-end");
  });

  it("'no-recent-activity' when no sessions in last 14 days", () => {
    const sessions = [
      session({ startedAt: daysAgoIso(30) }),
      session({ startedAt: daysAgoIso(20) }), // still > 14d ago
    ];
    const r = runForecast({ sessions, now });
    expect(r.status).toBe("no-recent-activity");
  });

  it("'ok' with full projection when ≥7 days history + recent activity + >1 day remaining", () => {
    const sessions: ForecastSession[] = [];
    for (let i = 14; i >= 1; i--) {
      sessions.push(session({ startedAt: daysAgoIso(i), estCostUSD: 4.20 }));
    }
    const r = runForecast({ sessions, now });
    expect(r.status).toBe("ok");
    expect(r.trajectoryInput?.windowDays).toBe(14);
    expect(r.monthEnd).not.toBeNull();
    expect(r.monthEnd?.daysRemaining).toBe(15); // June has 30 days
  });
});

describe("runForecast — math", () => {
  it("avgDailySpendUSD averages the trajectory window", () => {
    const sessions: ForecastSession[] = [];
    for (let i = 7; i >= 1; i--) {
      sessions.push(session({ startedAt: daysAgoIso(i), estCostUSD: 5.0 }));
    }
    const r = runForecast({ sessions, now });
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.trajectoryInput!.avgDailySpendUSD).toBeCloseTo(5.0, 5);
  });

  it("projects (avgDaily * daysRemaining) + spendSoFarThisMonth", () => {
    const sessions: ForecastSession[] = [];
    // 7 days of $1/day, all in this month.
    for (let i = 7; i >= 1; i--) {
      sessions.push(session({ startedAt: daysAgoIso(i), estCostUSD: 1.0 }));
    }
    const r = runForecast({ sessions, now });
    if (r.status !== "ok") throw new Error("expected ok");
    // June: now=15th → 15 days remaining. spendSoFar = 7 (days 8-14 of June).
    // avg = 7 / 7 = 1.0. projected = 7 + 1*15 = 22.
    expect(r.monthEnd!.projectedSpendUSD).toBeCloseTo(22.0, 1);
  });

  it("confidence band shrinks to 0 when stdev is 0 (constant spend)", () => {
    const sessions: ForecastSession[] = [];
    for (let i = 7; i >= 1; i--) {
      sessions.push(session({ startedAt: daysAgoIso(i), estCostUSD: 3.0 }));
    }
    const r = runForecast({ sessions, now });
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.monthEnd!.confidenceHighUSD - r.monthEnd!.confidenceLowUSD).toBeCloseTo(0, 1);
  });

  it("confidence band caps at ±20% of projected on spiky users", () => {
    const sessions: ForecastSession[] = [];
    // Wildly variable daily spend.
    const spikes = [0.1, 50, 0.1, 80, 0.1, 90, 0.1];
    for (let i = 0; i < 7; i++) {
      sessions.push(session({ startedAt: daysAgoIso(7 - i), estCostUSD: spikes[i]! }));
    }
    const r = runForecast({ sessions, now });
    if (r.status !== "ok") throw new Error("expected ok");
    const band = r.monthEnd!.confidenceHighUSD - r.monthEnd!.projectedSpendUSD;
    expect(band).toBeLessThanOrEqual(0.2 * r.monthEnd!.projectedSpendUSD + 0.001);
  });

  it("comparison.vsLastMonthPct computed when prior month had sessions", () => {
    const sessions: ForecastSession[] = [];
    for (let i = 14; i >= 1; i--) {
      sessions.push(session({ startedAt: daysAgoIso(i), estCostUSD: 2.0 }));
    }
    // Add sessions in May 2026 (previous month relative to now=2026-06-15)
    sessions.push(session({ startedAt: "2026-05-15T10:00:00Z", estCostUSD: 50.0 }));
    sessions.push(session({ startedAt: "2026-05-20T10:00:00Z", estCostUSD: 50.0 }));
    const r = runForecast({ sessions, now });
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.comparison!.lastMonthSpendUSD).toBeCloseTo(100, 1);
    expect(r.comparison!.vsLastMonthPct).not.toBeNull();
  });

  it("comparison set to null when no last-month sessions", () => {
    const sessions: ForecastSession[] = [];
    for (let i = 14; i >= 1; i--) {
      sessions.push(session({ startedAt: daysAgoIso(i), estCostUSD: 2.0 }));
    }
    const r = runForecast({ sessions, now });
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.comparison!.lastMonthSpendUSD).toBeNull();
    expect(r.comparison!.vsLastMonthPct).toBeNull();
  });
});
