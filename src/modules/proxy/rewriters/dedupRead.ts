/**
 * Pure decision: should this Read call be deduped?
 *
 * Inputs are all values the orchestrator has gathered (cached entry, current
 * file fingerprint, the model's Read tool_input). This module does ZERO I/O —
 * the purity guard (`tests/guards/proxy-rewriter-purity.test.ts`) enforces it.
 *
 * Safety floors (refuse to dedup) — defensive by default:
 *   1. tool_input includes offset or limit (the model is asking for a slice).
 *      Cached "full file" doesn't satisfy a slice request; let it run.
 *   2. cached estimatedTokens < MIN_TOKENS_FOR_DEDUP. Tiny files cost so
 *      little that the deny-reason overhead (~40 tokens) is wasteful.
 *   3. cached sha256 != current sha256, or cached mtimeMs != current mtimeMs.
 *      The file has changed; cache is stale; re-read.
 *
 * When dedup fires, the orchestrator emits a PreToolUse hook output of:
 *   { permissionDecision: "deny", permissionDecisionReason: <reason> }
 *
 * `reason` is short (~40 tokens) so the saving is real on any file > ~80 tokens.
 */
import type { RewriterResult } from "../types.js";
import type { ReadEntry } from "../read-cache.js";

/** Minimum cached token estimate below which dedup is not worth the overhead. */
export const MIN_TOKENS_FOR_DEDUP = 100;

/** Estimated tokens consumed by the deny-reason message itself (heuristic). */
export const REASON_TOKEN_COST = 40;

export type DedupDecision =
  | {
      kind: "dedup";
      /** RewriterResult contract field; deny is signaled by the orchestrator. */
      savedTokensEstimate: number;
      /** Concise message Claude reads. */
      reason: string;
      rewriterName: "dedup-read";
    }
  | { kind: "pass"; reason: PassReason };

export type PassReason =
  | "no-cache-entry"
  | "file-changed"
  | "below-threshold"
  | "partial-read-requested"
  | "missing-current-fingerprint"
  | "missing-file-path";

export interface DedupReadInput {
  /** The Read tool's input as Claude sent it. */
  readonly toolInput: Record<string, unknown>;
  /** Current on-disk fingerprint for the requested file, or null if missing. */
  readonly current: { sha256: string; mtimeMs: number } | null;
  /** Prior cache entry for this file in the same session, or undefined. */
  readonly cached: ReadEntry | undefined;
}

/** Pure decision. */
export function decideReadDedup(input: DedupReadInput): DedupDecision {
  const filePath = input.toolInput.file_path;
  if (typeof filePath !== "string" || filePath.length === 0) {
    return { kind: "pass", reason: "missing-file-path" };
  }

  // Refuse to dedup partial reads — the model is asking for a specific slice.
  if (
    input.toolInput.offset !== undefined ||
    input.toolInput.limit !== undefined
  ) {
    return { kind: "pass", reason: "partial-read-requested" };
  }

  if (!input.cached) return { kind: "pass", reason: "no-cache-entry" };
  if (!input.current) return { kind: "pass", reason: "missing-current-fingerprint" };

  if (
    input.cached.sha256 !== input.current.sha256 ||
    input.cached.mtimeMs !== input.current.mtimeMs
  ) {
    return { kind: "pass", reason: "file-changed" };
  }

  if (input.cached.estimatedTokens < MIN_TOKENS_FOR_DEDUP) {
    return { kind: "pass", reason: "below-threshold" };
  }

  const reason = buildReason(input.cached);
  return {
    kind: "dedup",
    savedTokensEstimate: Math.max(0, input.cached.estimatedTokens - REASON_TOKEN_COST),
    reason,
    rewriterName: "dedup-read",
  };
}

function buildReason(cached: ReadEntry): string {
  // Stay short. Claude needs enough signal to know not to re-ask, plus a
  // pointer back to the turn where the content was first introduced.
  return (
    `Sipcode dedup: ${cached.filePath} is unchanged since turn ${cached.firstReadAtTurn} ` +
    `(sha ${cached.sha256.slice(0, 7)}, ~${cached.estimatedTokens} tokens). ` +
    `The content is still in your context from that turn. ` +
    `If you genuinely need to re-fetch (e.g. external edits expected), call Read again with offset:0 limit:2000 to force.`
  );
}

/** Shape a RewriterResult equivalent for stats wiring (rewriterName + saved tokens). */
export function toRewriterStub(d: Extract<DedupDecision, { kind: "dedup" }>): RewriterResult {
  return {
    // updatedInput is unused for deny; provide an empty object to satisfy the
    // type. The orchestrator never reads this field for dedup results.
    updatedInput: {},
    savedTokensEstimate: d.savedTokensEstimate,
    rewriterName: d.rewriterName,
    integrityScore: 0.95, // dedup defers, never drops content
  };
}
