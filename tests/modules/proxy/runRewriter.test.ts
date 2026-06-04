import { describe, it, expect } from "vitest";
import { runRewriter } from "../../../src/modules/proxy/runRewriter.js";
import type { PreToolUseInput } from "../../../src/modules/proxy/types.js";

function preToolUse(tool_name: string, tool_input: Record<string, unknown>): PreToolUseInput {
  return {
    session_id: "s",
    transcript_path: "/t",
    cwd: "/c",
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name,
    tool_input,
  };
}

describe("runRewriter", () => {
  it("rewrites git status and emits hook output + stats entry", () => {
    const r = runRewriter(preToolUse("Bash", { command: "git status" }));
    expect(r.hookOutput?.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(r.hookOutput?.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(r.hookOutput?.hookSpecificOutput.updatedInput?.command).toBe("git status -s");
    expect(r.statsEntry?.rewriterName).toBe("git-status");
    expect(r.statsEntry?.toolName).toBe("Bash");
    expect(typeof r.statsEntry?.savedTokensEstimate).toBe("number");
  });

  it("returns null hookOutput when no rewriter matches", () => {
    const r = runRewriter(preToolUse("Bash", { command: "echo hello" }));
    expect(r.hookOutput).toBeNull();
    expect(r.statsEntry).toBeNull();
  });

  it("returns null for unknown tools", () => {
    const r = runRewriter(preToolUse("WebFetch", { url: "https://x" }));
    expect(r.hookOutput).toBeNull();
  });

  it("never throws — a throwing rewriter is caught and yields null", () => {
    const throwingResolver = () => () => {
      throw new Error("boom");
    };
    const r = runRewriter(preToolUse("Bash", { command: "git status" }), throwingResolver);
    expect(r.hookOutput).toBeNull();
    expect(r.statsEntry).toBeNull();
  });
});
