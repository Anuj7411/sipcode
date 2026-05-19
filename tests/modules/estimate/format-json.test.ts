import { describe, expect, it } from "vitest";
import { formatJson } from "../../../src/modules/estimate/format-json.js";
import type { EstimateResult } from "../../../src/modules/estimate/types.js";

const sample: EstimateResult = {
  schemaVersion: "sipcode-estimate/1",
  task: "refactor the auth module",
  complexity: {
    tier: "high",
    verb: "refactor",
    expectedTurns: [25, 45],
    expectedReads: [12, 25],
    mentionedFiles: 1,
    scopeBoost: 0,
    scopeReduce: 0,
    wordCount: 4,
  },
  repoContext: {
    fileCount: 112,
    framework: "cli",
    manifestPresent: true,
    manifestTokens: 1303,
    fallbackNote: "",
  },
  anchors: {
    matchedCount: 4,
    medianHistoricalTokens: 187_000,
    confidence: "high",
    skipped: false,
  },
  predictions: [
    {
      model: "claude-opus-4",
      estimatedTokens: 195_000,
      tokenBand: [137_000, 274_000],
      costCenter: 1.83,
      costBand: [1.28, 2.56],
    },
    {
      model: "claude-sonnet-4",
      estimatedTokens: 195_000,
      tokenBand: [137_000, 274_000],
      costCenter: 0.37,
      costBand: [0.26, 0.51],
    },
    {
      model: "claude-haiku-4",
      estimatedTokens: 195_000,
      tokenBand: [137_000, 274_000],
      costCenter: 0.1,
      costBand: [0.07, 0.14],
    },
  ],
  recommendation: {
    model: "claude-sonnet-4",
    reason: "sweet spot for high-tier refactor",
    costCenter: 0.37,
  },
  metaPricing: { asOf: "2026-05-01", ageDays: 18 },
  warnings: [],
};

describe("formatJson", () => {
  it("emits valid JSON", () => {
    expect(() => JSON.parse(formatJson(sample))).not.toThrow();
  });

  it("preserves schemaVersion", () => {
    expect(JSON.parse(formatJson(sample)).schemaVersion).toBe(
      "sipcode-estimate/1",
    );
  });

  it("preserves all top-level fields", () => {
    const parsed = JSON.parse(formatJson(sample));
    expect(parsed.task).toBe("refactor the auth module");
    expect(parsed.complexity.tier).toBe("high");
    expect(parsed.repoContext.fileCount).toBe(112);
    expect(parsed.anchors.confidence).toBe("high");
    expect(parsed.predictions).toHaveLength(3);
    expect(parsed.recommendation.model).toBe("claude-sonnet-4");
    expect(parsed.metaPricing.asOf).toBe("2026-05-01");
  });

  it("matches snapshot", () => {
    expect(formatJson(sample)).toMatchSnapshot();
  });
});
