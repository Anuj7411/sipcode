/**
 * Terminal renderers for `sipcode limits` and the `today` limit line. Pure.
 *
 * Times are local. A time within a week of now shows its hour ("Tue 14 Oct
 * 14:00"); a later or earlier one shows the date only ("Sun 2 Nov"). Run-out
 * times are estimates, rounded to the nearest hour and always marked "~"
 * ("~Sat 31 Oct" when only the date shows). In the
 * tokens-per-1% history, labels that share a date in one row also show their
 * local start time ("Jul 5 11:09"), so periods started the same day differ.
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

/** "Mon 13 Oct ~18:00" within a week of now, else "~Mon 13 Oct". */
export function formatApprox(ms: number, now: number): string {
  const d = roundHour(ms);
  return soon(ms, now) ? `${formatDay(d.getTime())} ~${pad2(d.getHours())}:00` : `~${formatDay(d.getTime())}`;
}

/** "just now", "36m ago", "2h ago" (under 48 hours), "3d ago". */
export function formatAgo(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < 48 * HOUR) return `${Math.floor(diff / HOUR)}h ago`;
  return `${Math.floor(diff / DAY)}d ago`;
}

/**
 * Whole percent from 1%. Below 1%: one decimal, cut rather than rounded so
 * 0.96 never reads "1.0%"; below 0.1%, "<0.1%" (a share that is not zero
 * never reads "0.0%").
 */
export function formatPercent(p: number): string {
  if (p >= 1) return `${Math.round(p)}%`;
  if (p <= 0) return "0%";
  if (p < 0.1) return "<0.1%";
  // The small epsilon keeps a value like 0.7 (6.9999… after * 10) at 0.7.
  return `${(Math.floor(p * 10 + 1e-9) / 10).toFixed(1)}%`;
}

/** "3.1M", "425K", "512". */
export function formatTokensCompact(n: number): string {
  if (Math.round(n / 1000) >= 1000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(Math.round(n));
}

const lower = (label: string): string => label.toLowerCase();

/** "Weekly limit"; a limit id other than "codex" is named: "Weekly limit (premium)". */
function limitName(label: string, limitId: string): string {
  return limitId === "codex" ? `${label} limit` : `${label} limit (${limitId})`;
}

/**
 * A limit name with a note in one pair of parentheses: "weekly limit (gpt-5.4)",
 * "weekly limit (premium, gpt-5.4)".
 */
function limitNameWith(label: string, limitId: string, note: string): string {
  return limitId === "codex" ? `${label} limit (${note})` : `${label} limit (${limitId}, ${note})`;
}

function fit(s: string, width: number): string {
  return (s.length > width ? `${s.slice(0, width - 1)}…` : s).padEnd(width);
}

/** A "what used it" line: 34 columns of name, the percent, then tokens when given. */
function useLine(left: string, percent: number, tokens?: number): string {
  const t = tokens === undefined ? "" : `   ${formatTokensCompact(tokens)} tokens`;
  return `  ${left.padEnd(34)} ${formatPercent(percent).padStart(3)}${t}`;
}

/** The name column is 16 wide, or wider so a long name still lines up. */
function windowRow(w: WindowReport, now: number, asOf: number, nameWidth: number): string {
  const name = limitName(w.label, w.limitId).padEnd(nameWidth);
  const used = `${Math.round(w.period.usedPercent)}% used`.padEnd(11);
  const resets = formatWhen(w.period.resetsAt, now);
  const p = w.projection;
  switch (p.kind) {
    case "reset-since":
      // A reset before the newest reading of any window means this window simply has not been
      // reported since; "since your last Codex request" would be wrong there.
      return w.period.resetsAt < asOf
        ? `${name}no readings since it reset (${resets})`
        : `${name}reset since your last Codex request (at ${resets})`;
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
  return ["", `What used your ${limitNameWith(lower(w.label), w.limitId, `since ${formatDay(w.period.startedAt)}`)}`, ...lines];
}

/** One block per model with two or more comparable periods; the alert under the flagged model. */
function shrinkSection(w: WindowReport): string[] {
  const out: string[] = [];
  const models = [...new Set(w.shrink.points.map((p) => p.model))];
  for (const model of models) {
    const points = w.shrink.points.filter((p) => p.model === model);
    if (points.length < 2) continue;
    out.push("", `Tokens per 1% of your ${limitNameWith(lower(w.label), w.limitId, model)}`);
    for (let i = 0; i < points.length; i += 6) {
      const row = points.slice(i, i + 6);
      const days = row.map((p) => formatMonthDay(p.periodStart));
      const labels = row.map((p, j) => {
        const shared = days.filter((d) => d === days[j]).length > 1;
        const name = shared ? `${days[j]} ${clock(new Date(p.periodStart))}` : days[j];
        return `${name}: ${formatTokensCompact(p.tokensPerPercent)}`;
      });
      out.push(`  ${labels.join("   ")}`);
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
  const nameWidth = Math.max(16, ...report.windows.map((w) => limitName(w.label, w.limitId).length + 2));
  const lines = [head, "", ...report.windows.map((w) => windowRow(w, n, report.asOf, nameWidth))];
  for (const w of report.windows) lines.push(...usedBySection(w), ...shrinkSection(w));
  return lines.join("\n");
}

/** "Tue 14:00" within a week of now, else "Sun 2 Nov". */
function shortWhen(ms: number, now: number): string {
  return soon(ms, now) ? `${weekday(new Date(ms))} ${clock(new Date(ms))}` : formatDay(ms);
}

/** "Mon ~18:00" within a week of now, else "~Mon 13 Oct". */
function shortApprox(ms: number, now: number): string {
  const d = roundHour(ms);
  return soon(ms, now) ? `${weekday(d)} ~${pad2(d.getHours())}:00` : `~${formatDay(d.getTime())}`;
}

/** The one line `today` adds for the Codex limit closest to running out. */
export function formatTodayLimitLine(w: TodayWindow, now: Date): string {
  const n = now.getTime();
  const name = `Codex ${limitName(lower(w.label), w.period.limitId)}`;
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
