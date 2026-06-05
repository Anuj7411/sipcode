import type { DriftReport } from "./types.js";

export function renderDriftTerminal(report: DriftReport): string {
  if (!report.hasRegression) {
    return `Sipcode drift: ${report.summary}`;
  }
  const lines: string[] = [];
  lines.push(`⚠ Sipcode drift — ${report.summary}`);
  lines.push("  Likely causes:");
  for (const c of report.causes) {
    lines.push(`    • ${c.detail}`);
  }
  lines.push("");
  lines.push(`  ${report.note}`);
  return lines.join("\n");
}
