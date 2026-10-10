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
    expect(r.causes.some((c) => c.metric === "Tokens per turn")).toBe(true);
  });

  it("does NOT flag a small (<30%) cost/turn change", () => {
    const r = detectRegression(m({ tokensPerTurn: 120 }), baseline);
    expect(r.hasRegression).toBe(false);
  });

  it("flags a cache-hit-rate drop > 15 points", () => {
    const r = detectRegression(m({ cacheHitRate: 0.5 }), baseline);
    expect(r.hasRegression).toBe(true);
    expect(r.causes.some((c) => c.metric === "Cache reuse")).toBe(true);
  });

  it("does NOT flag when baseline has < 3 sessions", () => {
    const thin = computeBaseline([m({}), m({})]);
    const r = detectRegression(m({ tokensPerTurn: 999 }), thin);
    expect(r.hasRegression).toBe(false);
  });

  it("flags a re-read waste spike above the absolute floor", () => {
    const r = detectRegression(m({ duplicateReadTokens: 6000 }), baseline);
    expect(r.hasRegression).toBe(true);
    expect(r.causes.some((c) => c.metric === "Repeated file reads")).toBe(true);
  });

  it("does NOT flag re-read tokens below the 5000 absolute floor", () => {
    const r = detectRegression(m({ duplicateReadTokens: 3000 }), baseline);
    expect(r.hasRegression).toBe(false);
  });
});

describe("detectRegression wording per agent", () => {
  const baseline = computeBaseline([
    m({ tokensPerTurn: 100, cacheHitRate: 0.7, duplicateReadTokens: 1000 }),
    m({ tokensPerTurn: 100, cacheHitRate: 0.7, duplicateReadTokens: 1000 }),
    m({ tokensPerTurn: 100, cacheHitRate: 0.7, duplicateReadTokens: 1000 }),
  ]);
  const all = m({ tokensPerTurn: 999, cacheHitRate: 0.1, duplicateReadTokens: 50_000 });

  it("Claude Code wording is unchanged with or without the agent", () => {
    const plain = detectRegression(all, baseline);
    expect(detectRegression(all, baseline, { id: "claude-code", displayName: "Claude Code" })).toEqual(plain);
    expect(plain.causes.map((c) => c.meaning).join(" ")).toContain("~5-minute cache window");
    expect(plain.causes.map((c) => c.fix).join(" ")).toContain("sipcode proxy --install");
  });

  it("Codex gets no Claude-only advice", () => {
    const r = detectRegression(all, baseline, { id: "codex", displayName: "Codex" });
    expect(r.causes).toHaveLength(3);
    const text = r.causes.map((c) => `${c.meaning} ${c.fix}`).join(" ");
    expect(text).not.toContain("Claude");
    expect(text).not.toContain("5-minute");
    expect(text).not.toContain("proxy --install");
    expect(text).toContain("detail Codex needs");
    expect(text).toContain("Codex re-read files");
  });
});
