/**
 * Predict — PURE.
 *
 * Combines complexity + repo size + historical anchors into per-model
 * cost predictions.
 *
 * Tokenomics:
 *   - baselineFromComplexity: tokens predicted from the task tier + verb.
 *     Each assistant turn carries an average load; we multiply expectedTurns
 *     midpoint by a per-turn baseline.
 *   - repoSizeContribution: bigger repos mean more discovery before any work
 *     happens. Scales modestly with file count + manifest tokens.
 *   - anchor adjustment: when ≥1 historical anchor was found, we blend
 *     median-historical-tokens into the prediction, with weight proportional
 *     to anchor confidence. Pulls outliers in either direction toward the
 *     anchor median.
 *   - tokenBand: 0.7×-1.4× the central estimate. Lower-bound is tighter than
 *     upper because runs that go wrong tend to balloon.
 *
 * The output ratio (0.6%) is applied per-model in priceTokens — input tokens
 * dominate so heavily that this barely moves the dollar number, but we model
 * it honestly for stability of the JSON schema.
 */
import { priceForModel, type PricingFile } from "../../lib/pricing/load.js";
import type {
  ComplexityScore,
  HistoricalAnchors,
  ModelPrediction,
  RepoContext,
} from "./types.js";

/** The three canonical models we always predict against. */
export const PREDICTION_MODELS: ReadonlyArray<string> = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];

/** Output ratio: canonical 0.6% from the wedge stat. */
export const DEFAULT_OUTPUT_RATIO = 0.006;

/**
 * Tokens per assistant turn at the median, AS-IF-FRESH (no cache reuse).
 * This is the "honest input-equivalent" baseline so when we price it at the
 * input-per-mtok rate we get a number that's comparable to what real
 * cached sessions actually cost.
 */
const TOKENS_PER_TURN = 4000;
/** Tokens added per file read at the median. */
const TOKENS_PER_READ = 1500;

/**
 * Anchor blends — heuristic baseline ignores cache reads, but real sessions
 * are dominated by them. When we DO have anchors, lean heavily on them
 * because they capture real cache + tool patterns the heuristic can't model.
 *
 * The historical anchor is already cache-weighted to "effective input
 * tokens" inside anchors.ts (cache reads counted at 0.1×).
 */
const ANCHOR_WEIGHTS = {
  high: 0.8,
  medium: 0.6,
  low: 0,
} as const;

export interface PredictInput {
  readonly complexity: ComplexityScore;
  readonly repoContext: RepoContext;
  readonly anchors: HistoricalAnchors;
  readonly pricing: PricingFile;
  readonly outputRatio?: number;
}

/** Midpoint of an [a, b] band. */
function mid(a: number, b: number): number {
  return (a + b) / 2;
}

/** Token count predicted from complexity bands alone. */
export function baselineFromComplexity(c: ComplexityScore): number {
  const turns = mid(c.expectedTurns[0], c.expectedTurns[1]);
  const reads = mid(c.expectedReads[0], c.expectedReads[1]);
  return Math.round(turns * TOKENS_PER_TURN + reads * TOKENS_PER_READ);
}

/**
 * Extra tokens contributed by repo size — bigger repos mean more grepping
 * and discovery. Capped so a 50k-file monorepo doesn't blow up the band.
 */
export function repoSizeContribution(repo: RepoContext): number {
  // ~50 tokens per file scanned, capped at 30k for very large repos.
  const fromFiles = Math.min(30_000, repo.fileCount * 50);
  // Manifest itself rides along on every prompt — counted once.
  const fromManifest = repo.manifestTokens;
  return Math.round(fromFiles + fromManifest);
}

/**
 * Blend the heuristic baseline with the historical anchor median.
 *
 * Confidence weighting:
 *   high   (≥3 anchors): 60% anchor, 40% heuristic
 *   medium (1-2 anchors): 35% anchor, 65% heuristic
 *   low    (0 anchors or skipped): 100% heuristic
 */
export function applyAnchorAdjustment(
  baseTokens: number,
  anchors: HistoricalAnchors,
): number {
  if (anchors.skipped || anchors.matchedCount === 0) return baseTokens;
  if (anchors.medianHistoricalTokens <= 0) return baseTokens;
  const wAnchor = ANCHOR_WEIGHTS[anchors.confidence];
  const wHeur = 1 - wAnchor;
  return Math.round(baseTokens * wHeur + anchors.medianHistoricalTokens * wAnchor);
}

/**
 * Cost of a given input-equivalent-token count for a given model.
 *
 * Both the heuristic baseline and the anchor median are normalized to
 * "input-equivalent tokens" — i.e. the count of input tokens that would
 * cost the same as the actual mix when priced at the model's input rate.
 * So pricing is simply tokens × input_per_mtok.
 *
 * The `outputRatio` parameter is preserved for API back-compat but is
 * intentionally unused — the heuristic doesn't separate input from output
 * because the input-equivalent normalization already bakes the output
 * cost in via the OUTPUT_WEIGHT multiplier upstream.
 */
export function priceTokens(
  totalTokens: number,
  model: string,
  pricing: PricingFile,
  outputRatio: number,
): number {
  void outputRatio;
  const row = priceForModel(pricing, model);
  if (!row) return 0;
  return (totalTokens * row.input_per_mtok) / 1_000_000;
}

export function predict(input: PredictInput): ModelPrediction[] {
  const outputRatio = input.outputRatio ?? DEFAULT_OUTPUT_RATIO;
  const baseTokens =
    baselineFromComplexity(input.complexity) +
    repoSizeContribution(input.repoContext);
  const anchorAdjusted = applyAnchorAdjustment(baseTokens, input.anchors);
  const tokenBand: [number, number] = [
    Math.round(anchorAdjusted * 0.7),
    Math.round(anchorAdjusted * 1.4),
  ];

  return PREDICTION_MODELS.map((model) => {
    const center = priceTokens(anchorAdjusted, model, input.pricing, outputRatio);
    const low = priceTokens(tokenBand[0], model, input.pricing, outputRatio);
    const high = priceTokens(tokenBand[1], model, input.pricing, outputRatio);
    return {
      model,
      estimatedTokens: anchorAdjusted,
      tokenBand,
      costCenter: round4(center),
      costBand: [round4(low), round4(high)] as const,
    };
  });
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
