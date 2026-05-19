/**
 * recommend — pure: turn a CheckResult list into an ordered list of
 * actionable recommendation lines.
 *
 * Sort by points lost (high impact first), then by check id (stable).
 */
import type { CheckResult } from "./types.js";

export function buildRecommendations(
  checks: ReadonlyArray<CheckResult>,
): string[] {
  const failing = checks.filter((c) => !c.passed);
  const sorted = [...failing].sort((a, b) => {
    if (a.maxPoints !== b.maxPoints) return b.maxPoints - a.maxPoints;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sorted.map((c) => {
    const detail = c.details ?? c.label;
    return `${c.id} (-${c.maxPoints}pts): ${detail}`;
  });
}
