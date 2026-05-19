import { describe, expect, it } from "vitest";
import { recommend } from "../../../src/modules/estimate/recommend.js";
import { classifyTask } from "../../../src/modules/estimate/heuristics.js";
import { predict } from "../../../src/modules/estimate/predict.js";
import { loadPricingForDate } from "../../../src/lib/pricing/load.js";
import type {
  HistoricalAnchors,
  RepoContext,
} from "../../../src/modules/estimate/types.js";

const pricing = loadPricingForDate(new Date("2026-05-19"));

const repo: RepoContext = {
  fileCount: 100,
  framework: "cli",
  manifestPresent: true,
  manifestTokens: 1000,
  fallbackNote: "",
};

const noAnchors: HistoricalAnchors = {
  matchedCount: 0,
  medianHistoricalTokens: 0,
  confidence: "low",
  skipped: false,
};

const skippedAnchors: HistoricalAnchors = {
  matchedCount: 0,
  medianHistoricalTokens: 0,
  confidence: "low",
  skipped: true,
};

const goodAnchors: HistoricalAnchors = {
  matchedCount: 4,
  medianHistoricalTokens: 100_000,
  confidence: "high",
  skipped: false,
};

function predictFor(task: string, anchors: HistoricalAnchors = goodAnchors) {
  return predict({
    complexity: classifyTask(task),
    repoContext: repo,
    anchors,
    pricing,
  });
}

describe("recommend", () => {
  describe("model selection truth table", () => {
    it("low tier → haiku", () => {
      const preds = predictFor("rename foo");
      const r = recommend(preds, classifyTask("rename foo"), goodAnchors);
      expect(r.model).toBe("claude-haiku-4");
    });

    it("explain (review verb) → haiku", () => {
      const preds = predictFor("explain how the cache works");
      const r = recommend(
        preds,
        classifyTask("explain how the cache works"),
        goodAnchors,
      );
      expect(r.model).toBe("claude-haiku-4");
    });

    it("medium implement → sonnet", () => {
      const preds = predictFor("implement a healthz endpoint");
      const r = recommend(
        preds,
        classifyTask("implement a healthz endpoint"),
        goodAnchors,
      );
      expect(r.model).toBe("claude-sonnet-4");
    });

    it("high refactor → opus", () => {
      const preds = predictFor("refactor the auth module");
      const r = recommend(
        preds,
        classifyTask("refactor the auth module"),
        goodAnchors,
      );
      expect(r.model).toBe("claude-opus-4");
    });

    it("high debug → sonnet (iterates a lot)", () => {
      const preds = predictFor(
        "fix the broken parser across the codebase",
      );
      const r = recommend(
        preds,
        classifyTask("fix the broken parser across the codebase"),
        goodAnchors,
      );
      expect(r.model).toBe("claude-sonnet-4");
    });

    it("test verb → sonnet", () => {
      const preds = predictFor("test the parser");
      const c = classifyTask("test the parser");
      // ensure tier and verb consistent
      expect(c.verb).toBe("test");
      const r = recommend(preds, c, goodAnchors);
      // test is low tier → haiku (since low tier wins)
      expect(r.model).toBe("claude-haiku-4");
    });
  });

  describe("reason strings (brand voice)", () => {
    it("haiku one-liner", () => {
      const c = classifyTask("rename foo");
      const r = recommend(predictFor("rename foo"), c, goodAnchors);
      expect(r.reason).toMatch(/haiku/i);
    });

    it("opus one-liner mentions gulpy", () => {
      const c = classifyTask("refactor the auth module");
      const r = recommend(
        predictFor("refactor the auth module"),
        c,
        goodAnchors,
      );
      expect(r.reason).toMatch(/gulpy|opus/);
    });

    it("sonnet one-liner mentions sweet spot", () => {
      const c = classifyTask("implement a healthz endpoint");
      const r = recommend(
        predictFor("implement a healthz endpoint"),
        c,
        goodAnchors,
      );
      expect(r.reason).toMatch(/sweet spot/);
    });

    it("appends low-confidence caveat when no anchors matched", () => {
      const c = classifyTask("implement a healthz endpoint");
      const r = recommend(
        predictFor("implement a healthz endpoint", noAnchors),
        c,
        noAnchors,
      );
      expect(r.reason).toMatch(/low-confidence|heuristic only/i);
    });

    it("does NOT append caveat when anchors were explicitly skipped", () => {
      const c = classifyTask("implement a healthz endpoint");
      const r = recommend(
        predictFor("implement a healthz endpoint", skippedAnchors),
        c,
        skippedAnchors,
      );
      // skipped is a user choice — caller adds a different warning
      expect(r.reason).not.toMatch(/low-confidence/i);
    });
  });

  describe("cost field", () => {
    it("recommendation costCenter matches chosen model's costCenter", () => {
      const c = classifyTask("rename foo");
      const preds = predictFor("rename foo");
      const r = recommend(preds, c, goodAnchors);
      const chosen = preds.find((p) => p.model === r.model)!;
      expect(r.costCenter).toBe(chosen.costCenter);
    });
  });
});
