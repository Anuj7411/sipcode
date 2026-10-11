/**
 * Terminal renderers for `sipcode limits` and the `today` limit line. Pure.
 *
 * Times are local. A time within a week of now shows its hour ("Tue 14 Oct
 * 14:00"); a later or earlier one shows the date only ("Sun 2 Nov"). Run-out
 * times are estimates, rounded to the nearest hour and marked "~".
 */
import { shortSessionId } from "../../lib/session-id.js";
import { AUTO_REVIEW_MODEL } from "./attribute.js";
import type { LimitsReport, TodayWindow, WindowReport } from "./report.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const pad2 = (n: number): string => String(n).padStart(2, "0");
const weekday = (d: Date): string => WEEKDAYS[d.getDay()]!;
const clock = (d: Date): string => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const soon = (ms: number, now: number): boolean => Math.abs(ms - now) < WEEK;

/** The nearest whole local hour. */
function roundHour(ms: number): Date {
  const d = new Date(ms + 30 * MINUTE);
  d.setMinutes(0, 0, 0);
  return d;
}

/** "Tue 7 Oct" */
export function formatDay(ms: number): string {
  const d = new Date(ms);
  return `${weekday(d)} ${d.getDate()} ${MONTHS[d.getMonth()]!}`;
}

/** "Mar 28" */
export function formatMonthDay(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]!} ${d.getDate()}`;
}

/** "Tue 14 Oct 14:00" within a week of now, else "Sun 2 Nov". */
export function formatWhen(ms: number, now: number): string {
  return soon(ms, now) ? `${formatDay(ms)} ${clock(new Date(ms))}` : formatDay(ms);
}

/** "Mon 13 Oct ~18:00" within a week of now, else "Mon 13 Oct". */
export function formatApprox(ms: number, now: number): string {
  const d = roundHour(ms);
  return soon(ms, now) ? `${formatDay(d.getTime())} ~${pad2(d.getHours())}:00` : formatDay(ms);
}

/** "just now", "36m ago", "2h ago" (under 48 hours), "3d ago". */
export function formatAgo(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < 48 * HOUR) return `${Math.floor(diff / HOUR)}h ago`;
  return `${Math.floor(diff / DAY)}d ago`;
}

/** Whole percent; one decimal below 1%. */
export function formatPercent(p: number): string {
  return p < 1 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`;
}

/** "3.1M", "425K", "512". */
export function formatTokensCompact(n: number): string {
  if (Math.round(n / 1000) >= 1000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(Math.round(n));
}

const lower = (label: string): string => label.toLowerCase();

function fit(s: string, width: number): string {
  return (s.length > width ? `${s.slice(0, width - 1)}…` : s).padEnd(width);
}

/** A "what used it" line: 34 columns of name, the percent, then tokens when given. */
function useLine(left: string, percent: number, tokens?: number): string {
  const t = tokens === undefined ? "" : `   ${formatTokensCompact(tokens)} tokens`;
  return `  ${left.padEnd(34)} ${formatPercent(percent).padStart(3)}${t}`;
}

function windowRow(w: WindowReport, now: number): string {
  const name = `${w.label} limit`.padEnd(16);
  const used = `${Math.round(w.period.usedPercent)}% used`.padEnd(11);
  const resets = formatWhen(w.period.resetsAt, now);
  const p = w.projection;
  switch (p.kind) {
    case "reset-since":
      return `${name}reset since your last Codex request (at ${resets})`;
    case "reached":
      return `${name}${used}limit reached, resets ${resets}`;
    case "too-early":
      return `${name}${used}${`resets ${resets}`.padEnd(26)}not enough data yet for a pace`;
    case "lasts":
      return `${name}${used}${`resets ${resets}`.padEnd(26)}at this pace: lasts until reset`;
    case "runs-out":
      return `${name}${used}${`resets ${resets}`.padEnd(26)}at this pace: runs out ${formatApprox(p.at, now)}`;
  }
}

/** Top 5 sessions, the codex-auto-review line, the unattributed line. None for a window that reset since. */
function usedBySection(w: WindowReport): string[] {
  if (w.projection.kind === "reset-since") return [];
  const lines = w.usedBy
    .filter((s) => s.percent > 0)
    .slice(0, 5)
    .map((s) => useLine(`${shortSessionId(s.sessionId, "codex").padEnd(21)}${fit(s.project ?? "", 13)}`, s.percent, s.tokens));
  if (w.autoReview) {
    const n = w.autoReview.requests;
    lines.push(useLine(`${AUTO_REVIEW_MODEL} (${n} request${n === 1 ? "" : "s"})`, w.autoReview.percent));
  }
  if (w.unattributedPercent > 0) {
    lines.push(useLine("unattributed (no Codex requests on this computer)", w.unattributedPercent));
  }
  if (lines.length === 0) return [];
  return ["", `What used your ${lower(w.label)} limit (since ${formatDay(w.period.startedAt)})`, ...lines];
}

/** One block per model with two or more comparable periods; the alert under the flagged model. */
function shrinkSection(w: WindowReport): string[] {
  const out: string[] = [];
  const models = [...new Set(w.shrink.points.map((p) => p.model))];
  for (const model of models) {
    const points = w.shrink.points.filter((p) => p.model === model);
    if (points.length < 2) continue;
    out.push("", `Tokens per 1% of your ${lower(w.label)} limit (${model})`);
    for (let i = 0; i < points.length; i += 6) {
      const row = points.slice(i, i + 6).map((p) => `${formatMonthDay(p.periodStart)}: ${formatTokensCompact(p.tokensPerPercent)}`);
      out.push(`  ${row.join("   ")}`);
    }
    const cut = w.shrink.possibleCut;
    if (cut && cut.model === model) {
      out.push(
        `  Possible limit cut around ${formatMonthDay(cut.periodStart)}: ${cut.factor.toFixed(1)}x fewer tokens per 1%.`,
        "  Limits cover your whole account. Codex use on other devices or in the cloud",
        "  is not in these logs and can look like a cut.",
      );
    }
  }
  return out;
}

export function formatLimitsTerminal(report: LimitsReport, now: Date): string {
  const n = now.getTime();
  const head = [
    "sipcode limits",
    "Codex",
    ...(report.planType ? [`plan: ${report.planType}`] : []),
    `as of ${formatAgo(report.asOf, n)} (your last Codex request)`,
  ].join(" · ");
  const lines = [head, "", ...report.windows.map((w) => windowRow(w, n))];
  for (const w of report.windows) lines.push(...usedBySection(w), ...shrinkSection(w));
  return lines.join("\n");
}

/** "Tue 14:00" within a week of now, else "Sun 2 Nov". */
function shortWhen(ms: number, now: number): string {
  return soon(ms, now) ? `${weekday(new Date(ms))} ${clock(new Date(ms))}` : formatDay(ms);
}

/** "Mon ~18:00" within a week of now, else "Mon 13 Oct". */
function shortApprox(ms: number, now: number): string {
  const d = roundHour(ms);
  return soon(ms, now) ? `${weekday(d)} ~${pad2(d.getHours())}:00` : formatDay(ms);
}

/** The one line `today` adds for the Codex limit closest to running out. */
export function formatTodayLimitLine(w: TodayWindow, now: Date): string {
  const n = now.getTime();
  const name = `Codex ${lower(w.label)} limit`;
  const resets = shortWhen(w.period.resetsAt, n);
  const used = `${Math.round(w.period.usedPercent)}% used`;
  const p = w.projection;
  switch (p.kind) {
    case "reached":
      return `${name}: limit reached, resets ${resets}.`;
    case "runs-out":
      return `${name}: ${used}, resets ${resets}. At this pace you run out ${shortApprox(p.at, n)}.`;
    case "lasts":
      return `${name}: ${used}, resets ${resets}. At this pace it lasts until the reset.`;
    case "too-early":
      return `${name}: ${used}, resets ${resets}. Not enough data yet for a pace.`;
    case "reset-since":
      return `${name}: reset since your last Codex request.`;
  }
}
