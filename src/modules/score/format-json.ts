/**
 * JSON formatter for sipcode score. Pure, stable key order, 2-space indent.
 */
import type { ScoreReport } from "./types.js";

export function formatJson(report: ScoreReport): string {
  // Reconstruct with a stable key order so output is byte-deterministic.
  const stable = {
    schemaVersion: report.schemaVersion,
    project: {
      name: report.project.name,
      filesScanned: report.project.filesScanned,
    },
    score: report.score,
    tier: report.tier,
    categories: report.categories.map((c) => ({
      id: c.id,
      name: c.name,
      score: c.score,
      max: c.max,
    })),
    checks: report.checks.map((c) => ({
      id: c.id,
      category: c.category,
      label: c.label,
      passed: c.passed,
      points: c.points,
      maxPoints: c.maxPoints,
      ...(c.details !== undefined ? { details: c.details } : {}),
    })),
    recommendations: [...report.recommendations],
    metaGenerator: {
      version: report.metaGenerator.version,
      asOf: report.metaGenerator.asOf,
    },
  };
  return JSON.stringify(stable, null, 2);
}
