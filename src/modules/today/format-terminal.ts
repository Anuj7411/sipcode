/**
 * Terminal renderer for `sipcode today`. Pure.
 */
import type { TodayReport } from "./types.js";

export function formatTodayTerminal(report: TodayReport): string {
  const lines: string[] = [];
  const dateLabel = report.today?.dateLocal ?? "today";
  lines.push(`sipcode today · ${dateLabel}`);
  lines.push("");

  if (report.status === "no-data") {
    lines.push("  " + report.headline);
    return lines.join("\n");
  }

  if (report.today !== null) {
    const t = report.today;
    lines.push(
      `  spend so far          $${fmt(t.totalSpendUSD)}  across ${t.sessionCount} session${t.sessionCount === 1 ? "" : "s"}`,
    );
    lines.push(
      `  tokens so far        ${fmtTokens(t.totalTokens)}  output ratio ${t.outputRatioPct.toFixed(1)}%`,
    );
    if (t.topLeak !== null) {
      lines.push(
        `  top leak              $${fmt(t.topLeak.costUSD)}  ${t.topLeak.description}`,
      );
    }
    lines.push("");
  }

  if (report.baseline !== null && report.comparison !== null) {
    const b = report.baseline;
    const c = report.comparison;
    const label = b.isPartial
      ? `vs your last ${b.windowDays} days (all you have so far)`
      : `vs your last ${b.windowDays} days (median)`;
    lines.push(`${label}:`);
    lines.push(
      `  spend / day           $${fmt(b.medianSpendPerDayUSD)}  → today is ${fmtDelta(c.spendDeltaPct, "%")} ${arrow(c.spendDeltaPct, /*lowerIsBetter=*/ true)}`,
    );
    lines.push(
      `  tokens / day         ${fmtTokens(b.medianTokensPerDay)}  → today is ${fmtDelta(c.tokenDeltaPct, "%")} ${arrow(c.tokenDeltaPct, /*lowerIsBetter=*/ true)}`,
    );
    lines.push(
      `  output ratio           ${b.medianOutputRatioPct.toFixed(1)}%  → today is ${fmtDeltaPp(c.outputRatioDeltaPp)} ${arrow(-c.outputRatioDeltaPp, /*lowerIsBetter=*/ true)}`,
    );
  } else if (report.baseline !== null && report.comparison === null) {
    lines.push(`(no sessions today — baseline ${report.baseline.windowDays}d still shown above headline)`);
  } else {
    lines.push("(no baseline yet — need ≥3 days of session history)");
  }

  lines.push("");
  lines.push(report.headline);
  return lines.join("\n");
}

function fmt(v: number): string {
  return v.toFixed(2);
}

function fmtTokens(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return v.toLocaleString("en-US");
}

function fmtDelta(pct: number, unit: "%" | "pp"): string {
  const abs = Math.abs(pct);
  if (abs < 0.5) return `even with baseline`;
  return `${abs.toFixed(0)}${unit} ${pct < 0 ? "lower" : "higher"}`;
}

function fmtDeltaPp(pp: number): string {
  const abs = Math.abs(pp);
  if (abs < 0.05) return "even with baseline";
  const sign = pp >= 0 ? "+" : "−";
  return `${sign}${abs.toFixed(1)}pp`;
}

function arrow(pctChange: number, lowerIsBetter: boolean): string {
  if (Math.abs(pctChange) < 0.5) return "·";
  const better = lowerIsBetter ? pctChange < 0 : pctChange > 0;
  return better ? "↓" : "↑";
}
