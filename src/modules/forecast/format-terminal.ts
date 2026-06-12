/**
 * Terminal renderer for `sipcode forecast`. Pure.
 */
import type { ForecastReport } from "./types.js";

export function formatForecastTerminal(report: ForecastReport): string {
  const lines: string[] = [];
  const monthLabel = report.monthEnd?.monthLabel ?? "this month";
  const daysRemainingNote = report.monthEnd
    ? ` (${report.monthEnd.daysRemaining} day${report.monthEnd.daysRemaining === 1 ? "" : "s"} remaining)`
    : "";
  lines.push(`sipcode forecast · projection to end of ${monthLabel}${daysRemainingNote}`);
  lines.push("");

  if (report.status !== "ok" || report.trajectoryInput === null || report.monthEnd === null) {
    lines.push("  " + report.headline);
    return lines.join("\n");
  }

  const t = report.trajectoryInput;
  const me = report.monthEnd;
  const partial = t.isPartial ? ` (partial — all you have so far)` : "";
  lines.push(`  current pace (last ${t.windowDays} days${partial})`);
  lines.push(`    avg daily spend     $${t.avgDailySpendUSD.toFixed(2)}  across ${t.sessionsSampled} sessions`);
  lines.push(`    median daily spend  $${t.medianDailySpendUSD.toFixed(2)}`);
  lines.push("");
  lines.push(`  projected month-end`);
  lines.push(
    `    spend               $${me.projectedSpendUSD.toFixed(2)}   (range: $${me.confidenceLowUSD.toFixed(0)} – $${me.confidenceHighUSD.toFixed(0)})`,
  );
  if (
    report.comparison !== null &&
    report.comparison.lastMonthSpendUSD !== null &&
    report.comparison.vsLastMonthPct !== null
  ) {
    const dir = report.comparison.vsLastMonthPct < 0 ? "less" : "more";
    lines.push(
      `    vs last month       ${Math.abs(report.comparison.vsLastMonthPct).toFixed(1)}% ${dir} than ${dropPrev(me.monthLabel)} ($${report.comparison.lastMonthSpendUSD.toFixed(2)})`,
    );
  }
  lines.push("");
  lines.push("  " + report.headline);
  return lines.join("\n");
}

function dropPrev(monthLabel: string): string {
  return "previous month";
}
