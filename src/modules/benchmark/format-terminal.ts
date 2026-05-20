/**
 * Terminal formatter for `sipcode benchmark`. Pure. chalk only when useColor.
 */
import chalk from "chalk";
import { formatNum } from "../../lib/format.js";
import type { RenderedBenchmark } from "./render.js";

interface FormatOptions {
  readonly useColor: boolean;
}

function makeColors(useColor: boolean) {
  if (!useColor) {
    const id = (s: string) => s;
    return { bold: id, dim: id, cyan: id, magenta: id, yellow: id, green: id, red: id };
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
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function bar(pctVal: number, width = 24): string {
  const clamped = Math.max(0, Math.min(100, pctVal));
  const filled = Math.round((clamped / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function formatTerminal(
  report: RenderedBenchmark,
  opts: FormatOptions = { useColor: true },
): string {
  const c = makeColors(opts.useColor);
  const lines: string[] = [];

  lines.push(
    `${c.bold("sipcode benchmark")} ${c.dim("·")} ${c.cyan(`${report.taskCount} tasks`)} ${c.dim("·")} corpus v${report.corpusVersion}`,
  );
  lines.push("");

  // Headline
  lines.push(
    `${c.bold(c.green(pct(report.headline.medianSavingsPct)))} ${c.dim("median savings")} ${c.dim("·")} range ${pct(report.headline.minSavingsPct)} – ${pct(report.headline.maxSavingsPct)}`,
  );
  lines.push(`  ${c.dim(report.headline.oneLiner)}`);
  lines.push("");
  lines.push(
    `total saved: ${c.yellow(formatNum(report.headline.totalSavingsTokens))} tokens ${c.dim("·")} ${c.green(usd(report.headline.totalSavingsUSD))}`,
  );
  lines.push("");

  // Per-task table.
  lines.push(c.bold("per-task results"));
  lines.push(c.dim("id     savings  bar                       baseline   optimized  saved"));
  for (const t of report.tasks) {
    const id = t.id.padEnd(6);
    const pctStr = pct(t.savingsPct).padStart(6);
    const barStr = bar(t.savingsPct);
    const base = formatNum(t.baselineTokens).padStart(10);
    const opt = formatNum(t.optimizedTokens).padStart(10);
    const usdStr = usd(t.savingsUSD).padStart(8);
    lines.push(`${c.cyan(id)} ${c.green(pctStr)}  ${barStr}  ${base} ${opt}  ${usdStr}`);
  }
  lines.push("");

  // Attribution.
  lines.push(c.bold("where the savings came from"));
  lines.push(
    `  S001 smart manifest:        ${formatNum(report.attribution.s001_manifest.tokens).padStart(10)} tokens ${c.dim(`(${pct(report.attribution.s001_manifest.pct)})`)}`,
  );
  lines.push(
    `  S021 output compression:    ${formatNum(report.attribution.s021_outputCompression.tokens).padStart(10)} tokens ${c.dim(`(${pct(report.attribution.s021_outputCompression.pct)})`)}`,
  );
  lines.push(
    `  S030 read-once cache:       ${formatNum(report.attribution.s030_readOnceCache.tokens).padStart(10)} tokens ${c.dim(`(${pct(report.attribution.s030_readOnceCache.pct)})`)}`,
  );
  lines.push("");

  lines.push(
    c.dim(
      `prices from ${report.metaPricing.asOf} (${report.metaPricing.ageDays} days old) · methodology: benchmark/METHODOLOGY.md`,
    ),
  );

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push(c.yellow(`${report.warnings.length} warning(s):`));
    for (const w of report.warnings.slice(0, 5)) {
      lines.push(c.dim(`  [${w.code}] ${w.message}`));
    }
  }

  return lines.join("\n");
}

/**
 * Print just the task list (used by `--list`).
 */
export function formatTaskList(
  tasks: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly category: string;
    readonly difficulty: string;
  }>,
  opts: FormatOptions = { useColor: true },
): string {
  const c = makeColors(opts.useColor);
  const lines: string[] = [];
  lines.push(c.bold("sipcode benchmark — tasks in the locked corpus"));
  lines.push("");
  for (const t of tasks) {
    lines.push(
      `  ${c.cyan(t.id.padEnd(6))} ${c.dim(`[${t.category}/${t.difficulty}]`).padEnd(28)} ${t.title}`,
    );
  }
  lines.push("");
  lines.push(c.dim("methodology + corpus: benchmark/METHODOLOGY.md"));
  return lines.join("\n");
}
