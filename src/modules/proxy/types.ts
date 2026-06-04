/**
 * Verified Claude Code hook contract types — PreToolUse only.
 * Source: https://code.claude.com/docs/en/hooks (verified 2026-06-04).
 *
 * IMPORTANT: PostToolUse is intentionally not used. Claude Code's
 * PostToolUse cannot replace a tool's output (verified). The only
 * documented output-modification path is `decision: "block"` plus
 * `additionalContext`, which is intentionally NOT exercised in
 * Phase A — it would lose the natural-tool-output UX that makes
 * the proxy transparent.
 *
 * An earlier draft of this design assumed a PostToolUse
 * output-replacement field that DOES NOT EXIST in Claude Code's hook
 * contract. tests/guards/proxy-no-fabricated-fields.test.ts asserts the
 * fabricated field name never reappears in this module's source.
 */

/** PreToolUse JSON delivered on stdin to the hook script. */
export interface PreToolUseInput {
  readonly session_id: string;
  readonly transcript_path: string;
  readonly cwd: string;
  readonly permission_mode: string;
  readonly hook_event_name: "PreToolUse";
  readonly tool_name: string;
  readonly tool_input: Record<string, unknown>;
}

/** Standard JSON the hook writes to stdout to influence Claude Code. */
export interface HookSpecificOutput {
  readonly hookSpecificOutput: {
    readonly hookEventName: "PreToolUse";
    /** Always "allow" for the proxy — we never block, only rewrite. */
    readonly permissionDecision?: "allow";
    /** The modified tool_input that replaces the original. THIS IS THE LEVER. */
    readonly updatedInput?: Record<string, unknown>;
    readonly additionalContext?: string;
  };
}

/** Per-rewriter result. `null` means "no change" (passthrough). */
export type RewriterResult =
  | null
  | {
      readonly updatedInput: Record<string, unknown>;
      readonly savedTokensEstimate: number;
      readonly rewriterName: string;
    };

/** Rewriter function signature. Pure. */
export type RewriterFn = (
  toolInput: Record<string, unknown>,
) => RewriterResult;

/** One proxy hook invocation written to .sipcode/proxy-stats/<pid>-<ts>.jsonl. */
export interface ProxyStatsEntry {
  readonly timestamp: string;
  readonly toolName: string;
  readonly rewriterName: string;
  /** Estimated tokens saved (heuristic, not measured per-invocation). */
  readonly savedTokensEstimate: number;
}

/** Aggregated report — what `get_proxy_stats` MCP tool returns. */
export interface ProxyReport {
  readonly schemaVersion: "sipcode-proxy/2";
  readonly totalInvocations: number;
  readonly estimatedSavedTokens: number;
  readonly perRewriter: Record<
    string,
    {
      invocations: number;
      estimatedSavedTokens: number;
    }
  >;
  readonly note: string;
}
