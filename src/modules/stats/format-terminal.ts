/**
 * Terminal formatter for stats. Pure. Uses chalk only when useColor=true.
 *
 * Layout mirrors the spec: header, punchline + savings, trend sparkline,
 * top expensive, projects, footer.
 */
import chalk from "chalk";
import { formatNum } from "../../lib/format.js";
import type { StatsResult } from "./types.js";
import { sparkline, sparklineStats } from "./sparkline.js";

interface FormatOptions {
  readonly useColor: boolean;
}

function makeColors(useColor: boolean) {
  if (!useColor) {
    const id = (s: string) => s;
    return {
      bold: id,
      dim: id,
      cyan: id,
      magenta: id,
      yellow: id,
      green: id,
      red: id,
    };
  }
  return {
    bold: chalk.bold,
    dim: chalk.dim,
    cyan: chalk.cyan,
    magenta: chalk.magenta,
    yellow: chalk.yellow,
    green: chalk.green,
    red: chalk.red,
  };
}

function usd(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  if (Math.abs(n) >= 100) return `$${n.toFixed(2)}`;
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function humanTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

function windowLabel(raw: string): string {
  if (raw === "all") return "all time";
  if (/^\d+d$/.test(raw)) return `last ${raw.replace("d", " days")}`;
  return `since ${raw}`;
}

export function formatTerminal(
  report: StatsResult,
  opts: FormatOptions = { useColor: true },
): string {
  const c = makeColors(opts.useColor);
  const lines: string[] = [];

  lines.push(
    `${c.bold("sipcode stats")} ${c.dim("·")} ${windowLabel(report.window.raw)} ${c.dim("·")} ${c.cyan(`${report.sessionCount} sessions`)} ${c.dim("·")} ${c.magenta(report.primaryModel)}`,
  );
  lines.push("");

  if (report.sessionCount === 0) {
    lines.push(c.dim("no sessions in this window."));
    lines.push("");
    lines.push(
      c.dim(`prices from ${report.metaPricing.asOf} (${report.metaPricing.ageDays} days old)`),
    );
    return lines.join("\n");
  }

  // Punchline.
  const total = report.totals.totalTokens;
  const output = report.totals.outputTokens;
  const ratio = report.totals.outputRatioPct;
  lines.push(
    `across ${formatNum(report.sessionCount)} sessions you burned ${c.bold(formatNum(total))} tokens.`,
  );
  lines.push(
    `output ratio: ${c.yellow(`${ratio}%`)} of all tokens — ${(100 - ratio).toFixed(1)}% was exploration, re-reads, and idle context.`,
  );
  lines.push("");

  // Savings.
  const s = report.savings;
  lines.push(c.bold("estimated wasted on patterns sipcode catches:"));
  lines.push(
    `  · duplicate file reads        ${formatNum(s.duplicateReadsTokens).padStart(14)} tokens   (${usd(s.duplicateReadsUSD)})`,
  );
  lines.push(
    `  · idle context                ${formatNum(s.idleContextTokens).padStart(14)} tokens   (${usd(s.idleContextUSD)})`,
  );
  lines.push(
    `  · cache-creation overhead     ${formatNum(s.cacheCreationTokens).padStart(14)} tokens   (${usd(s.cacheCreationUSD)})`,
  );
  lines.push("");

  // Trend.
  const dayValues = report.trendDaily.map((d) => d.tokens);
  const spark = sparkline(dayValues, 30);
  const stats = sparklineStats(dayValues);
  lines.push(c.bold(`trend: token spend per day (${report.window.days} days)`));
  lines.push(`  ${c.cyan(spark)}`);
  lines.push(
    c.dim(
      `  min: ${humanTokens(stats.min)}  ·  max: ${humanTokens(stats.max)}  ·  median: ${humanTokens(Math.round(stats.median))}`,
    ),
  );
  lines.push("");

  // Top expensive.
  if (report.topExpensive.length > 0) {
    lines.push(c.bold(`top ${report.topExpensive.length} most expensive sessions:`));
    let rank = 1;
    for (const t of report.topExpensive) {
      const date = t.startedAt.slice(0, 10);
      const lbl = t.label ? ` · ${t.label}` : "";
      lines.push(
        `  ${rank}. ${date} · ${c.cyan(t.sessionIdShort)} · ${t.durationHuman} · ${formatNum(t.tokens)} tok · ${usd(t.estCostUSD)}${lbl}`,
      );
      rank++;
    }
    lines.push("");
  }

  // Projects.
  if (report.byProject.length > 0) {
    const top = report.byProject.slice(0, 3);
    lines.push(c.bold(`projects (top ${top.length} by spend):`));
    for (const p of top) {
      lines.push(
        `  · ${p.name.padEnd(20)} ${c.yellow(`${p.pctOfSpend}%`)} · ${p.sessionCount} sessions · ${usd(p.estCostUSD)}`,
      );
    }
    lines.push("");
  }

  // Group-by view.
  if (report.groupBy === "project") {
    lines.push(c.bold("per-project totals:"));
    for (const p of report.byProject) {
      lines.push(
        `  · ${p.name.padEnd(20)} ${formatNum(p.tokens).padStart(14)} tokens · ${p.sessionCount} sessions · ${usd(p.estCostUSD)}`,
      );
    }
    lines.push("");
  }

  // Footer.
  lines.push(`est. total cost: ${c.bold(usd(report.totals.estCostUSD))}`);
  lines.push(
    c.dim(
      `prices from ${report.metaPricing.asOf} (${report.metaPricing.ageDays} days old)`,
    ),
  );

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push(c.dim(`warnings (${report.warnings.length}):`));
    for (const w of report.warnings.slice(0, 5)) {
      lines.push(c.dim(`  · [${w.code}] ${w.message.split("\n")[0]}`));
    }
  }

  return lines.join("\n");
}
