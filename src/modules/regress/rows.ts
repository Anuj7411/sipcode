/**
 * What the regress checks read from each deduped session (loadSessions
 * `analyze`). Pure.
 *
 * Claude Code: one row per API request (message.id + requestId, merged across
 * the lines of a request and deduped across files by loadSessions) that has a
 * usage block, a Claude Code version, and a real model (not "<synthetic>").
 * Codex: one request per turn with tokens, tagged with the Codex version line 1
 * of its file records.
 */
import type { LoadedSession } from "../agents/loadSessions.js";
import type { LimitRequest } from "../limits/attribute.js";
import { releaseOf } from "./catalog.js";

export interface ClaudeRow {
  /** First 8 characters of the session file's id. */
  readonly session: string;
  readonly version: string;
  readonly model: string;
  /** The line's entrypoint ("cli", "sdk-ts", ...); "?" when it has none. */
  readonly entry: string;
  /** Marked isSidechain: a subagent turn logged inside the main file. */
  readonly side: boolean;
  /** Epoch ms; 0 when the line has no valid timestamp. */
  readonly ts: number;
  /** Uncached input tokens. */
  readonly inp: number;
  /** Cache read tokens. */
  readonly cr: number;
  /** Cache write tokens (both TTLs). */
  readonly cw: number;
  /** Cache write tokens at the 5-minute TTL (0 when the split was not logged). */
  readonly c5: number;
  /** Cache write tokens at the 1-hour TTL. */
  readonly c1: number;
  readonly out: number;
  /** Context of the request: inp + cr + cw. */
  readonly ctx: number;
  /** The user line before the request held a tool_result. */
  readonly afterTool: boolean;
}

/** Subagent (sidechain) and Agent SDK (entrypoint sdk-*) requests: left out of every check. */
export function isAutomated(r: ClaudeRow): boolean {
  return r.side || r.entry.startsWith("sdk");
}

export function claudeRows({ meta, parsed }: LoadedSession): ClaudeRow[] {
  const session = meta.sessionId.slice(0, 8);
  const rows: ClaudeRow[] = [];
  for (const t of parsed.assistantTurns) {
    if (t.missingUsage || !t.version || t.model === "<synthetic>") continue;
    const c1 = t.cacheCreation1hTokens;
    const c5 = t.cacheSplitLogged ? Math.max(0, t.cacheCreationTokens - c1) : 0;
    const ts = t.timestamp ? Date.parse(t.timestamp) : Number.NaN;
    rows.push({
      session,
      version: t.version,
      model: t.model ?? "?",
      entry: t.entrypoint ?? "?",
      side: t.sidechain === true,
      ts: Number.isFinite(ts) ? ts : 0,
      inp: t.inputTokens,
      cr: t.cacheReadTokens,
      cw: t.cacheCreationTokens,
      c5,
      c1,
      out: t.outputTokens,
      ctx: t.inputTokens + t.cacheReadTokens + t.cacheCreationTokens,
      afterTool: t.afterToolResult === true,
    });
  }
  // Stable: requests logged with the same time keep their file order.
  return rows.sort((a, b) => a.ts - b.ts);
}

export interface CodexRequest extends LimitRequest {
  /** Codex version line 1 of the file records (pre-release suffix dropped); "?" when unknown. */
  readonly version: string;
  /** Uncached input + output tokens: the tokens most likely to drive limit use. */
  readonly work: number;
}

export function codexRequests({ meta, parsed }: LoadedSession): CodexRequest[] {
  const cwd = meta.cwd ?? parsed.cwd;
  const version = meta.cliVersion ? releaseOf(meta.cliVersion) : "?";
  const out: CodexRequest[] = [];
  for (const t of parsed.assistantTurns) {
    const at = t.timestamp === undefined ? Number.NaN : Date.parse(t.timestamp);
    const tokens = t.inputTokens + t.cacheReadTokens + t.cacheCreationTokens + t.outputTokens;
    if (!Number.isFinite(at) || tokens <= 0) continue;
    out.push({
      at,
      sessionId: meta.sessionId,
      cwd,
      model: t.model,
      tokens,
      version,
      work: t.inputTokens + t.cacheCreationTokens + t.outputTokens,
    });
  }
  return out;
}
