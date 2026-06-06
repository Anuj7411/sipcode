import type { DriftReport, DriftCause } from "./types.js";

function renderCause(c: DriftCause): string {
  const arrow = c.direction === "up" ? "▲" : "▼";
  return [
    `  ${arrow} ${c.metric} — ${c.changeDisplay}`,
    `      your norm: ${c.baselineDisplay}   →   this session: ${c.latestDisplay}`,
    `      ${c.meaning}`,
    `      → Fix: ${c.fix}`,
  ].join("\n");
}

export function renderDriftTerminal(report: DriftReport): string {
  // Calm path (stable / not-enough-data) — echo the summary, which already
  // carries the right keyword. A ✓ keeps it visually distinct from the alarm.
  if (!report.hasRegression) {
    return `✓ Sipcode drift: ${report.summary}`;
  }

  const n = report.causes.length;
  const baselineN = report.baseline?.count ?? "your last few";
  const lines: string[] = [
    "⚠  Context drift detected in your latest Claude Code session",
    "",
    "What this means: your newest session is behaving differently from your",
    "recent norm — in ways that waste tokens and can make Claude less reliable.",
    '(This is "context rot": answer quality drops as context gets bloated or stale.)',
    "",
    `Signal${n === 1 ? "" : "s"} that regressed (${n}):`,
    "",
    report.causes.map(renderCause).join("\n\n"),
    "",
    `How this was measured: your latest session vs the median of your last ${baselineN} sessions.`,
    "Conservative by design — it stays silent unless something really moved.",
    "Run `sipcode why` for a per-session forensic breakdown.",
  ];
  return lines.join("\n");
}
