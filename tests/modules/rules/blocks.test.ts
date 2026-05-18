import { describe, expect, it } from "vitest";
import { renderRulesBlock } from "../../../src/modules/rules/blocks.js";
import { approxTokenCount } from "../../../src/lib/tokenizer.js";

describe("renderRulesBlock", () => {
  it("returns a block for each mode tagged with that mode", () => {
    for (const mode of ["default", "strict", "verbose"] as const) {
      const b = renderRulesBlock(mode);
      expect(b.mode).toBe(mode);
      expect(b.body).toContain("Sipcode Output Compression");
      expect(b.body).toContain(`mode: ${mode}`);
    }
  });

  it("default block contains rules 1-7 only (no 8/12 markers)", () => {
    const body = renderRulesBlock("default").body;
    expect(body).toContain("1. **diff-only edits.**");
    expect(body).toContain("7. **no filler verbs.**");
    expect(body).not.toContain("8. **drop sentence-leading articles");
    expect(body).not.toContain("12. **trade-offs after the code");
  });

  it("strict block is a strict superset of default (adds 8-11)", () => {
    const defBody = renderRulesBlock("default").body;
    const strictBody = renderRulesBlock("strict").body;
    // Every default rule appears in strict.
    for (let n = 1; n <= 7; n++) {
      expect(strictBody).toContain(`${n}. **`);
    }
    expect(strictBody).toContain("8. **drop sentence-leading articles");
    expect(strictBody).toContain("11. **never restate the question");
    expect(strictBody).not.toContain("12. **trade-offs after the code");
    // Default rules 1-7 text appears verbatim inside strict.
    const defaultRulesSlice = defBody.slice(
      defBody.indexOf("### rules (default mode)"),
    );
    const ruleSeven = defaultRulesSlice.split("\n").slice(0, 22).join("\n");
    expect(strictBody).toContain("### rules (default mode)");
    expect(strictBody).toContain(ruleSeven.split("\n")[2]!);
  });

  it("verbose block is default + rules 12-14, no strict rules", () => {
    const verboseBody = renderRulesBlock("verbose").body;
    for (let n = 1; n <= 7; n++) {
      expect(verboseBody).toContain(`${n}. **`);
    }
    expect(verboseBody).not.toContain("8. **drop sentence-leading articles");
    expect(verboseBody).toContain("12. **trade-offs after the code");
    expect(verboseBody).toContain("13. **cite sources");
    expect(verboseBody).toContain("14. **annotate diffs");
  });

  it("each mode's block is under 600 approx tokens", () => {
    for (const mode of ["default", "strict", "verbose"] as const) {
      const body = renderRulesBlock(mode).body;
      const tokens = approxTokenCount(body);
      expect(tokens, `${mode} block exceeded 600 tokens: ${tokens}`).toBeLessThan(600);
    }
  });

  it("render is deterministic — same call returns identical body", () => {
    for (const mode of ["default", "strict", "verbose"] as const) {
      expect(renderRulesBlock(mode).body).toBe(renderRulesBlock(mode).body);
    }
  });

  // Snapshot tests — drift prevention.
  it("default mode snapshot", () => {
    expect(renderRulesBlock("default").body).toMatchSnapshot();
  });

  it("strict mode snapshot", () => {
    expect(renderRulesBlock("strict").body).toMatchSnapshot();
  });

  it("verbose mode snapshot", () => {
    expect(renderRulesBlock("verbose").body).toMatchSnapshot();
  });
});
