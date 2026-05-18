import { describe, expect, it } from "vitest";
import { MESSAGES } from "../../src/lib/messages.js";

/**
 * Brand-voice contract for new error/warning messages:
 *   - starts with [Exxx] / [Rxxx] / [planned]
 *   - lowercase voice (the [Exxx] tag itself uses uppercase)
 *   - contains "why:", "fix:", and "next:" sections
 */
const BRAND_VOICE_REQUIRES = ["why:", "fix:", "next:"];

function assertBrandVoice(s: string, tag: string): void {
  expect(s).toContain(tag);
  for (const need of BRAND_VOICE_REQUIRES) {
    expect(s).toContain(need);
  }
}

describe("MESSAGES — brand voice", () => {
  it("E001 manifestOverBudget", () => {
    assertBrandVoice(MESSAGES.manifestOverBudget(4326, 2000), "[E001]");
  });

  it("E002 manifestParseSkipped", () => {
    assertBrandVoice(
      MESSAGES.manifestParseSkipped("src/foo.ts", "test reason"),
      "[E002]",
    );
  });

  it("E005 claudeMdUnsafe", () => {
    assertBrandVoice(MESSAGES.claudeMdUnsafe("CLAUDE.md"), "[E005]");
  });

  it("E006 gitUnavailable", () => {
    assertBrandVoice(MESSAGES.gitUnavailable, "[E006]");
  });

  it("E007 unsupportedLanguage", () => {
    assertBrandVoice(
      MESSAGES.unsupportedLanguage("foo.rs", "rs"),
      "[E007]",
    );
  });

  it("R001 manifestBudgetWarn", () => {
    assertBrandVoice(MESSAGES.manifestBudgetWarn(1800, 2000), "[R001]");
  });

  it("R007 claudeMdBloated", () => {
    assertBrandVoice(MESSAGES.claudeMdBloated(5000), "[R007]");
  });

  it("delta-not-implemented stub mentions v1.1+", () => {
    expect(MESSAGES.manifestDeltaNotImplemented).toContain("[planned]");
    expect(MESSAGES.manifestDeltaNotImplemented).toContain("v1.1");
  });

  it("explain-not-implemented stub mentions v1.1+", () => {
    expect(MESSAGES.manifestExplainNotImplemented("src/x.ts")).toContain("[planned]");
    expect(MESSAGES.manifestExplainNotImplemented("src/x.ts")).toContain("v1.1");
  });
});
