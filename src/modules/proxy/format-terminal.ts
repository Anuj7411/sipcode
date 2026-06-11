/** Terminal renderer for `sipcode proxy --stats`. Pure. */
import type { ProxyReport } from "./types.js";

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function pct(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function band(score: number): string {
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "med";
  return "low";
}

export function renderProxyReport(report: ProxyReport): string {
  const lines: string[] = [];
  lines.push("Sipcode proxy — rewrite stats");
  lines.push(`  total rewrites:     ${fmt(report.totalInvocations)}`);
  lines.push(`  est. tokens saved:  ~${fmt(report.estimatedSavedTokens)} (heuristic)`);
  if (typeof report.weightedAvgIntegrityScore === "number") {
    const s = report.weightedAvgIntegrityScore;
    lines.push(
      `  signal kept:        ${pct(s)} (${band(s)}) — weighted across all rewrites`,
    );
  }

  const names = Object.keys(report.perRewriter).sort();
  if (names.length === 0) {
    lines.push("");
    lines.push("  No rewrites recorded yet. Install with `sipcode proxy --install`,");
    lines.push("  then use Claude Code — stats accumulate as the hook fires.");
  } else {
    lines.push("  per rewriter:");
    for (const name of names) {
      const r = report.perRewriter[name]!;
      const integ =
        typeof r.avgIntegrityScore === "number"
          ? `  ${pct(r.avgIntegrityScore).padStart(4)} kept`
          : "";
      lines.push(
        `    ${name.padEnd(14)} ${String(r.invocations).padStart(5)}  ~${fmt(r.estimatedSavedTokens).padStart(7)}${integ}`,
      );
    }
  }

  lines.push("");
  lines.push(`  ${report.note}`);
  if (typeof report.weightedAvgIntegrityScore === "number") {
    lines.push(
      `  Integrity = est. fraction of original signal kept. Low values flag aggressive rewrites — run \`sipcode why\` if something looks missing.`,
    );
  }
  return lines.join("\n");
}
