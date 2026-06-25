/**
 * Token-totals analyzer — M001, M002, M003, M004, M005, M006, M010, M011.
 * Pure: ParsedSession + pricing → TokenTotals.
 */
import type { ParsedSession } from "../parse.js";
import { priceForModel, type PricingFile } from "../../../lib/pricing/load.js";

export interface TokenTotals {
  /** M001 */ readonly inputTokens: number;
  /** M002 */ readonly outputTokens: number;
  /** M003 */ readonly cacheReadTokens: number;
  /** M004 */ readonly cacheCreationTokens: number;
  /** M005 */ readonly durationSec: number;
  /** M006 */ readonly toolCallCount: number;
  /** M010 — output share of all billable tokens. */
  readonly outputRatio: number;
  /** M011 — total cost in USD across mixed-model turns. */
  readonly estCostUSD: number;
  /** Per-model cost breakdown. */
  readonly costByModel: ReadonlyArray<{ model: string; usd: number; tokens: number }>;
  /** True if no usage blocks were found anywhere in the session. */
  readonly missingAllUsage: boolean;
}

function costForTurn(
  pricing: PricingFile,
  model: string | undefined,
  input: number,
  output: number,
  cacheRead: number,
  cacheCreation: number,
): number {
  if (!model) return 0;
  const row = priceForModel(pricing, model);
  if (!row) return 0;
  return (
    (input * row.input_per_mtok +
      output * row.output_per_mtok +
      cacheRead * row.cache_read_per_mtok +
      cacheCreation * row.cache_creation_per_mtok) /
    1_000_000
  );
}

/**
 * True if a session has no real token activity — either usage data was entirely
 * absent (missingAllUsage) or every billable token field is zero. Used to filter
 * synthetic / observer / empty sessions out of counts and "latest session" picks.
 */
export function isEmptySession(totals: TokenTotals): boolean {
  if (totals.missingAllUsage) return true;
  return (
    totals.inputTokens +
      totals.outputTokens +
      totals.cacheReadTokens +
      totals.cacheCreationTokens ===
    0
  );
}

export function analyzeTokens(
  session: ParsedSession,
  pricing: PricingFile,
): TokenTotals {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheCreation = 0;
  let usageSeen = 0;
  const perModel = new Map<string, { tokens: number; usd: number }>();

  for (const t of session.assistantTurns) {
    input += t.inputTokens;
    output += t.outputTokens;
    cacheRead += t.cacheReadTokens;
    cacheCreation += t.cacheCreationTokens;
    if (!t.missingUsage) usageSeen++;
    const usd = costForTurn(
      pricing,
      t.model,
      t.inputTokens,
      t.outputTokens,
      t.cacheReadTokens,
      t.cacheCreationTokens,
    );
    const key = t.model ?? "(unknown)";
    const prev = perModel.get(key) ?? { tokens: 0, usd: 0 };
    perModel.set(key, {
      tokens:
        prev.tokens +
        t.inputTokens +
        t.outputTokens +
        t.cacheReadTokens +
        t.cacheCreationTokens,
      usd: prev.usd + usd,
    });
  }

  // Total tokens (raw — includes cache reads). Used for cost math and
  // session aggregate stats. Cache reads are the cheap path — billed at
  // the cache_read price, ~10% of input.
  const total = input + output + cacheRead + cacheCreation;
  // Effective denominator EXCLUDES cacheRead (CORRECTNESS FIX, v1.4.0).
  // Why: cache reads are the GOOD/efficient path — prompt caching working
  // as intended. Including them in the denominator made the output ratio
  // ~0.5% on cache-heavy sessions and conflated "efficient caching" with
  // "waste." The honest output ratio is: % of NEW-token work (input you
  // had to send fresh + output Claude produced + new cache material) that
  // became code. Subtracting cacheRead from the denominator gives that.
  // Comparison with the previous formula is still meaningful for relative
  // metrics (before/after impact) because the formula is consistent on
  // both sides.
  const effectiveDenom = input + output + cacheCreation;
  const outputRatio = effectiveDenom > 0 ? output / effectiveDenom : 0;
  const totalUSD = Array.from(perModel.values()).reduce(
    (acc, v) => acc + v.usd,
    0,
  );

  const costByModel = Array.from(perModel.entries())
    .map(([model, v]) => ({ model, usd: v.usd, tokens: v.tokens }))
    .sort((a, b) => b.usd - a.usd);

  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreation,
    durationSec: session.durationSec,
    toolCallCount: session.toolCalls.length,
    outputRatio,
    estCostUSD: totalUSD,
    costByModel,
    missingAllUsage:
      session.assistantTurns.length > 0 && usageSeen === 0,
  };
}
