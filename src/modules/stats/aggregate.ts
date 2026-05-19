/**
 * Pure: ParsedSession + per-session analyzer results → AggregatedSession.
 *
 * Takes the same TokenTotals + DuplicateReads + IdleContext shapes already
 * produced by the existing analyzers. Re-uses those calculations rather
 * than recomputing.
 */
import path from "node:path";
import type { ParsedSession } from "../transcript/parse.js";
import type { TokenTotals } from "../transcript/analyzers/tokens.js";
import type { DuplicateReadsResult } from "../transcript/analyzers/duplicateReads.js";
import type { IdleContextResult } from "../transcript/analyzers/idleContext.js";
import type { AggregatedSession } from "./types.js";

export interface AggregateInput {
  readonly sessionId: string;
  readonly projectHash: string;
  readonly fallbackStartedAtMs: number;
  readonly fileLabel?: string;
  readonly parsed: ParsedSession;
  readonly totals: TokenTotals;
  readonly duplicates: DuplicateReadsResult;
  readonly idle: IdleContextResult;
}

export function humanDuration(sec: number): string {
  if (sec <= 0) return "0s";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

/**
 * Resolve a friendly project name from the session's cwd. Falls back to
 * the project-hash basename. The resolver is intentionally simple — callers
 * should cache results across sessions when iterating.
 */
export function projectNameFromCwd(
  cwd: string | undefined,
  projectHash: string,
): string {
  if (cwd && cwd.length > 0) {
    const cleaned = cwd.replace(/\\/g, "/");
    const base = path.posix.basename(cleaned);
    if (base && base.length > 0) return base;
  }
  // projectHash example: "C--Projects-Sipcode" → take last segment after "-".
  const parts = projectHash.split("-").filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? projectHash;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function aggregateSession(input: AggregateInput): AggregatedSession {
  const { parsed, totals, duplicates, idle, projectHash } = input;
  const startedAtIso = parsed.startedAt
    ?? new Date(input.fallbackStartedAtMs).toISOString();
  const endedAtIso = parsed.endedAt ?? startedAtIso;
  const total =
    totals.inputTokens
    + totals.outputTokens
    + totals.cacheReadTokens
    + totals.cacheCreationTokens;
  const ratioPct = total > 0
    ? Math.round((totals.outputTokens / total) * 1000) / 10
    : 0;
  const projectName = projectNameFromCwd(parsed.cwd, projectHash);
  return {
    sessionId: input.sessionId,
    sessionIdShort: shortId(input.sessionId),
    projectHash,
    projectName,
    startedAt: startedAtIso,
    endedAt: endedAtIso,
    durationSec: parsed.durationSec,
    durationHuman: humanDuration(parsed.durationSec),
    primaryModel: parsed.primaryModel ?? "(unknown)",
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheCreationTokens: totals.cacheCreationTokens,
    totalTokens: total,
    outputRatioPct: ratioPct,
    estCostUSD: totals.estCostUSD,
    toolCallCount: totals.toolCallCount,
    duplicateReadTokens: duplicates.duplicateReadTokenCost,
    idleContextTokens: idle.idleTokenCost,
    label: input.fileLabel ?? "",
  };
}

export interface StatsTotalsInput {
  readonly sessions: ReadonlyArray<AggregatedSession>;
}

export interface ComputedTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly totalTokens: number;
  readonly outputRatioPct: number;
  readonly estCostUSD: number;
  readonly duplicateReadTokens: number;
  readonly idleContextTokens: number;
  readonly toolCallCount: number;
}

export function computeTotals(
  sessions: ReadonlyArray<AggregatedSession>,
): ComputedTotals {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheCreation = 0;
  let usd = 0;
  let dup = 0;
  let idle = 0;
  let tools = 0;
  for (const s of sessions) {
    input += s.inputTokens;
    output += s.outputTokens;
    cacheRead += s.cacheReadTokens;
    cacheCreation += s.cacheCreationTokens;
    usd += s.estCostUSD;
    dup += s.duplicateReadTokens;
    idle += s.idleContextTokens;
    tools += s.toolCallCount;
  }
  const total = input + output + cacheRead + cacheCreation;
  const ratio = total > 0 ? Math.round((output / total) * 1000) / 10 : 0;
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreation,
    totalTokens: total,
    outputRatioPct: ratio,
    estCostUSD: usd,
    duplicateReadTokens: dup,
    idleContextTokens: idle,
    toolCallCount: tools,
  };
}

/**
 * Pick the most-frequent primary model across sessions. Stable ordering on
 * ties (first occurrence wins) so output is reproducible.
 */
export function dominantModel(
  sessions: ReadonlyArray<AggregatedSession>,
): string {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    counts.set(s.primaryModel, (counts.get(s.primaryModel) ?? 0) + 1);
  }
  let best = "(unknown)";
  let bestCount = -1;
  for (const [m, c] of counts) {
    if (c > bestCount) {
      best = m;
      bestCount = c;
    }
  }
  return best;
}
