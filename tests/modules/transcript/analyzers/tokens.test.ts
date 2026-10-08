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

// v1.6.21: cost must match Anthropic's bill for a real-shaped request.
describe("analyzeTokens cost: 1-hour cache writes and current models", () => {
  const pricing = loadPricingForDate(new Date("2026-10-08"));
  const req = (model: string, usage: Record<string, unknown>) =>
    JSON.stringify({
      type: "assistant",
      requestId: "r1",
      timestamp: "2026-10-01T10:00:00.000Z",
      message: { id: "m1", model, role: "assistant", content: [{ type: "text", text: "." }], usage },
    });

  it("prices 1h writes at 2x input and 5m writes at 1.25x (Opus 5)", () => {
    const r = parseTranscript(
      req("claude-opus-5", {
        input_tokens: 1_000,
        output_tokens: 2_000,
        cache_read_input_tokens: 100_000,
        cache_creation_input_tokens: 10_000,
        cache_creation: { ephemeral_5m_input_tokens: 2_000, ephemeral_1h_input_tokens: 8_000 },
      }),
    );
    if (!r.ok) throw new Error("parse failed");
    // 1,000*$5 + 2,000*$25 + 100,000*$0.50 + 2,000*$6.25 + 8,000*$10, per million
    const expected = (5_000 + 50_000 + 50_000 + 12_500 + 80_000) / 1e6;
    expect(analyzeTokens(r.value, pricing).estCostUSD).toBeCloseTo(expected, 10);
  });

  it("applies Haiku 5.5's higher rates above a 100K-token prompt", () => {
    const r = parseTranscript(
      req("claude-haiku-5-5", { input_tokens: 10, output_tokens: 1_000, cache_read_input_tokens: 150_000 }),
    );
    if (!r.ok) throw new Error("parse failed");
    // over 100K: input $0.50, output $2.50, cache read $0.05
    const expected = (10 * 0.5 + 1_000 * 2.5 + 150_000 * 0.05) / 1e6;
    expect(analyzeTokens(r.value, pricing).estCostUSD).toBeCloseTo(expected, 10);
  });
});
