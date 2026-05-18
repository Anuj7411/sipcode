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

  const total = input + output + cacheRead + cacheCreation;
  const outputRatio = total > 0 ? output / total : 0;
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
