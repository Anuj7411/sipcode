/**
 * Compare two suite runs for regression detection. Pure.
 *
 * Inputs are two SuiteResult snapshots (e.g. loaded from prior benchmark.json
 * outputs). The output is a per-task delta + a suite-level verdict.
 */
import type { ComparisonReport, SuiteResult } from "./types.js";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const REGRESSION_THRESHOLD_PP = 2.0; // a 2.0pp drop in median = regression.

export interface CompareInput {
  readonly beforeLabel: string;
  readonly before: SuiteResult;
  readonly afterLabel: string;
  readonly after: SuiteResult;
}

export function compareRuns(input: CompareInput): ComparisonReport {
  const beforeById = new Map(input.before.tasks.map((t) => [t.taskId, t]));
  const afterById = new Map(input.after.tasks.map((t) => [t.taskId, t]));
  const allIds = new Set<string>([...beforeById.keys(), ...afterById.keys()]);
  const perTask = [...allIds]
    .sort((a, b) => a.localeCompare(b))
    .map((id) => {
      const b = beforeById.get(id);
      const a = afterById.get(id);
      const beforePct = b?.savingsPct ?? 0;
      const afterPct = a?.savingsPct ?? 0;
      return {
        taskId: id,
        beforePct: round1(beforePct),
        afterPct: round1(afterPct),
        deltaPct: round1(afterPct - beforePct),
      };
    });

  const deltaPct = round1(
    input.after.summary.medianSavingsPct -
      input.before.summary.medianSavingsPct,
  );

  return {
    schemaVersion: "sipcode-benchmark-compare/1",
    before: {
      label: input.beforeLabel,
      medianSavingsPct: input.before.summary.medianSavingsPct,
    },
    after: {
      label: input.afterLabel,
      medianSavingsPct: input.after.summary.medianSavingsPct,
    },
    deltaPct,
    regressed: deltaPct <= -REGRESSION_THRESHOLD_PP,
    perTask,
  };
}
