/**
 * run — pure pipeline that turns a CodebaseSnapshot into a ScoreReport.
 *
 * Iterates every registered check, aggregates by category, computes tier and
 * recommendations. Deterministic ordering (category, then SC id ascending).
 */
import "./checks/index.js"; // side-effect: register every check
import { CATEGORY_NAMES } from "./types.js";
import { tierFor } from "./tier.js";
import { getAllChecks } from "./registry.js";
import { buildRecommendations } from "./recommend.js";
import type {
  CategoryId,
  CategoryScore,
  CheckResult,
  CodebaseSnapshot,
  ScoreReport,
} from "./types.js";

export interface RunOptions {
  /** Sipcode version string for metaGenerator. */
  readonly version: string;
  /** ISO timestamp for metaGenerator. */
  readonly asOf: string;
}

export function runScore(
  snapshot: CodebaseSnapshot,
  opts: RunOptions,
): ScoreReport {
  const defs = getAllChecks();
  const checks: CheckResult[] = [];
  let total = 0;

  for (const def of defs) {
    const r = def.run(snapshot);
    const points = r.passed ? def.maxPoints : 0;
    total += points;
    checks.push({
      id: def.id,
      category: def.category,
      label: def.label,
      passed: r.passed,
      points,
      maxPoints: def.maxPoints,
      ...(r.details !== undefined ? { details: r.details } : {}),
    });
  }

  const score = Math.round(total);
  const tier = tierFor(score);

  const categories: CategoryScore[] = (
    ["A", "B", "C", "D", "E"] as ReadonlyArray<CategoryId>
  ).map((id) => {
    let s = 0;
    let m = 0;
    for (const c of checks) {
      if (c.category !== id) continue;
      s += c.points;
      m += c.maxPoints;
    }
    return { id, name: CATEGORY_NAMES[id], score: s, max: m };
  });

  return {
    schemaVersion: "sipcode-score/1",
    project: {
      name: snapshot.projectName,
      filesScanned: snapshot.scanned.length,
    },
    score,
    tier,
    categories,
    checks,
    recommendations: buildRecommendations(checks),
    metaGenerator: {
      version: opts.version,
      asOf: opts.asOf,
    },
  };
}
