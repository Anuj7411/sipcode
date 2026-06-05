import { describe, it, expect } from "vitest";
import { buildDriftReport } from "../../../src/modules/drift/runDrift.js";
import type { SessionMetrics } from "../../../src/modules/drift/types.js";

function m(part: Partial<SessionMetrics>): SessionMetrics {
  return {
    sessionId: "x", endedAtMs: 0, totalTokens: 0, assistantTurns: 1,
    tokensPerTurn: 100, cacheHitRate: 0.7, duplicateReadTokens: 0, outputRatio: 0.1,
    ...part,
  };
}

describe("buildDriftReport", () => {
  const history = [
    m({ tokensPerTurn: 100 }), m({ tokensPerTurn: 100 }), m({ tokensPerTurn: 100 }),
  ];

  it("reports a regression with causes when latest spikes", () => {
    const r = buildDriftReport(m({ tokensPerTurn: 200 }), history);
    expect(r.hasRegression).toBe(true);
    expect(r.causes.length).toBeGreaterThan(0);
    expect(r.summary).toContain("drift");
    expect(r.schemaVersion).toBe("sipcode-drift/1");
  });

  it("reports stable when latest is in range", () => {
    const r = buildDriftReport(m({ tokensPerTurn: 105 }), history);
    expect(r.hasRegression).toBe(false);
    expect(r.summary).toContain("stable");
  });

  it("says not-enough-data with a thin history", () => {
    const r = buildDriftReport(m({ tokensPerTurn: 999 }), [m({})]);
    expect(r.hasRegression).toBe(false);
    expect(r.summary).toContain("not enough");
  });
});
