/**
 * Terminal formatter — colored output for a human reader.
 * Pure (in: RenderedReport; out: string).
 *
 * Color is opt-out via the `useColor` flag (CLI passes `process.stdout.isTTY`
 * and respects NO_COLOR). Order: savings first, totals later.
 */
import chalk from "chalk";
import { formatNum, formatUSD } from "../../lib/format.js";
import type { RenderedReport } from "./render.js";

interface FormatOptions {
  readonly useColor: boolean;
  readonly verbose: boolean;
}

export function formatTerminal(
  report: RenderedReport,
  opts: FormatOptions = { useColor: true, verbose: false },
): string {
  const c = makeColors(opts.useColor);
  const lines: string[] = [];

  // Header.
  lines.push(
    `${c.bold("sipcode why")} ${c.dim("·")} session ${c.cyan(report.header.sessionIdShort)} ${c.dim("·")} ${report.header.durationHuman} ${c.dim("·")} ${c.magenta(report.header.model)}`,
  );
  if (report.header.projectHash) {
    lines.push(c.dim(`project: ${report.header.projectHash}`));
  }
  lines.push("");

  // Punchline.
  lines.push(report.punchline.oneLiner);
  lines.push(
    `output ratio: ${c.yellow(`${report.punchline.outputRatioPct}%`)} of all tokens`,
  );
  lines.push("");

  // Savings (LEAD with this).
  const saved = report.estimatedSavings.totalTokens;
  lines.push(
    c.bold(
      `if sipcode had been on, you could have saved ~${formatNum(saved)} tokens this session.`,
    ),
  );
  const b = report.estimatedSavings.breakdown;
  lines.push(
    c.dim(
      `  · smart manifest (S001): ${formatNum(b.s001_manifest)} tokens`,
    ),
  );
  lines.push(
    c.dim(
      `  · read-once cache (S030): ${formatNum(b.s030_readOnce)} tokens`,
    ),
  );
  lines.push(
    c.dim(
      `  · diff-output (S021):     ${formatNum(b.s021_diffOutput)} tokens`,
    ),
  );
  lines.push("");

  // Top leaks.
  lines.push(c.bold("top leaks (this session):"));
  if (report.topLeaks.length === 0) {
    lines.push("  · nothing notable. nicely run.");
  } else {
    for (const leak of report.topLeaks) {
      lines.push(
        `  ${leak.rank}. ${c.yellow(leak.title)} — ${formatNum(leak.tokens)} tokens ${c.dim(`(${leak.detail})`)}`,
      );
    }
  }
  lines.push("");

  // Duplicate reads.
  if (report.duplicates.length > 0) {
    lines.push(c.bold("duplicate reads:"));
    for (const d of report.duplicates) {
      lines.push(
        `  · ${d.filePath} ${c.dim(`(${d.reads}× — ${formatNum(d.wastedTokens)} tokens wasted)`)}`,
      );
    }
    lines.push("");
  }

  // Idle context.
  if (report.idle.length > 0) {
    lines.push(c.bold("idle context (files held but not re-referenced):"));
    for (const f of report.idle) {
      lines.push(
        `  · ${f.filePath} ${c.dim(`(idle for ${f.idleTurns} turns — ${formatNum(f.wastedTokens)} tokens)`)}`,
      );
    }
    lines.push("");
  }

  // Top expensive tool calls.
  if (report.topExpensive.length > 0) {
    lines.push(c.bold("most expensive tool calls:"));
    for (const t of report.topExpensive) {
      lines.push(
        `  · ${t.toolName} ${c.dim(`[${t.reason}]`)} — ${formatNum(t.tokens)} tokens ${c.dim(`(${t.label})`)}`,
      );
    }
    lines.push("");
  }

  // Totals (only on --verbose, or always at the bottom).
  if (opts.verbose) {
    const t = report.totals;
    lines.push(c.bold("totals:"));
    lines.push(`  input tokens:           ${formatNum(t.inputTokens)}`);
    lines.push(`  output tokens:          ${formatNum(t.outputTokens)}`);
    lines.push(`  cache read tokens:      ${formatNum(t.cacheReadTokens)}`);
    lines.push(
      `  cache creation tokens:  ${formatNum(t.cacheCreationTokens)}`,
    );
    lines.push(`  total tool calls:       ${formatNum(t.toolCallCount)}`);
    lines.push(`  distinct files read:    ${formatNum(t.distinctFilesRead)}`);
    lines.push(`  est. cost:              $${t.estCostUSD.toFixed(4)}`);
    lines.push("");
  } else {
    lines.push(
      c.dim(
        `est. cost: $${report.totals.estCostUSD.toFixed(4)} · ${report.totals.toolCallCount} tool calls · ${report.totals.distinctFilesRead} distinct files read`,
      ),
    );
    lines.push(c.dim("(pass --verbose for the full breakdown)"));
    lines.push("");
  }

  // Warnings.
  if (report.warnings.length > 0) {
    const shown = report.warnings.slice(0, 5);
    lines.push(c.dim(`warnings (${report.warnings.length}):`));
    for (const w of shown) {
      lines.push(c.dim(`  · [${w.code}] ${w.message}`));
    }
    if (report.warnings.length > shown.length) {
      lines.push(
        c.dim(
          `  · …and ${report.warnings.length - shown.length} more (pass --verbose).`,
        ),
      );
    }
    lines.push("");
  }

  // Pricing meta.
  lines.push(
    c.dim(
      `prices from ${report.metaPricing.asOf} (${report.metaPricing.ageDays} days old)`,
    ),
  );
  lines.push("");

  // Next step.
  lines.push(c.green(report.nextStep));

  return lines.join("\n");
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
    };
  }
  return {
    bold: chalk.bold,
    dim: chalk.dim,
    cyan: chalk.cyan,
    magenta: chalk.magenta,
    yellow: chalk.yellow,
    green: chalk.green,
  };
}
