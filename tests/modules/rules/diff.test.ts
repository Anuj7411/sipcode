import { describe, expect, it } from "vitest";
import { computeDiff } from "../../../src/modules/rules/diff.js";

describe("computeDiff", () => {
  it("reports identical for identical inputs", () => {
    const d = computeDiff("a\nb\nc\n", "a\nb\nc\n");
    expect(d.identical).toBe(true);
    expect(d.summary).toContain("no changes");
    expect(d.hunk).toBe("");
  });

  it("reports add+remove counts for differing inputs", () => {
    const d = computeDiff("a\nb\nc\n", "a\nB\nc\n");
    expect(d.identical).toBe(false);
    expect(d.summary).toContain("added");
    expect(d.summary).toContain("removed");
    expect(d.hunk).toContain("- b");
    expect(d.hunk).toContain("+ B");
  });

  it("includes a hunk header", () => {
    const d = computeDiff("x", "y");
    expect(d.hunk).toMatch(/@@ -1,1 \+1,1 @@/);
  });

  it("handles empty before (pure addition)", () => {
    const d = computeDiff("", "new\nlines\n");
    expect(d.identical).toBe(false);
    expect(d.hunk).toContain("+ new");
  });
});
