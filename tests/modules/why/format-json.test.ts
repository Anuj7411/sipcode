import { describe, expect, it } from "vitest";
import { formatJson } from "../../../src/modules/why/format-json.js";
import type { RenderedReport } from "../../../src/modules/why/render.js";

const sample: RenderedReport = {
  schemaVersion: "sipcode-why/1",
  header: {
    sessionIdShort: "abcd1234",
    model: "claude-sonnet-4",
    durationHuman: "0s",
    projectHash: "p",
  },
  punchline: {
    totalTokens: 0,
    outputTokens: 0,
    nonOutputTokens: 0,
    outputRatioPct: 0,
    oneLiner: "no spend",
  },
  estimatedSavings: {
    totalTokens: 0,
    totalUSD: 0,
    breakdown: { s001_manifest: 0, s030_readOnce: 0, s021_diffOutput: 0 },
  },
  topLeaks: [],
  totals: {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    estCostUSD: 0,
    toolCallCount: 0,
    distinctFilesRead: 0,
  },
  topExpensive: [],
  duplicates: [],
  idle: [],
  warnings: [],
  metaPricing: { asOf: "2026-05-01", ageDays: 0 },
  nextStep: "go",
};

describe("formatJson", () => {
  it("emits valid JSON for empty report", () => {
    const s = formatJson(sample);
    expect(() => JSON.parse(s)).not.toThrow();
  });
  it("preserves schemaVersion", () => {
    expect(JSON.parse(formatJson(sample)).schemaVersion).toBe("sipcode-why/1");
  });
});
