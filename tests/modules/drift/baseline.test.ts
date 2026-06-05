import { describe, it, expect } from "vitest";
import { median, computeBaseline, detectRegression } from "../../../src/modules/drift/baseline.js";
import type { SessionMetrics } from "../../../src/modules/drift/types.js";

function m(part: Partial<SessionMetrics>): SessionMetrics {
  return {
    sessionId: "x",
    endedAtMs: 0,
    totalTokens: 0,
    assistantTurns: 1,
    tokensPerTurn: 100,
    cacheHitRate: 0.7,
    duplicateReadTokens: 0,
    outputRatio: 0.1,
    ...part,
  };
}

describe("median", () => {
  it("odd + even length", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe("computeBaseline", () => {
  it("medians each metric over history", () => {
    const b = computeBaseline([
      m({ tokensPerTurn: 100, cacheHitRate: 0.7, duplicateReadTokens: 0 }),
      m({ tokensPerTurn: 200, cacheHitRate: 0.6, duplicateReadTokens: 0 }),
      m({ tokensPerTurn: 300, cacheHitRate: 0.8, duplicateReadTokens: 0 }),
    ]);
    expect(b.count).toBe(3);
    expect(b.medianTokensPerTurn).toBe(200);
    expect(b.medianCacheHitRate).toBe(0.7);
  });
});

describe("detectRegression", () => {
  const baseline = computeBaseline([
    m({ tokensPerTurn: 100, cacheHitRate: 0.7, duplicateReadTokens: 1000 }),
    m({ tokensPerTurn: 100, cacheHitRate: 0.7, duplicateReadTokens: 1000 }),
    m({ tokensPerTurn: 100, cacheHitRate: 0.7, duplicateReadTokens: 1000 }),
  ]);

  it("flags a >30% cost/turn jump", () => {
    const r = detectRegression(m({ tokensPerTurn: 140 }), baseline);
    expect(r.hasRegression).toBe(true);
    expect(r.causes.some((c) => c.label.includes("cost/turn"))).toBe(true);
  });

  it("does NOT flag a small (<30%) cost/turn change", () => {
    const r = detectRegression(m({ tokensPerTurn: 120 }), baseline);
    expect(r.hasRegression).toBe(false);
  });

  it("flags a cache-hit-rate drop > 15 points", () => {
    const r = detectRegression(m({ cacheHitRate: 0.5 }), baseline);
    expect(r.hasRegression).toBe(true);
    expect(r.causes.some((c) => c.label.includes("cache"))).toBe(true);
  });

  it("does NOT flag when baseline has < 3 sessions", () => {
    const thin = computeBaseline([m({}), m({})]);
    const r = detectRegression(m({ tokensPerTurn: 999 }), thin);
    expect(r.hasRegression).toBe(false);
  });
});
