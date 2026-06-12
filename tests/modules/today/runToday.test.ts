import { describe, it, expect } from "vitest";
import { runToday, type TodaySession } from "../../../src/modules/today/runToday.js";

const now = new Date("2026-06-15T12:00:00.000Z");

function session(over: Partial<TodaySession> = {}): TodaySession {
  return {
    sessionId: "s",
    startedAt: now.toISOString(),
    totalTokens: 10_000,
    outputTokens: 100,
    estCostUSD: 0.1,
    duplicateReadTokenCost: 0,
    ...over,
  };
}

function daysAgoIso(n: number): string {
  return new Date(now.getTime() - n * 86_400_000).toISOString();
}

describe("runToday — status branches", () => {
  it("status 'no-data' when sessions list is empty", () => {
    const r = runToday({ sessions: [], now });
    expect(r.status).toBe("no-data");
    expect(r.today).toBeNull();
    expect(r.baseline).toBeNull();
    expect(r.headline).toContain("No Claude Code sessions");
  });

  it("status 'no-baseline' when <3 days of history but has today's sessions", () => {
    const r = runToday({
      sessions: [session({ startedAt: now.toISOString(), estCostUSD: 0.5 })],
      now,
    });
    expect(r.status).toBe("no-baseline");
    expect(r.today).not.toBeNull();
    expect(r.baseline).toBeNull();
    expect(r.headline).toContain("Need 3+ days");
  });

  it("status 'no-sessions-today' when baseline exists but no sessions today", () => {
    const r = runToday({
      sessions: [
        session({ startedAt: daysAgoIso(31), estCostUSD: 0.5 }),
        session({ startedAt: daysAgoIso(20), estCostUSD: 0.3 }),
        session({ startedAt: daysAgoIso(2), estCostUSD: 0.4 }),
      ],
      now,
    });
    expect(r.status).toBe("no-sessions-today");
    expect(r.today).toBeNull();
    expect(r.baseline).not.toBeNull();
    expect(r.headline).toContain("No sessions today");
    expect(r.headline).toContain("median");
  });

  it("status 'ok' with full comparison when baseline + today both present", () => {
    const sessions: TodaySession[] = [];
    for (let i = 30; i >= 1; i--) {
      sessions.push(session({ startedAt: daysAgoIso(i), estCostUSD: 0.5, totalTokens: 100_000, outputTokens: 500 }));
    }
    sessions.push(session({ startedAt: now.toISOString(), estCostUSD: 0.41, totalTokens: 50_000, outputTokens: 400 }));
    const r = runToday({ sessions, now });
    expect(r.status).toBe("ok");
    expect(r.today).not.toBeNull();
    expect(r.baseline).not.toBeNull();
    expect(r.comparison).not.toBeNull();
    expect(r.headline).toContain("$0.41");
  });
});

describe("runToday — math", () => {
  it("computes outputRatioPct as output / total * 100", () => {
    const r = runToday({
      sessions: [
        session({ startedAt: now.toISOString(), totalTokens: 10_000, outputTokens: 200 }),
      ],
      now,
    });
    expect(r.today?.outputRatioPct).toBeCloseTo(2.0, 5);
  });

  it("sums sessionCount, totalSpend, totalTokens across today's sessions", () => {
    const r = runToday({
      sessions: [
        session({ startedAt: now.toISOString(), estCostUSD: 0.1, totalTokens: 1000 }),
        session({ startedAt: now.toISOString(), estCostUSD: 0.2, totalTokens: 2000 }),
        session({ startedAt: now.toISOString(), estCostUSD: 0.3, totalTokens: 3000 }),
      ],
      now,
    });
    expect(r.today?.sessionCount).toBe(3);
    expect(r.today?.totalSpendUSD).toBeCloseTo(0.6, 5);
    expect(r.today?.totalTokens).toBe(6000);
  });

  it("picks the top duplicate-read file across sessions as topLeak", () => {
    const r = runToday({
      sessions: [
        session({
          startedAt: now.toISOString(),
          topDuplicateReadFile: { path: "src/a.ts", count: 2, costUSD: 0.05 },
        }),
        session({
          startedAt: now.toISOString(),
          topDuplicateReadFile: { path: "src/b.ts", count: 4, costUSD: 0.11 },
        }),
      ],
      now,
    });
    expect(r.today?.topLeak).not.toBeNull();
    expect(r.today?.topLeak?.description).toContain("src/b.ts");
    expect(r.today?.topLeak?.costUSD).toBeCloseTo(0.11, 5);
  });

  it("topLeak is null when no session has a topDuplicateReadFile", () => {
    const r = runToday({
      sessions: [session({ startedAt: now.toISOString() })],
      now,
    });
    expect(r.today?.topLeak).toBeNull();
  });
});
