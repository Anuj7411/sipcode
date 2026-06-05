import { describe, it, expect } from "vitest";
import { computeSessionMetrics } from "../../../src/modules/drift/metrics.js";
import { parseTranscript } from "../../../src/modules/transcript/parse.js";
import { loadPricingForDate } from "../../../src/lib/pricing/load.js";

const pricing = loadPricingForDate(new Date("2026-06-01"));

const line = JSON.stringify({
  type: "assistant",
  timestamp: "2026-06-01T00:00:00.000Z",
  sessionId: "sess-A",
  message: {
    model: "claude-sonnet-4-5",
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 0,
    },
    content: [],
  },
});

describe("computeSessionMetrics", () => {
  it("derives tokensPerTurn, cacheHitRate, totals from a parsed session", () => {
    const parsed = parseTranscript(line);
    expect(parsed.ok).toBe(true);
    const session = parsed.ok ? parsed.value : null;
    const m = computeSessionMetrics(
      { sessionId: "sess-A", endedAtMs: 1000 },
      session!,
      pricing,
    );
    expect(m.assistantTurns).toBe(1);
    expect(m.totalTokens).toBe(1050);
    expect(m.tokensPerTurn).toBe(1050);
    expect(m.cacheHitRate).toBeCloseTo(0.9, 5);
    expect(m.duplicateReadTokens).toBe(0);
    expect(m.sessionId).toBe("sess-A");
  });

  it("returns zeros (never NaN) for an empty session", () => {
    const parsed = parseTranscript("");
    const session = parsed.ok ? parsed.value : null;
    const m = computeSessionMetrics(
      { sessionId: "empty", endedAtMs: 0 },
      session!,
      pricing,
    );
    expect(m.tokensPerTurn).toBe(0);
    expect(m.cacheHitRate).toBe(0);
  });
});
