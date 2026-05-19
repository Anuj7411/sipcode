import { describe, expect, it } from "vitest";
import {
  applyAnchorAdjustment,
  baselineFromComplexity,
  predict,
  priceTokens,
  repoSizeContribution,
  PREDICTION_MODELS,
} from "../../../src/modules/estimate/predict.js";
import { classifyTask } from "../../../src/modules/estimate/heuristics.js";
import { loadPricingForDate } from "../../../src/lib/pricing/load.js";
import type {
  HistoricalAnchors,
  RepoContext,
} from "../../../src/modules/estimate/types.js";

const pricing = loadPricingForDate(new Date("2026-05-19"));

const emptyAnchors: HistoricalAnchors = {
  matchedCount: 0,
  medianHistoricalTokens: 0,
  confidence: "low",
  skipped: false,
};

const mediumAnchors: HistoricalAnchors = {
  matchedCount: 2,
  medianHistoricalTokens: 50_000,
  confidence: "medium",
  skipped: false,
};

const highAnchors: HistoricalAnchors = {
  matchedCount: 5,
  medianHistoricalTokens: 1_000_000,
  confidence: "high",
  skipped: false,
};

const tinyRepo: RepoContext = {
  fileCount: 10,
  framework: "cli",
  manifestPresent: true,
  manifestTokens: 500,
  fallbackNote: "",
};

const bigRepo: RepoContext = {
  fileCount: 500,
  framework: "next-app",
  manifestPresent: true,
  manifestTokens: 1900,
  fallbackNote: "",
};

describe("baselineFromComplexity", () => {
  it("scales with tier (high ≥ medium ≥ low)", () => {
    const low = baselineFromComplexity(classifyTask("rename foo"));
    const med = baselineFromComplexity(
      classifyTask("implement a new endpoint"),
    );
    const high = baselineFromComplexity(
      classifyTask("refactor the auth module"),
    );
    expect(high).toBeGreaterThan(med);
    expect(med).toBeGreaterThan(low);
  });

  it("returns a positive integer for any non-empty task", () => {
    const n = baselineFromComplexity(classifyTask("audit security"));
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
  });
});

describe("repoSizeContribution", () => {
  it("grows with file count, capped at 30k", () => {
    const small = repoSizeContribution(tinyRepo);
    const big = repoSizeContribution(bigRepo);
    expect(big).toBeGreaterThan(small);
  });

  it("caps file contribution at 30k tokens", () => {
    const huge: RepoContext = {
      fileCount: 100_000,
      framework: "x",
      manifestPresent: false,
      manifestTokens: 0,
      fallbackNote: "",
    };
    expect(repoSizeContribution(huge)).toBe(30_000);
  });

  it("adds manifest token count on top of file contribution", () => {
    const repo: RepoContext = {
      fileCount: 100,
      framework: "x",
      manifestPresent: true,
      manifestTokens: 1500,
      fallbackNote: "",
    };
    expect(repoSizeContribution(repo)).toBe(100 * 50 + 1500);
  });
});

describe("applyAnchorAdjustment", () => {
  it("returns baseline unchanged when no anchors matched", () => {
    expect(applyAnchorAdjustment(100_000, emptyAnchors)).toBe(100_000);
  });

  it("returns baseline unchanged when anchors are skipped", () => {
    const skipped: HistoricalAnchors = {
      matchedCount: 5,
      medianHistoricalTokens: 999_999,
      confidence: "high",
      skipped: true,
    };
    expect(applyAnchorAdjustment(100_000, skipped)).toBe(100_000);
  });

  it("blends heavily toward anchor on high confidence", () => {
    const result = applyAnchorAdjustment(100_000, highAnchors);
    // wAnchor = 0.8 → 0.2 * 100k + 0.8 * 1M = 820k
    expect(result).toBeGreaterThan(700_000);
  });

  it("blends modestly on medium confidence", () => {
    const result = applyAnchorAdjustment(100_000, mediumAnchors);
    // wAnchor = 0.6 → 0.4 * 100k + 0.6 * 50k = 70k
    expect(result).toBeLessThan(100_000);
    expect(result).toBeGreaterThan(50_000);
  });

  it("ignores zero-token anchors", () => {
    const a: HistoricalAnchors = {
      matchedCount: 1,
      medianHistoricalTokens: 0,
      confidence: "medium",
      skipped: false,
    };
    expect(applyAnchorAdjustment(100_000, a)).toBe(100_000);
  });
});

describe("priceTokens", () => {
  it("prices tokens at the model's input rate", () => {
    // opus input: $15/Mtok → 1M tokens = $15
    const cost = priceTokens(1_000_000, "claude-opus-4", pricing, 0.006);
    expect(cost).toBeCloseTo(15, 2);
  });

  it("opus > sonnet > haiku at the same token count", () => {
    const opus = priceTokens(1_000_000, "claude-opus-4", pricing, 0.006);
    const sonnet = priceTokens(1_000_000, "claude-sonnet-4", pricing, 0.006);
    const haiku = priceTokens(1_000_000, "claude-haiku-4", pricing, 0.006);
    expect(opus).toBeGreaterThan(sonnet);
    expect(sonnet).toBeGreaterThan(haiku);
  });

  it("returns 0 for unknown model", () => {
    expect(priceTokens(100_000, "claude-unicorn-9", pricing, 0.006)).toBe(0);
  });
});

describe("predict", () => {
  it("returns one prediction per model", () => {
    const result = predict({
      complexity: classifyTask("refactor the auth module"),
      repoContext: tinyRepo,
      anchors: emptyAnchors,
      pricing,
    });
    expect(result).toHaveLength(PREDICTION_MODELS.length);
  });

  it("each prediction has a sane token band", () => {
    const result = predict({
      complexity: classifyTask("refactor the auth module"),
      repoContext: tinyRepo,
      anchors: emptyAnchors,
      pricing,
    });
    for (const p of result) {
      expect(p.tokenBand[0]).toBeLessThan(p.estimatedTokens);
      expect(p.estimatedTokens).toBeLessThan(p.tokenBand[1]);
      expect(p.costBand[0]).toBeLessThanOrEqual(p.costCenter);
      expect(p.costCenter).toBeLessThanOrEqual(p.costBand[1]);
    }
  });

  it("high-tier tasks predict more tokens than low-tier ones (property)", () => {
    const low = predict({
      complexity: classifyTask("rename foo"),
      repoContext: tinyRepo,
      anchors: emptyAnchors,
      pricing,
    });
    const high = predict({
      complexity: classifyTask("refactor the auth module"),
      repoContext: tinyRepo,
      anchors: emptyAnchors,
      pricing,
    });
    expect(high[0]!.estimatedTokens).toBeGreaterThan(low[0]!.estimatedTokens);
  });

  it("bigger repos predict more tokens than smaller ones (property)", () => {
    const small = predict({
      complexity: classifyTask("refactor the auth module"),
      repoContext: tinyRepo,
      anchors: emptyAnchors,
      pricing,
    });
    const big = predict({
      complexity: classifyTask("refactor the auth module"),
      repoContext: bigRepo,
      anchors: emptyAnchors,
      pricing,
    });
    expect(big[0]!.estimatedTokens).toBeGreaterThan(small[0]!.estimatedTokens);
  });

  it("uses anchor median when high confidence", () => {
    const result = predict({
      complexity: classifyTask("refactor the auth module"),
      repoContext: tinyRepo,
      anchors: highAnchors,
      pricing,
    });
    // anchor at 1M, wAnchor 0.8 → estimated tokens dominated by anchor
    expect(result[0]!.estimatedTokens).toBeGreaterThan(500_000);
  });
});
