import { describe, it, expect } from "vitest";
import type {
  SessionMetrics,
  Baseline,
  DriftReport,
} from "../../../src/modules/drift/types.js";

describe("drift types", () => {
  it("SessionMetrics carries the v1 transcript-derived metrics", () => {
    const m: SessionMetrics = {
      sessionId: "s1",
      endedAtMs: 1,
      totalTokens: 1000,
      assistantTurns: 5,
      tokensPerTurn: 200,
      cacheHitRate: 0.5,
      duplicateReadTokens: 0,
      outputRatio: 0.1,
    };
    expect(m.tokensPerTurn).toBe(200);
  });

  it("DriftReport has a schemaVersion and hasRegression flag", () => {
    const r: DriftReport = {
      schemaVersion: "sipcode-drift/1",
      hasRegression: false,
      summary: "stable",
      causes: [],
      note: "n",
    };
    const b: Baseline = {
      count: 0,
      medianTokensPerTurn: 0,
      medianCacheHitRate: 0,
      medianDuplicateReadTokens: 0,
    };
    expect(r.schemaVersion).toBe("sipcode-drift/1");
    expect(b.count).toBe(0);
  });
});
