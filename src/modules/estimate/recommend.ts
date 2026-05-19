/**
 * Recommend — PURE.
 *
 * Pick the right model for the task and write a brand-voice one-liner.
 *
 * Rules:
 *   - LOW tier (rename / review / one-liner) → haiku.
 *   - MEDIUM tier OR test → sonnet (sweet spot).
 *   - HIGH tier with refactor verb → opus (gulpy).
 *   - HIGH tier with debug verb → sonnet (rarely needs opus quality; debug
 *     iterates a lot, paying opus tokens-per-turn hurts).
 *   - Fall back to sonnet for anything else.
 *
 * If confidence is "low", caller should append a caveat — we expose
 * `confidenceCaveat` separately so the orchestrator can decide where to put it.
 */
import type {
  ComplexityScore,
  HistoricalAnchors,
  ModelPrediction,
  Recommendation,
} from "./types.js";

export function recommend(
  predictions: ReadonlyArray<ModelPrediction>,
  complexity: ComplexityScore,
  anchors: HistoricalAnchors,
): Recommendation {
  const opus = predictions.find((p) => p.model === "claude-opus-4");
  const sonnet = predictions.find((p) => p.model === "claude-sonnet-4");
  const haiku = predictions.find((p) => p.model === "claude-haiku-4");

  // Fallback safeties — if the pricing layer didn't return a model row,
  // those predictions still exist with cost 0; we just route to sonnet.
  const fallback = sonnet ?? opus ?? haiku;
  if (!fallback) {
    return { model: "claude-sonnet-4", reason: "default", costCenter: 0 };
  }

  let chosen: ModelPrediction = fallback;
  let reason: string;

  if (complexity.tier === "low") {
    chosen = haiku ?? fallback;
    reason = "haiku is the right cup for this";
  } else if (complexity.tier === "high" && complexity.verb === "refactor") {
    chosen = opus ?? fallback;
    reason = "this one's gulpy — opus is the right call";
  } else if (complexity.tier === "high" && complexity.verb === "debug") {
    chosen = sonnet ?? fallback;
    reason = "debug iterates a lot — sonnet keeps the bill sane";
  } else if (complexity.tier === "high") {
    chosen = opus ?? fallback;
    reason = "high-tier work — opus quality earns its keep";
  } else if (complexity.verb === "test") {
    chosen = sonnet ?? fallback;
    reason = "sonnet covers tests at a fraction of opus cost";
  } else {
    // medium / other
    chosen = sonnet ?? fallback;
    reason = "sonnet is the sweet spot";
  }

  // Caveat is appended by the formatter; embed only when truly needed so the
  // string snapshots stay stable.
  if (anchors.confidence === "low" && !anchors.skipped) {
    reason = `${reason} (low-confidence — heuristic only)`;
  }

  return {
    model: chosen.model,
    reason,
    costCenter: chosen.costCenter,
  };
}
