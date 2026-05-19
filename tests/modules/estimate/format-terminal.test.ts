import { describe, expect, it } from "vitest";
import { formatTerminal } from "../../../src/modules/estimate/format-terminal.js";
import type { EstimateResult } from "../../../src/modules/estimate/types.js";

const baseResult: EstimateResult = {
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
    reason: "sonnet is the sweet spot",
    costCenter: 0.37,
  },
  metaPricing: { asOf: "2026-05-01", ageDays: 18 },
  warnings: [],
};

describe("formatTerminal", () => {
  it("includes the task description in the header", () => {
    const s = formatTerminal(baseResult);
    expect(s).toContain('"refactor the auth module"');
  });

  it("includes complexity tier and verb", () => {
    const s = formatTerminal(baseResult);
    expect(s).toContain("complexity: high");
    expect(s).toContain("verb: refactor");
  });

  it("shows matched anchor count", () => {
    const s = formatTerminal(baseResult);
    expect(s).toContain("4 matched");
  });

  it("shows a row per model by default", () => {
    const s = formatTerminal(baseResult);
    expect(s).toContain("opus 4");
    expect(s).toContain("sonnet 4");
    expect(s).toContain("haiku 4");
  });

  it("filters to a single model with onlyModel", () => {
    const s = formatTerminal(baseResult, { onlyModel: "opus" });
    expect(s).toContain("opus 4");
    expect(s).not.toContain("haiku 4");
  });

  it("shows recommendation line with brand voice", () => {
    const s = formatTerminal(baseResult);
    expect(s).toContain("sonnet");
    expect(s).toMatch(/sip don't gulp/i);
  });

  it("shows fallback note when manifest is absent", () => {
    const noManifest: EstimateResult = {
      ...baseResult,
      repoContext: {
        ...baseResult.repoContext,
        manifestPresent: false,
        fallbackNote: "no manifest — using quick scan",
      },
    };
    const s = formatTerminal(noManifest);
    expect(s).toContain("no manifest");
    expect(s).toContain("quick scan");
  });

  it("flags low confidence loudly when anchors empty", () => {
    const noAnchors: EstimateResult = {
      ...baseResult,
      anchors: {
        matchedCount: 0,
        medianHistoricalTokens: 0,
        confidence: "low",
        skipped: false,
      },
    };
    const s = formatTerminal(noAnchors);
    expect(s).toMatch(/low confidence/i);
  });

  it("explains --no-anchors when skipped", () => {
    const skipped: EstimateResult = {
      ...baseResult,
      anchors: {
        matchedCount: 0,
        medianHistoricalTokens: 0,
        confidence: "low",
        skipped: true,
      },
    };
    const s = formatTerminal(skipped);
    expect(s).toContain("--no-anchors");
  });

  it("shows warnings if present", () => {
    const withWarnings: EstimateResult = {
      ...baseResult,
      warnings: ["pricing is 60 days old"],
    };
    const s = formatTerminal(withWarnings);
    expect(s).toContain("pricing is 60 days old");
  });

  it("does not contain emoji", () => {
    const s = formatTerminal(baseResult);
    // crude emoji check: any character above the BMP plain text range
    // (covers the main emoji blocks plus the variation selectors used with them)
    expect(s).not.toMatch(/[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/u);
  });

  it("matches snapshot", () => {
    expect(formatTerminal(baseResult)).toMatchSnapshot();
  });
});
