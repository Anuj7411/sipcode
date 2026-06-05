/**
 * Pure: a parsed session → SessionMetrics. Reuses the existing token and
 * duplicate-read analyzers so drift never reinvents transcript math.
 */
import type { ParsedSession } from "../transcript/parse.js";
import { analyzeTokens } from "../transcript/analyzers/tokens.js";
import { analyzeDuplicateReads } from "../transcript/analyzers/duplicateReads.js";
import type { PricingFile } from "../../lib/pricing/load.js";
import type { SessionMetrics } from "./types.js";

export function computeSessionMetrics(
  meta: { sessionId: string; endedAtMs: number },
  session: ParsedSession,
  pricing: PricingFile,
): SessionMetrics {
  const t = analyzeTokens(session, pricing);
  const dup = analyzeDuplicateReads(session);
  const total =
    t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheCreationTokens;
  const turns = session.assistantTurns.length;
  const cacheDenom = t.cacheReadTokens + t.inputTokens + t.cacheCreationTokens;
  return {
    sessionId: meta.sessionId,
    endedAtMs: meta.endedAtMs,
    totalTokens: total,
    assistantTurns: turns,
    tokensPerTurn: turns > 0 ? total / turns : 0,
    cacheHitRate: cacheDenom > 0 ? t.cacheReadTokens / cacheDenom : 0,
    duplicateReadTokens: dup.duplicateReadTokenCost,
    outputRatio: t.outputRatio,
  };
}
