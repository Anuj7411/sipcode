/**
 * Terminal rendering for the impact report. Pure: takes ImpactReport,
 * returns a string. Deterministic — same input always produces the same
 * output, so snapshot tests are stable.
 */
import type { ImpactBucket, ImpactDelta, ImpactReport } from "./types.js";

function dim(s: string): string {
  return s;
}

function trendArrow(deltaPct: number): string {
  if (deltaPct < -0.05) return "↓";
  if (deltaPct > 0.05) return "↑";
  return "—";
}

function fmtUSD(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function fmtUSDPlain(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n === 0) return "0";
  if (Math.abs(n) < 1000) return n.toString();
  if (Math.abs(n) < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function fmtDate(iso: string): string {
  // YYYY-MM-DD slice keeps the rendering locale-stable.
  return iso.slice(0, 10);
}

function row(label: string, before: string, after: string, delta: string): string {
  return `${label.padEnd(22)}${before.padStart(16)}${after.padStart(16)}${delta.padStart(20)}`;
}

function renderHeader(report: ImpactReport): string {
  const lines: string[] = [];
  lines.push("sipcode impact · before vs after the optimizer kicked in");
  lines.push("─".repeat(74));
  if (report.installedAtIso) {
    lines.push(
      dim(
        `pivot: ${fmtDate(report.installedAtIso)} (${report.markerSource})`,
      ),
    );
    lines.push("");
  }
  return lines.join("\n");
}

function pct(numer: number, denom: number): number {
  if (denom === 0) return 0;
  return Math.round((numer / denom) * 1000) / 10;
}

function renderBucketTable(
  before: ImpactBucket,
  after: ImpactBucket,
  delta: ImpactDelta,
): string {
  const lines: string[] = [];
  lines.push(row("", "BEFORE", "AFTER", "Δ"));
  lines.push("─".repeat(74));
  lines.push(
    row(
      "sessions",
      before.sessionCount.toString(),
      after.sessionCount.toString(),
      delta.sessionCountDelta > 0
        ? `+${delta.sessionCountDelta}`
        : delta.sessionCountDelta.toString(),
    ),
  );
  // Tokens first — the canonical unit of work, $ is downstream.
  lines.push(
    row(
      "total tokens",
      fmtTokens(before.totalTokens),
      fmtTokens(after.totalTokens),
      `${fmtTokens(delta.tokenDeltaAbs)}  (${Math.abs(delta.tokenDeltaPct).toFixed(1)}% ${trendArrow(delta.tokenDeltaPct)})`,
    ),
  );
  const avgTokenDelta = after.avgTokensPerSession - before.avgTokensPerSession;
  const avgTokenDeltaPct = pct(avgTokenDelta, before.avgTokensPerSession);
  lines.push(
    row(
      "avg tokens / session",
      fmtTokens(before.avgTokensPerSession),
      fmtTokens(after.avgTokensPerSession),
      `${fmtTokens(avgTokenDelta)}  (${Math.abs(avgTokenDeltaPct).toFixed(1)}% ${trendArrow(avgTokenDeltaPct)})`,
    ),
  );
  lines.push(
    row(
      "total spend",
      fmtUSDPlain(before.estCostUSD),
      fmtUSDPlain(after.estCostUSD),
      `${fmtUSD(delta.costDeltaAbsUSD)}  (${Math.abs(delta.costDeltaPct).toFixed(1)}% ${trendArrow(delta.costDeltaPct)})`,
    ),
  );
  lines.push(
    row(
      "avg $ / session",
      fmtUSDPlain(before.avgCostPerSessionUSD),
      fmtUSDPlain(after.avgCostPerSessionUSD),
      `${fmtUSD(delta.avgCostPerSessionDeltaUSD)}  (${Math.abs(delta.avgCostPerSessionDeltaPct).toFixed(1)}% ${trendArrow(delta.avgCostPerSessionDeltaPct)})`,
    ),
  );
  lines.push(
    row(
      "output ratio",
      `${before.outputRatioPct.toFixed(1)}%`,
      `${after.outputRatioPct.toFixed(1)}%`,
      `${delta.outputRatioDeltaPp >= 0 ? "+" : ""}${delta.outputRatioDeltaPp.toFixed(1)}pp ${trendArrow(delta.outputRatioDeltaPp)}`,
    ),
  );
  lines.push("─".repeat(74));
  return lines.join("\n");
}

function renderHeadline(report: ImpactReport): string {
  return `\n${report.headline}\n`;
}

function renderNotes(report: ImpactReport): string {
  if (report.notes.length === 0) return "";
  return "\n" + report.notes.map((n) => `  • ${n}`).join("\n") + "\n";
}

function renderAllTimeBlock(allTime: ImpactBucket): string {
  // Surface the user's total session count + total cost when no marker
  // exists. Closes the "0 sessions in both windows" UX confusion.
  const lines: string[] = [];
  lines.push("all-time totals (across every Claude Code session on disk):");
  lines.push("─".repeat(74));
  lines.push(`  sessions:       ${allTime.sessionCount}`);
  lines.push(`  total tokens:   ${fmtTokens(allTime.totalTokens)}`);
  lines.push(`  total spend:    ${fmtUSDPlain(allTime.estCostUSD)}`);
  lines.push(`  output ratio:   ${allTime.outputRatioPct.toFixed(1)}%`);
  lines.push("─".repeat(74));
  lines.push("(no install marker = no before/after split possible)");
  return lines.join("\n");
}

export function formatTerminal(report: ImpactReport): string {
  const parts = [renderHeader(report)];
  if (
    report.status === "no-install-marker"
    || report.status === "no-baseline"
    || report.status === "no-post-sessions"
    || report.status === "insufficient-post-data"
  ) {
    // Show the all-time bucket when available (no-install-marker case)
    // so the user sees their data even when no comparison is possible.
    if (report.allTime !== null && report.allTime.sessionCount > 0) {
      parts.push(renderAllTimeBlock(report.allTime));
    }
    parts.push(renderHeadline(report));
    parts.push(renderNotes(report));
    return parts.filter((p) => p.length > 0).join("\n");
  }

  // status === "measured" implies delta is non-null per the runImpact
  // contract — see types.ts. Assert here so TypeScript narrows correctly.
  if (report.delta === null) {
    // Defensive: status was "measured" but delta is null — runImpact bug.
    parts.push(renderHeadline(report));
    parts.push(renderNotes(report));
    return parts.filter((p) => p.length > 0).join("\n");
  }
  parts.push(renderBucketTable(report.before, report.after, report.delta));
  parts.push(renderHeadline(report));
  parts.push(renderNotes(report));
  return parts.filter((p) => p.length > 0).join("\n");
}
