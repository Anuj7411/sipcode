import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTranscript } from "../../../../src/modules/transcript/parse.js";
import { analyzeTokens } from "../../../../src/modules/transcript/analyzers/tokens.js";
import { loadPricingForDate } from "../../../../src/lib/pricing/load.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, "../../../fixtures/transcripts");
const load = (n: string) => readFileSync(path.join(fixtures, n), "utf-8");
const pricing = loadPricingForDate(new Date("2026-05-01"));

describe("analyzeTokens", () => {
  it("M001-M004 sum to expected for minimal-2turn", () => {
    const r = parseTranscript(load("minimal-2turn.jsonl"));
    if (!r.ok) throw new Error("parse failed");
    const t = analyzeTokens(r.value, pricing);
    expect(t.inputTokens).toBe(12 + 50);
    expect(t.outputTokens).toBe(40 + 80);
    expect(t.cacheReadTokens).toBe(0 + 1200);
    expect(t.cacheCreationTokens).toBe(1200 + 40);
  });

  it("M010 output ratio = output / (input + output + cacheCreation) — cacheRead EXCLUDED [v1.4.0 correctness fix regression guard]", () => {
    // Why this changed: the previous formula put cacheRead in the
    // denominator. Sessions with heavy prompt caching showed output
    // ratio near 0% because cache reads are typically 90%+ of "total"
    // tokens. Including them conflated efficient caching with waste.
    // The honest ratio asks: of the new-token work this session, what
    // fraction became code output? Cache reads are the cheap efficient
    // path, not waste.
    const r = parseTranscript(load("minimal-2turn.jsonl"));
    if (!r.ok) throw new Error("parse failed");
    const t = analyzeTokens(r.value, pricing);
    const effectiveDenom = t.inputTokens + t.outputTokens + t.cacheCreationTokens;
    expect(t.outputRatio).toBeCloseTo(t.outputTokens / effectiveDenom, 6);
  });

  it("M011 USD cost is computed and non-negative", () => {
    const r = parseTranscript(load("read-heavy.jsonl"));
    if (!r.ok) throw new Error("parse failed");
    const t = analyzeTokens(r.value, pricing);
    expect(t.estCostUSD).toBeGreaterThan(0);
  });

  it("multi-model session reports per-model breakdown", () => {
    const r = parseTranscript(load("multi-model.jsonl"));
    if (!r.ok) throw new Error("parse failed");
    const t = analyzeTokens(r.value, pricing);
    expect(t.costByModel.length).toBe(2);
    // Opus is more expensive than Haiku per token, so it should rank first.
    expect(t.costByModel[0]?.model.startsWith("claude-opus")).toBe(true);
  });

  it("missingAllUsage true when no usage blocks", () => {
    const r = parseTranscript(load("older-schema-no-usage.jsonl"));
    if (!r.ok) throw new Error("parse failed");
    const t = analyzeTokens(r.value, pricing);
    expect(t.missingAllUsage).toBe(true);
    expect(t.inputTokens).toBe(0);
  });
});
