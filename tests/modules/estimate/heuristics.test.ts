import { describe, expect, it } from "vitest";
import { classifyTask } from "../../../src/modules/estimate/heuristics.js";

describe("classifyTask", () => {
  describe("verb classification", () => {
    it("classifies refactor verbs as high tier", () => {
      const r = classifyTask("refactor the auth module");
      expect(r.verb).toBe("refactor");
      expect(r.tier).toBe("high");
    });

    it("classifies rewrite as refactor", () => {
      expect(classifyTask("rewrite the parser").verb).toBe("refactor");
    });

    it("classifies migrate as refactor", () => {
      expect(classifyTask("migrate from sessions to jwt").verb).toBe("refactor");
    });

    it("classifies implement as medium tier", () => {
      const r = classifyTask("implement a healthz endpoint");
      expect(r.verb).toBe("implement");
      expect(r.tier).toBe("medium");
    });

    it("classifies add as implement", () => {
      expect(classifyTask("add a new feature").verb).toBe("implement");
    });

    it("classifies build as implement", () => {
      expect(classifyTask("build a CLI").verb).toBe("implement");
    });

    it("classifies fix as debug (high with wide band)", () => {
      const r = classifyTask("fix the broken test");
      expect(r.verb).toBe("debug");
      expect(r.tier).toBe("high");
      // debug widens the upper band
      expect(r.expectedTurns[1]).toBeGreaterThan(40);
    });

    it("classifies rename as low tier", () => {
      const r = classifyTask("rename foo to bar");
      expect(r.verb).toBe("rename");
      expect(r.tier).toBe("low");
    });

    it("classifies delete as rename", () => {
      expect(classifyTask("delete the legacy controller").verb).toBe("rename");
    });

    it("classifies review/explain as low tier", () => {
      const r = classifyTask("explain how the cache works");
      expect(r.verb).toBe("review");
      expect(r.tier).toBe("low");
    });

    it("classifies audit as review", () => {
      expect(classifyTask("audit security").verb).toBe("review");
    });

    it("classifies test as low tier", () => {
      const r = classifyTask("test the parser");
      expect(r.verb).toBe("test");
      expect(r.tier).toBe("low");
    });

    it("classifies unmatched verbs as other/medium", () => {
      const r = classifyTask("translate the docs");
      expect(r.verb).toBe("other");
      expect(r.tier).toBe("medium");
    });
  });

  describe("file mentions", () => {
    it("counts explicit file paths", () => {
      const r = classifyTask("refactor src/foo.ts and lib/bar.py");
      expect(r.mentionedFiles).toBe(2);
    });

    it("counts module references", () => {
      const r = classifyTask("rename the auth module and the cache service");
      expect(r.mentionedFiles).toBeGreaterThanOrEqual(2);
    });

    it("dedupes repeated file paths", () => {
      const r = classifyTask("edit src/foo.ts; then edit src/foo.ts again");
      expect(r.mentionedFiles).toBe(1);
    });

    it("uses numeric file count when larger", () => {
      const r = classifyTask("refactor 8 files");
      expect(r.mentionedFiles).toBe(8);
    });

    it("returns zero when no files are mentioned", () => {
      const r = classifyTask("add a feature");
      expect(r.mentionedFiles).toBe(0);
    });

    it("raises tier when many files are mentioned", () => {
      const r = classifyTask(
        "rename foo in a.ts, b.ts, c.ts, d.ts, e.ts, f.ts",
      );
      // 6 files boosts low → medium
      expect(r.tier).not.toBe("low");
    });

    it("raises tier two steps when 12+ files are mentioned", () => {
      const r = classifyTask("rename foo in 15 files");
      expect(r.tier).toBe("high");
    });
  });

  describe("scope keywords", () => {
    it("boosts tier with 'across the codebase'", () => {
      const r = classifyTask("rename foo across the codebase");
      expect(r.scopeBoost).toBeGreaterThan(0);
      expect(r.tier).not.toBe("low");
    });

    it("boosts tier with 'everywhere'", () => {
      const r = classifyTask("delete debug logs everywhere");
      expect(r.scopeBoost).toBeGreaterThan(0);
    });

    it("reduces tier with 'just'", () => {
      const r = classifyTask("just rename foo to bar");
      expect(r.scopeReduce).toBeGreaterThan(0);
      expect(r.tier).toBe("low");
    });

    it("reduces tier with 'only' for an implement verb", () => {
      const r = classifyTask("only add a single comment");
      expect(r.scopeReduce).toBeGreaterThan(0);
      // implement (medium) + reduce → low
      expect(r.tier).toBe("low");
    });

    it("reduces tier with 'one-line'", () => {
      const r = classifyTask("implement a one-line fix");
      expect(r.scopeReduce).toBeGreaterThan(0);
    });
  });

  describe("word count effects", () => {
    it("raises tier for long task descriptions", () => {
      const long =
        "rename the foo variable to bar across all the files that import it, " +
        "while making sure to also update the test fixtures and any inline " +
        "documentation references but be careful not to touch generated code " +
        "or vendored dependencies in the third party directory and please " +
        "also remember to run the linter and the formatter on every changed " +
        "file before you call yourself done because we definitely want clean output";
      const r = classifyTask(long);
      expect(r.wordCount).toBeGreaterThanOrEqual(60);
      // rename (low) bumped up because word count ≥ 60
      expect(r.tier).not.toBe("low");
    });

    it("does not raise tier for short tasks", () => {
      const r = classifyTask("rename foo");
      expect(r.wordCount).toBeLessThan(60);
      expect(r.tier).toBe("low");
    });
  });

  describe("expected turn/read bands", () => {
    it("returns numeric bands for every tier", () => {
      for (const task of [
        "explain X",
        "implement Y",
        "refactor Z",
      ]) {
        const r = classifyTask(task);
        expect(r.expectedTurns[0]).toBeLessThan(r.expectedTurns[1]);
        expect(r.expectedReads[0]).toBeLessThanOrEqual(r.expectedReads[1]);
      }
    });

    it("debug verb widens the upper turn band", () => {
      const debug = classifyTask("debug the slow query");
      const refactor = classifyTask("refactor the slow query");
      // debug should have a wider band than vanilla refactor at high tier
      expect(debug.expectedTurns[1]).toBeGreaterThan(refactor.expectedTurns[1]);
    });
  });

  describe("edge cases", () => {
    it("handles empty input", () => {
      const r = classifyTask("");
      expect(r.verb).toBe("other");
      expect(r.wordCount).toBe(0);
      expect(r.mentionedFiles).toBe(0);
    });

    it("handles input with only whitespace", () => {
      const r = classifyTask("   \n\t  ");
      expect(r.wordCount).toBe(0);
    });

    it("is case-insensitive on verbs", () => {
      expect(classifyTask("REFACTOR the foo module").verb).toBe("refactor");
      expect(classifyTask("Fix the bug").verb).toBe("debug");
    });
  });
});
