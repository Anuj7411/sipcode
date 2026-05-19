/**
 * Terminal formatter — pure (input: EstimateResult; output: string).
 *
 * Brand voice: lowercase, no emoji, "sip" voice family.
 */
import chalk from "chalk";
import { formatNum } from "../../lib/format.js";
import type { EstimateResult, ModelPrediction } from "./types.js";

interface FormatOptions {
  readonly useColor?: boolean;
  /** When set, render only the row for this model. */
  readonly onlyModel?: string;
}

function makeColors(use: boolean) {
  if (use) {
    return {
      bold: chalk.bold,
      dim: chalk.dim,
      cyan: chalk.cyan,
      magenta: chalk.magenta,
      yellow: chalk.yellow,
      green: chalk.green,
    };
  }
  const id = (s: string) => s;
  return { bold: id, dim: id, cyan: id, magenta: id, yellow: id, green: id };
}

/** Money string with 2-decimal precision (matches the sample output). */
function money(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Short label for a model id — used in the table. */
function modelLabel(m: string): string {
  if (m.includes("opus")) return "opus 4    ";
  if (m.includes("sonnet")) return "sonnet 4  ";
  if (m.includes("haiku")) return "haiku 4   ";
  return m.padEnd(10);
}

function renderRow(p: ModelPrediction): string {
  const center = money(p.costCenter);
  const lo = money(p.costBand[0]);
  const hi = money(p.costBand[1]);
  const tokens = `${formatNum(p.estimatedTokens)} tokens (${formatNum(p.tokenBand[0])} - ${formatNum(p.tokenBand[1])})`;
  return `  ${modelLabel(p.model)} ${center.padStart(7)}  (${lo} - ${hi})    ${tokens}`;
}

export function formatTerminal(
  result: EstimateResult,
  opts: FormatOptions = {},
): string {
  const c = makeColors(opts.useColor ?? false);
  const lines: string[] = [];

  // Header.
  lines.push(
    `${c.bold("sipcode estimate")} ${c.dim("·")} "${result.task}"`,
  );

  const repo = result.repoContext;
  const repoBits: string[] = [];
  repoBits.push(`${formatNum(repo.fileCount)} files`);
  repoBits.push(`framework: ${repo.framework}`);
  if (!repo.manifestPresent) {
    repoBits.push("no manifest");
  }
  lines.push(c.dim(`project context: ${repoBits.join("  ·  ")}`));
  if (repo.fallbackNote) {
    lines.push(c.dim(`(${repo.fallbackNote})`));
  }
  lines.push("");

  // Complexity.
  const cm = result.complexity;
  lines.push(
    `complexity: ${c.bold(cm.tier)} (verb: ${cm.verb}; estimated ${cm.expectedTurns[0]}-${cm.expectedTurns[1]} turns, ${cm.expectedReads[0]}-${cm.expectedReads[1]} reads)`,
  );

  // Anchors.
  const a = result.anchors;
  if (a.skipped) {
    lines.push(
      `historical anchors: skipped (--no-anchors) — ${c.yellow("low confidence")}`,
    );
  } else if (a.matchedCount === 0) {
    lines.push(
      `historical anchors: ${c.yellow("none matched")} — ${c.yellow("low confidence")} (heuristic only)`,
    );
  } else {
    lines.push(
      `historical anchors: ${a.matchedCount} matched (median ${formatNum(a.medianHistoricalTokens)} tokens) — confidence: ${a.confidence}`,
    );
  }
  lines.push("");

  // Predictions table.
  lines.push("estimated cost (0.7×-1.4× confidence band):");
  lines.push("");
  const filtered = opts.onlyModel
    ? result.predictions.filter((p) => p.model.includes(opts.onlyModel!.toLowerCase()))
    : result.predictions;
  if (filtered.length === 0) {
    lines.push(c.dim(`  (no matching model for "${opts.onlyModel}")`));
  } else {
    for (const p of filtered) {
      lines.push(renderRow(p));
    }
  }
  lines.push("");

  // Recommendation.
  const r = result.recommendation;
  const recLabel = modelLabel(r.model).trim();
  lines.push(
    c.bold(
      `${recLabel} — ${r.reason}. ~${money(r.costCenter)}. sip don't gulp.`,
    ),
  );

  if (result.warnings.length > 0) {
    lines.push("");
    for (const w of result.warnings) {
      lines.push(c.dim(`note: ${w}`));
    }
  }

  return lines.join("\n");
}
