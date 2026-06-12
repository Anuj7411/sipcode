/**
 * Terminal renderer for `sipcode trend`. Pure.
 *
 * Shows: title, plain-language verdict, sparkline, per-day stats footer.
 * No color/emoji in the test path; we add chalk in the command handler.
 */
import { sparkline, sparklineStats } from "../stats/sparkline.js";
import type { TrendResult, TrendMetric, TrendVerdict } from "./compute.js";

export function formatTrendTerminal(result: TrendResult): string {
  const lines: string[] = [];
  const title = metricTitle(result.metric);
  lines.push(`sipcode trend · ${title}`);
  lines.push("");

  const verdictLine = verdictSentence(result.verdict, result.metric, result.slopePerDay);
  lines.push(`  ${verdictLine}`);
  lines.push("");

  const values = result.days.map((d) => d.value);
  const spark = sparkline(values, 30);
  lines.push(`  ${result.window.since} → ${result.window.until}`);
  lines.push(`  ${spark}`);
  const stats = sparklineStats(values);
  lines.push(`  min ${fmtMetric(stats.min, result.metric)} · median ${fmtMetric(stats.median, result.metric)} · max ${fmtMetric(stats.max, result.metric)}`);
  lines.push("");
  lines.push(`  total sessions across window: ${result.days.reduce((a, d) => a + d.sessions, 0)}`);

  return lines.join("\n");
}

function metricTitle(m: TrendMetric): string {
  switch (m) {
    case "output-ratio":
      return "output ratio (output tokens / total tokens, higher = leaner context)";
    case "cost-per-session":
      return "cost per session (USD, lower = better)";
    case "recoverable-tokens-per-session":
      return "recoverable tokens per session (duplicate reads, lower = better)";
  }
}

function verdictSentence(
  verdict: TrendVerdict,
  metric: TrendMetric,
  slopePerDay: number,
): string {
  switch (verdict) {
    case "insufficient-data":
      return "insufficient data — need at least 5 days with sessions to compute a trend.";
    case "stable":
      return "stable — no measurable change in the window.";
    case "improving": {
      const direction = metric === "output-ratio" ? "up" : "down";
      return `improving — trending ${direction} ${fmtSlope(slopePerDay, metric)} per day.`;
    }
    case "regressing": {
      const direction = metric === "output-ratio" ? "down" : "up";
      return `regressing — trending ${direction} ${fmtSlope(slopePerDay, metric)} per day.`;
    }
  }
}

function fmtMetric(v: number, m: TrendMetric): string {
  switch (m) {
    case "output-ratio":
      return `${(v * 100).toFixed(1)}%`;
    case "cost-per-session":
      return `$${v.toFixed(4)}`;
    case "recoverable-tokens-per-session":
      return v.toLocaleString("en-US");
  }
}

function fmtSlope(slope: number, m: TrendMetric): string {
  const abs = Math.abs(slope);
  switch (m) {
    case "output-ratio":
      return `${(abs * 100).toFixed(2)} pp`;
    case "cost-per-session":
      return `$${abs.toFixed(4)}`;
    case "recoverable-tokens-per-session":
      return Math.round(abs).toLocaleString("en-US") + " tokens";
  }
}
