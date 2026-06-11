/**
 * Pure orchestrator: resolve a rewriter for the tool, apply it, and shape the
 * Claude Code hook output + a stats entry. NEVER throws — any rewriter failure
 * degrades to a no-op passthrough so the proxy can't break Claude Code.
 */
import type {
  PreToolUseInput,
  HookSpecificOutput,
  ProxyStatsEntry,
  RewriterFn,
} from "./types.js";
import { resolveRewriter } from "./registry.js";

export interface RunRewriterResult {
  readonly hookOutput: HookSpecificOutput | null;
  readonly statsEntry: ProxyStatsEntry | null;
}

const EMPTY: RunRewriterResult = { hookOutput: null, statsEntry: null };

export function runRewriter(
  input: PreToolUseInput,
  resolve: (toolName: string) => RewriterFn | null = resolveRewriter,
): RunRewriterResult {
  try {
    const fn = resolve(input.tool_name);
    if (!fn) return EMPTY;
    const result = fn(input.tool_input);
    if (!result) return EMPTY;
    return {
      hookOutput: {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: result.updatedInput,
        },
      },
      statsEntry: {
        timestamp: new Date().toISOString(),
        toolName: input.tool_name,
        rewriterName: result.rewriterName,
        savedTokensEstimate: result.savedTokensEstimate,
        integrityScore: result.integrityScore,
      },
    };
  } catch {
    return EMPTY;
  }
}
