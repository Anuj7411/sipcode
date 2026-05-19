/**
 * Shields.io endpoint-compatible badge JSON formatter.
 * https://shields.io/endpoint
 */
import { tierColor } from "./tier.js";
import type { ScoreReport } from "./types.js";

export function formatBadge(report: ScoreReport): string {
  const payload = {
    schemaVersion: 1,
    label: "sipcode",
    message: `${report.score} · ${report.tier}`,
    color: tierColor(report.tier),
    namedLogo: "github",
    labelColor: "#0B0E0E",
  };
  return JSON.stringify(payload, null, 2);
}
