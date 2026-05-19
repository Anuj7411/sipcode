/**
 * Terminal formatter for sipcode score. Pure. Optional chalk colors.
 */
import chalk from "chalk";
import { tierStars } from "./tier.js";
import type { ScoreReport } from "./types.js";

interface FormatOptions {
  readonly useColor: boolean;
}

function makeColors(useColor: boolean) {
  if (!useColor) {
    const id = (s: string) => s;
    return { bold: id, dim: id, cyan: id, green: id, yellow: id, red: id };
  }
  return {
    bold: chalk.bold,
    dim: chalk.dim,
    cyan: chalk.cyan,
    green: chalk.green,
    yellow: chalk.yellow,
    red: chalk.red,
  };
}

function bar(score: number, max: number, width = 20): string {
  if (max <= 0) return "─".repeat(width);
  const filled = Math.round((score / max) * width);
  const cap = Math.max(0, Math.min(width, filled));
  return "●".repeat(cap) + "○".repeat(width - cap);
}

function tint(
  c: ReturnType<typeof makeColors>,
  tier: ScoreReport["tier"],
): (s: string) => string {
  switch (tier) {
    case "platinum":
    case "gold":
      return c.green;
    case "silver":
      return c.cyan;
    case "bronze":
      return c.yellow;
    case "needs-work":
      return c.red;
  }
}

export function formatTerminal(
  report: ScoreReport,
  opts: FormatOptions = { useColor: false },
): string {
  const c = makeColors(opts.useColor);
  const tier = tint(c, report.tier);
  const out: string[] = [];
  out.push(
    `${c.bold("sipcode score")} ${c.dim("·")} ${report.project.name} ${c.dim(`· ${report.project.filesScanned} files`)}`,
  );
  out.push("");
  out.push(
    `score: ${c.bold(`${report.score} / 100`)} — ${tier(`${report.tier} ${tierStars(report.tier)}`)}`,
  );
  out.push("");
  // Category bars.
  for (const cat of report.categories) {
    const label = `${cat.id}. ${cat.name}`.padEnd(28, " ");
    const nums = `${cat.score} / ${cat.max}`.padStart(7, " ");
    out.push(`${label}${nums}  ${bar(cat.score, cat.max)}`);
  }
  out.push("");

  // Recommendations.
  if (report.recommendations.length === 0) {
    out.push(c.green("nothing to fix — every check passing. you're already there."));
  } else {
    const verb =
      report.tier === "platinum"
        ? "marginal wins available"
        : report.tier === "gold"
          ? "what would push you to platinum"
          : report.tier === "silver"
            ? "what would push you to gold"
            : report.tier === "bronze"
              ? "what would push you to silver"
              : "what would push you out of needs-work";
    out.push(`${verb}:`);
    for (const r of report.recommendations.slice(0, 8)) {
      out.push(`  · ${r}`);
    }
    if (report.recommendations.length > 8) {
      out.push(c.dim(`  · ...and ${report.recommendations.length - 8} more (see --json)`));
    }
  }
  out.push("");
  out.push(
    c.dim(
      "want a badge? run `sipcode score --badge` to emit shields.io-compatible json.",
    ),
  );
  return out.join("\n");
}
