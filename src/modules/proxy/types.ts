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
    /**
     * "allow" = output-shrinking rewriters (Phase A): tool still runs with rewritten input.
     * "deny"  = re-read dedup (Phase A+1, v1.6.6+): tool is skipped and
     *          `permissionDecisionReason` is shown to the model so it knows the
     *          content is already in its context from an earlier turn.
     */
    readonly permissionDecision?: "allow" | "deny";
    /** Used when permissionDecision="allow". */
    readonly updatedInput?: Record<string, unknown>;
    /** Reason Claude reads when permissionDecision="deny". */
    readonly permissionDecisionReason?: string;
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
      /**
       * B4 (v1.6.8+): estimated fraction of original signal preserved after
       * the rewrite, 0.0 to 1.0. Honest score per rewriter — not a measured
       * per-invocation number. Used by `sipcode proxy --stats` to flag low-
       * integrity rewrites the user should know about.
       *
       * Score legend:
       *   0.9+ = drops noise only (npm install --silent, dedup)
       *   0.7–0.9 = drops tail safely (git status concise)
       *   0.4–0.7 = caps output (head -50, head_limit)
       *   <0.4   = aggressive trim (git log -n 20 of thousands, cat truncation)
       */
      readonly integrityScore: number;
      /** Optional human-readable note for low-integrity rewrites. */
      readonly integrityNote?: string;
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
  /** B4: integrity score for this invocation (0.0-1.0). Optional for v1.6.7-and-older stats files. */
  readonly integrityScore?: number;
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
      /** B4: weighted average integrity across invocations of this rewriter. */
      avgIntegrityScore?: number;
    }
  >;
  /** B4: weighted average integrity across all rewriters, by invocation count. */
  readonly weightedAvgIntegrityScore?: number | undefined;
  readonly note: string;
}
