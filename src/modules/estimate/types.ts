/**
 * Shared types for the `estimate` module.
 *
 * The estimator is heuristic + historical-anchor: ZERO LLM calls. The output
 * predicts the cost of running a given task with each of opus / sonnet / haiku
 * BEFORE the user spends a token.
 */

/** How task verbs roll up into a complexity band. */
export type VerbClass =
  | "refactor" // refactor / rewrite / migrate — HIGH
  | "implement" // implement / add / build — MEDIUM
  | "debug" // fix / debug / investigate — VARIABLE (wide band)
  | "rename" // rename / move / delete / comment — LOW
  | "review" // explain / review / audit — LOW
  | "test" // test / spec — LOW-MEDIUM
  | "other";

export type ComplexityTier = "low" | "medium" | "high";

export interface ComplexityScore {
  readonly tier: ComplexityTier;
  readonly verb: VerbClass;
  /** Min/max expected assistant turns. */
  readonly expectedTurns: readonly [number, number];
  /** Min/max expected file reads. */
  readonly expectedReads: readonly [number, number];
  /** How many file-paths or "the foo module" references appeared in the task. */
  readonly mentionedFiles: number;
  /** "across the codebase" / "everywhere" / etc. */
  readonly scopeBoost: number;
  /** "just" / "only" / "single" — reduces the tier. */
  readonly scopeReduce: number;
  /** Raw word count of the task description. */
  readonly wordCount: number;
}

export interface RepoContext {
  /** Files on disk (manifest count or quick scan). */
  readonly fileCount: number;
  /** Framework label from manifest, or "unknown" if no manifest. */
  readonly framework: string;
  /** Whether `.sipcode/manifest.md` was found and read. */
  readonly manifestPresent: boolean;
  /** Approximate token count of the manifest itself (0 when absent). */
  readonly manifestTokens: number;
  /**
   * Note shown to the user when we fell back to a quick scan instead of the
   * manifest — empty string if manifest was used.
   */
  readonly fallbackNote: string;
}

export interface HistoricalAnchors {
  /** How many past sessions matched the predicted complexity tier. */
  readonly matchedCount: number;
  /** Median total tokens across matched sessions; 0 when none matched. */
  readonly medianHistoricalTokens: number;
  /** "high" ≥3, "medium" 1-2, "low" 0 — UI label. */
  readonly confidence: "low" | "medium" | "high";
  /** True when --no-anchors was passed and lookup was skipped. */
  readonly skipped: boolean;
}

/** A prediction for one model. */
export interface ModelPrediction {
  readonly model: string;
  readonly estimatedTokens: number;
  readonly tokenBand: readonly [number, number];
  readonly costCenter: number;
  readonly costBand: readonly [number, number];
}

export interface Recommendation {
  readonly model: string;
  readonly reason: string;
  readonly costCenter: number;
}

export interface EstimateResult {
  readonly schemaVersion: "sipcode-estimate/1";
  readonly task: string;
  readonly complexity: ComplexityScore;
  readonly repoContext: RepoContext;
  readonly anchors: HistoricalAnchors;
  readonly predictions: ReadonlyArray<ModelPrediction>;
  readonly recommendation: Recommendation;
  readonly metaPricing: { readonly asOf: string; readonly ageDays: number };
  readonly warnings: ReadonlyArray<string>;
}
