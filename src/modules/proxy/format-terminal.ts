/** Terminal renderer for `sipcode proxy --stats`. Pure. */
import type { ProxyReport } from "./types.js";

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function renderProxyReport(report: ProxyReport): string {
  const lines: string[] = [];
  lines.push("Sipcode proxy — rewrite stats");
  lines.push(`  total rewrites:     ${fmt(report.totalInvocations)}`);
  lines.push(`  est. tokens saved:  ~${fmt(report.estimatedSavedTokens)} (heuristic)`);

  const names = Object.keys(report.perRewriter).sort();
  if (names.length === 0) {
    lines.push("");
    lines.push("  No rewrites recorded yet. Install with `sipcode proxy --install`,");
    lines.push("  then use Claude Code — stats accumulate as the hook fires.");
  } else {
    lines.push("  per rewriter:");
    for (const name of names) {
      const r = report.perRewriter[name]!;
      lines.push(
        `    ${name.padEnd(14)} ${String(r.invocations).padStart(5)}  ~${fmt(r.estimatedSavedTokens)}`,
      );
    }
  }

  lines.push("");
  lines.push(`  ${report.note}`);
  return lines.join("\n");
}
