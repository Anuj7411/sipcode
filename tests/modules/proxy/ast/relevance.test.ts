import { describe, it, expect } from "vitest";
import {
  scoreSymbols,
  pickRelevantSymbols,
  matchScore,
  DEFAULT_CONFIDENCE_THRESHOLD,
} from "../../../../src/modules/proxy/ast/relevance.js";
import type { ExtractedSymbol } from "../../../../src/modules/proxy/ast/ts-symbols.js";
import type { Signal } from "../../../../src/modules/proxy/signal-cache.js";

const sym = (name: string, over: Partial<ExtractedSymbol> = {}): ExtractedSymbol => ({
  name,
  kind: "function",
  startLine: 1,
  endLine: 5,
  isTopLevel: true,
  isExported: true,
  ...over,
});

const grep = (pattern: string): Signal => ({
  tool: "Grep",
  kind: "grep-pattern",
  pattern,
  capturedAtMs: 1000,
});

const glob = (pattern: string): Signal => ({
  tool: "Glob",
  kind: "glob-pattern",
  pattern,
  capturedAtMs: 1000,
});

describe("matchScore", () => {
  it("exact match = 1.0", () => {
    expect(matchScore("authCheck", "authCheck")).toBe(1.0);
  });

  it("case-insensitive exact = 0.95", () => {
    expect(matchScore("AuthCheck", "authcheck")).toBe(0.95);
  });

  it("substring (pattern shorter than symbol) scores 0.7-0.8", () => {
    const s = matchScore("validateUserId", "user");
    expect(s).toBeGreaterThan(0.7);
    expect(s).toBeLessThanOrEqual(0.8);
  });

  it("CamelCase word boundary = 0.7", () => {
    expect(matchScore("authCheckPipeline", "Pipeline")).toBeGreaterThanOrEqual(0.7);
  });

  it("snake_case word boundary = 0.7", () => {
    expect(matchScore("auth_check_pipeline", "check")).toBeGreaterThanOrEqual(0.7);
  });

  it("regex match = 0.7 (e.g. anchored pattern from Grep)", () => {
    expect(matchScore("getUserData", "^get.*Data$")).toBeGreaterThanOrEqual(0.7);
  });

  it("no match = 0", () => {
    expect(matchScore("zzz", "qqq")).toBe(0);
  });

  it("empty inputs = 0", () => {
    expect(matchScore("", "x")).toBe(0);
    expect(matchScore("x", "")).toBe(0);
  });

  it("invalid regex doesn't throw — returns 0 when no other match", () => {
    expect(matchScore("foo", "[bad(")).toBe(0);
  });

  it("DEFENSE: long patterns skip the regex tier (H2 ReDoS guard)", () => {
    // Catastrophic backtracking pattern that would normally run forever.
    const evil = "^(a+)+b";
    // Symbol that doesn't match earlier tiers and would trigger backtrack.
    const symbol = "a".repeat(50);
    // Force the pattern length over the regex-tier cap by padding.
    const longPattern = evil + "x".repeat(250);
    const t0 = Date.now();
    const score = matchScore(symbol, longPattern);
    const elapsed = Date.now() - t0;
    expect(score).toBe(0);
    expect(elapsed).toBeLessThan(50); // bounded, not exponential
  });

  it("DEFENSE: long symbols skip the regex tier (H2 ReDoS guard)", () => {
    const symbol = "a".repeat(250);
    const t0 = Date.now();
    const score = matchScore(symbol, "^(a+)+b");
    const elapsed = Date.now() - t0;
    expect(score).toBe(0);
    expect(elapsed).toBeLessThan(50);
  });
});

describe("scoreSymbols", () => {
  it("scores symbols by their best matching signal", () => {
    const symbols = [sym("authCheck"), sym("authError"), sym("unrelated")];
    const signals = [grep("authCheck"), grep("error")];
    const scored = scoreSymbols(symbols, signals);
    expect(scored[0]!.confidence).toBe(1.0);
    expect(scored[0]!.matchedPattern).toBe("authCheck");
    expect(scored[1]!.confidence).toBeGreaterThan(0.7); // substring/word match for "error"
    expect(scored[2]!.confidence).toBe(0);
  });

  it("ignores glob signals (they're not symbol-name hints)", () => {
    const symbols = [sym("doSomething")];
    const signals = [glob("**/*.ts"), glob("src/**")];
    const scored = scoreSymbols(symbols, signals);
    expect(scored[0]!.confidence).toBe(0);
  });

  it("returns empty when symbols list is empty", () => {
    expect(scoreSymbols([], [grep("x")])).toEqual([]);
  });

  it("returns symbols at 0 when no signals", () => {
    const symbols = [sym("foo")];
    const scored = scoreSymbols(symbols, []);
    expect(scored[0]!.confidence).toBe(0);
  });
});

describe("pickRelevantSymbols", () => {
  it("returns symbols above the threshold, sorted by confidence desc", () => {
    const scored = [
      { symbol: sym("a"), confidence: 0.5 },
      { symbol: sym("b"), confidence: 0.95 },
      { symbol: sym("c"), confidence: 0.71 },
    ];
    const picked = pickRelevantSymbols(scored, DEFAULT_CONFIDENCE_THRESHOLD);
    expect(picked.map((p) => p.symbol.name)).toEqual(["b", "c"]);
  });

  it("respects custom threshold", () => {
    const scored = [
      { symbol: sym("a"), confidence: 0.4 },
      { symbol: sym("b"), confidence: 0.6 },
    ];
    expect(pickRelevantSymbols(scored, 0.5).length).toBe(1);
    expect(pickRelevantSymbols(scored, 0.7).length).toBe(0);
  });

  it("returns [] when no symbols cross the threshold (caller passes through full file)", () => {
    const scored = [{ symbol: sym("a"), confidence: 0.3 }];
    expect(pickRelevantSymbols(scored)).toEqual([]);
  });
});
