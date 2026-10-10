import { describe, expect, it } from "vitest";
import { MESSAGES } from "../../src/lib/messages.js";

/**
 * Brand-voice contract for new error/warning messages:
 *   - starts with [Exxx] / [Rxxx]
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

  it("--delta / --explain say they are not supported, with no version promise", () => {
    for (const m of [MESSAGES.manifestDeltaNotImplemented, MESSAGES.manifestExplainNotImplemented("src/x.ts")]) {
      expect(m).toContain("is not supported.");
      expect(m).not.toMatch(/planned|v1\.1|lands in|stubbed/);
      expect(m).not.toContain("\u2014");
    }
  });
});

describe("MESSAGES — empty states key on the agent id", () => {
  const claude = { id: "claude-code", displayName: "Claude Code" } as const;
  const codex = { id: "codex", displayName: "Codex" } as const;

  it("Claude Code wording is unchanged and does not depend on the display name", () => {
    const yet = [
      "no Claude Code sessions found yet.",
      "",
      "why: sipcode reads the transcripts Claude Code writes per session, and none exist yet.",
      "",
      "fix: open Claude Code, run any prompt, then come back and run this again.",
    ].join("\n");
    expect(MESSAGES.statsNoSessionsYet()).toBe(yet);
    expect(MESSAGES.statsNoSessionsYet(claude)).toBe(yet);
    expect(MESSAGES.statsNoSessionsYet({ ...claude, displayName: "Claude" })).toBe(yet);
    const win = MESSAGES.statsNoSessionsInWindow("30d");
    expect(win).toContain("why: claude code transcripts exist, but none of them fall inside the window you asked for.");
    expect(MESSAGES.statsNoSessionsInWindow("30d", claude)).toBe(win);
    expect(MESSAGES.statsNoSessionsInWindow("30d", { ...claude, displayName: "Claude" })).toBe(win);
  });

  it("other agents get their own name", () => {
    expect(MESSAGES.statsNoSessionsYet(codex)).toContain("no Codex sessions found yet.");
    expect(MESSAGES.statsNoSessionsYet(codex)).not.toContain("Claude");
    expect(MESSAGES.statsNoSessionsInWindow("30d", codex)).toContain(
      "why: Codex session logs exist, but none of them fall inside the window you asked for.",
    );
  });
});
