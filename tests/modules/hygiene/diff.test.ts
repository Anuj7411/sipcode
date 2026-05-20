import { describe, expect, it } from "vitest";
import { computeHygieneDiff } from "../../../src/modules/hygiene/diff.js";

describe("computeHygieneDiff", () => {
  it("identical when both files are unchanged", () => {
    const d = computeHygieneDiff("a", "a", "{}", "{}");
    expect(d.identical).toBe(true);
    expect(d.hunk).toBe("");
    expect(d.summary).toContain("no changes");
  });

  it("marks only CLAUDE.md as changed when settings.json is unchanged", () => {
    const d = computeHygieneDiff("a", "b", "{}", "{}");
    expect(d.identical).toBe(false);
    expect(d.hunk).toContain("--- CLAUDE.md");
    expect(d.hunk).not.toContain("--- settings.json");
    expect(d.summary).toContain("settings.json unchanged");
  });

  it("marks only settings.json as changed when CLAUDE.md is unchanged", () => {
    const d = computeHygieneDiff("a", "a", "{}", `{"x":1}`);
    expect(d.identical).toBe(false);
    expect(d.hunk).toContain("--- settings.json");
    expect(d.hunk).not.toContain("--- CLAUDE.md");
    expect(d.summary).toContain("CLAUDE.md unchanged");
  });

  it("shows both hunks when both files change", () => {
    const d = computeHygieneDiff("a", "b", "{}", `{"x":1}`);
    expect(d.identical).toBe(false);
    expect(d.hunk).toContain("--- CLAUDE.md");
    expect(d.hunk).toContain("--- settings.json");
  });
});
