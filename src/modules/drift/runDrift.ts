import type { SessionMetrics, DriftReport, DriftCause } from "./types.js";
import { computeBaseline, detectRegression, MIN_BASELINE } from "./baseline.js";

const NOTE =
  "Drift compares your latest session against the median of recent ones. Conservative by design — it stays silent unless something really moved. Run `sipcode why` for a per-session forensic breakdown.";

export interface BuildOptions {
  /** Which project this report is scoped to (the latest session's project). */
  readonly projectHash?: string;
  /** "project" = we had enough per-project history; "global" = fell back to all sessions. */
  readonly baselineScope?: "project" | "global";
  /** Per-metric attribution strings injected into matching causes. Keyed by `DriftCause.metric`. */
  readonly attributions?: Record<string, string>;
}

export function buildDriftReport(
  latest: SessionMetrics,
  history: ReadonlyArray<SessionMetrics>,
  opts: BuildOptions = {},
): DriftReport {
  const baseline = computeBaseline(history);

  if (baseline.count < MIN_BASELINE) {
    const scopeNote =
      opts.baselineScope === "project"
        ? ` for this project (${opts.projectHash ?? "unknown"})`
        : "";
    return {
      schemaVersion: "sipcode-drift/2",
      hasRegression: false,
      summary: `not enough history yet${scopeNote} (${baseline.count} prior sessions; need ${MIN_BASELINE}). Keep using Claude Code and re-run.`,
      causes: [],
      latest,
      baseline,
      note: NOTE,
      ...(opts.projectHash !== undefined ? { projectHash: opts.projectHash } : {}),
      ...(opts.baselineScope !== undefined ? { baselineScope: opts.baselineScope } : {}),
    };
  }

  const reg = detectRegression(latest, baseline);

  const causes: DriftCause[] = reg.causes.map((c) => {
    const attribution = opts.attributions?.[c.metric];
    return attribution ? { ...c, attribution } : c;
  });

  const scopeWord =
    opts.baselineScope === "global"
      ? " (using your global baseline; not enough per-project history yet)"
      : "";
  const summary = reg.hasRegression
    ? `drift detected — ${causes.length} signal${causes.length === 1 ? "" : "s"} regressed vs your baseline${scopeWord}. These cost tokens and degrade answer quality (context rot).`
    : `no drift — context health stable vs your recent baseline${scopeWord}.`;

  return {
    schemaVersion: "sipcode-drift/2",
    hasRegression: reg.hasRegression,
    summary,
    causes,
    latest,
    baseline,
    note: NOTE,
    ...(opts.projectHash !== undefined ? { projectHash: opts.projectHash } : {}),
    ...(opts.baselineScope !== undefined ? { baselineScope: opts.baselineScope } : {}),
  };
}
