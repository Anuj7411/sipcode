/**
 * Compare-mode terminal formatter. Pure.
 */
import chalk from "chalk";
import type { ComparisonReport } from "./types.js";

interface FormatOptions {
  readonly useColor: boolean;
}

function makeColors(useColor: boolean) {
  if (!useColor) {
    const id = (s: string) => s;
    return { bold: id, dim: id, green: id, red: id, yellow: id, cyan: id };
  }
  return {
    bold: chalk.bold,
    dim: chalk.dim,
    green: chalk.green,
    red: chalk.red,
    yellow: chalk.yellow,
    cyan: chalk.cyan,
  };
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function signed(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}pp`;
}

export function formatCompare(
  report: ComparisonReport,
  opts: FormatOptions = { useColor: true },
): string {
  const c = makeColors(opts.useColor);
  const lines: string[] = [];
  lines.push(c.bold("sipcode benchmark compare"));
  lines.push("");
  const arrow = report.deltaPct >= 0 ? c.green("▲") : c.red("▼");
  const verdict = report.regressed
    ? c.red("regression")
    : report.deltaPct > 0
      ? c.green("improvement")
      : c.dim("no significant change");
  lines.push(
    `  before (${c.cyan(report.before.label)}): ${pct(report.before.medianSavingsPct)} median`,
  );
  lines.push(
    `  after  (${c.cyan(report.after.label)}): ${pct(report.after.medianSavingsPct)} median`,
  );
  lines.push(`  delta: ${arrow} ${signed(report.deltaPct)} · ${verdict}`);
  lines.push("");
  lines.push(c.bold("per-task delta"));
  for (const t of report.perTask) {
    const tArrow =
      t.deltaPct > 0
        ? c.green("▲")
        : t.deltaPct < 0
          ? c.red("▼")
          : c.dim("·");
    lines.push(
      `  ${c.cyan(t.taskId.padEnd(6))} ${pct(t.beforePct).padStart(6)} → ${pct(t.afterPct).padStart(6)}  ${tArrow} ${signed(t.deltaPct)}`,
    );
  }
  return lines.join("\n");
}
