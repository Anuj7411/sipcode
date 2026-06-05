import type { SessionMetrics, DriftReport } from "./types.js";
import { computeBaseline, detectRegression, MIN_BASELINE } from "./baseline.js";
const NOTE =
  "Drift compares your latest session against the median of recent ones. Conservative by design — it stays silent unless something really moved. Run `sipcode why` for a per-session forensic breakdown.";

export function buildDriftReport(
  latest: SessionMetrics,
  history: ReadonlyArray<SessionMetrics>,
): DriftReport {
  const baseline = computeBaseline(history);

  if (baseline.count < MIN_BASELINE) {
    return {
      schemaVersion: "sipcode-drift/1",
      hasRegression: false,
      summary: `not enough history yet (${baseline.count} prior sessions; need ${MIN_BASELINE}). Keep using Claude Code and re-run.`,
      causes: [],
      latest,
      baseline,
      note: NOTE,
    };
  }

  const reg = detectRegression(latest, baseline);
  const summary = reg.hasRegression
    ? `drift detected — ${reg.causes.length} signal${reg.causes.length === 1 ? "" : "s"} regressed vs your baseline. These cost tokens and degrade answer quality (context rot).`
    : "no drift — context health stable vs your recent baseline.";

  return {
    schemaVersion: "sipcode-drift/1",
    hasRegression: reg.hasRegression,
    summary,
    causes: reg.causes,
    latest,
    baseline,
    note: NOTE,
  };
}
