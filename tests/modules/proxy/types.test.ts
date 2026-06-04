import { describe, it, expect } from "vitest";
import type {
  PreToolUseInput,
  HookSpecificOutput,
  RewriterResult,
  RewriterFn,
  ProxyStatsEntry,
  ProxyReport,
} from "../../../src/modules/proxy/types.js";

describe("proxy types — shape lock (verified Claude Code PreToolUse contract)", () => {
  it("PreToolUseInput matches Claude Code's documented stdin schema", () => {
    const input: PreToolUseInput = {
      session_id: "abc123",
      transcript_path: "/path/to/transcript.jsonl",
      cwd: "/cwd",
      permission_mode: "default",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git status" },
    };
    expect(input.hook_event_name).toBe("PreToolUse");
    expect(input.tool_name).toBe("Bash");
  });

  it("HookSpecificOutput uses updatedInput (the documented field), NOT a fabricated replace_tool_response", () => {
    const out: HookSpecificOutput = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { command: "git status -s" },
      },
    };
    expect(out.hookSpecificOutput.updatedInput).toBeDefined();
  });

  it("RewriterResult is either null (no-rewrite) or carries updatedInput + savings + name", () => {
    const noRewrite: RewriterResult = null;
    const didRewrite: RewriterResult = {
      updatedInput: { command: "git status -s" },
      savedTokensEstimate: 800,
      rewriterName: "git-status",
    };
    expect(noRewrite).toBeNull();
    expect(didRewrite?.rewriterName).toBe("git-status");
  });

  it("RewriterFn is callable as (toolInput) => RewriterResult", () => {
    const fn: RewriterFn = (_input) => null;
    expect(fn({})).toBeNull();
  });

  it("ProxyStatsEntry has timestamp + toolName + rewriterName + savedTokensEstimate", () => {
    const e: ProxyStatsEntry = {
      timestamp: "2026-06-04T12:00:00.000Z",
      toolName: "Bash",
      rewriterName: "git-status",
      savedTokensEstimate: 800,
    };
    expect(e.savedTokensEstimate).toBe(800);
  });

  it("ProxyReport has the v2 schema version and a heuristic-disclaimer note", () => {
    const r: ProxyReport = {
      schemaVersion: "sipcode-proxy/2",
      totalInvocations: 0,
      estimatedSavedTokens: 0,
      perRewriter: {},
      note: "Per-rewriter savings are heuristic estimates.",
    };
    expect(r.schemaVersion).toBe("sipcode-proxy/2");
    expect(r.note.length).toBeGreaterThan(0);
  });
});
