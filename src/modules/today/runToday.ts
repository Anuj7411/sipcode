/**
 * Pure runner for `sipcode today` / `get_today_summary` MCP tool.
 *
 * Takes a pre-aggregated session list + `now`, returns a TodayReport. No I/O.
 * All four TodayStatus branches handled with structured output — never throws.
 */
import { resolveBaseline } from "../../lib/baseline-window.js";
import type {
  TodayReport,
  TodayBlock,
  TodayBaseline,
  TodayComparison,
  TodayLeak,
} from "./types.js";

/** Shape we accept from upstream. Subset of stats AggregatedSession. */
export interface TodaySession {
  readonly sessionId: string;
  readonly startedAt: string;
  readonly totalTokens: number;
  readonly outputTokens: number;
  readonly estCostUSD: number;
  readonly duplicateReadTokenCost: number;
  /** Optional cost-USD attributed to the top duplicate-read file. */
  readonly topDuplicateReadFile?: { path: string; count: number; costUSD: number } | undefined;
}

export interface RunTodayInput {
  readonly sessions: ReadonlyArray<TodaySession>;
  readonly now: Date;
}

/** Minimum sessions today to render the full headline. */
const MIN_SESSIONS_FOR_OK = 1;

export function runToday(input: RunTodayInput): TodayReport {
  const { sessions, now } = input;

  if (sessions.length === 0) {
    return {
      schemaVersion: "sipcode-today/1",
      status: "no-data",
      today: null,
      baseline: null,
      comparison: null,
      headline:
        "No Claude Code sessions found yet. Run `claude` in any project to start.",
    };
  }

  const todayIso = toLocalDay(now);
  const todaySessions = sessions.filter(
    (s) => toLocalDay(new Date(s.startedAt)) === todayIso,
  );

  // Compute today's block (may be null when no sessions today).
  const todayBlock: TodayBlock | null =
    todaySessions.length >= MIN_SESSIONS_FOR_OK
      ? buildTodayBlock(todayIso, todaySessions)
      : null;

  const baselineResolution = resolveBaseline(
    sessions.map((s) => s.startedAt),
    now,
  );

  // no-data already handled above. From here we either have:
  //  - baseline ok + sessions today  → "ok"
  //  - baseline ok + no sessions today → "no-sessions-today"
  //  - baseline insufficient → "no-baseline" (today rendered if present)
  if (baselineResolution.kind === "insufficient") {
    return {
      schemaVersion: "sipcode-today/1",
      status: "no-baseline",
      today: todayBlock,
      baseline: null,
      comparison: null,
      headline:
        todayBlock !== null
          ? `Showing today only ($${fmtUsd(todayBlock.totalSpendUSD)}). Need 3+ days of history to compute a baseline.`
          : "No sessions today yet. Need 3+ days of history to compute a baseline.",
    };
  }

  const baselineSessions = sessions.filter(
    (s) => s.startedAt.slice(0, 10) >= baselineResolution.window.sliceStartIso,
  );
  const baseline = buildBaseline(baselineResolution.window, baselineSessions);

  if (todayBlock === null) {
    return {
      schemaVersion: "sipcode-today/1",
      status: "no-sessions-today",
      today: null,
      baseline,
      comparison: null,
      headline: `No sessions today yet. Your ${baseline.windowDays}-day median is $${fmtUsd(baseline.medianSpendPerDayUSD)}/day — go build something.`,
    };
  }

  const comparison = buildComparison(todayBlock, baseline);
  const headline = buildHeadline(todayBlock, baseline, comparison);

  return {
    schemaVersion: "sipcode-today/1",
    status: "ok",
    today: todayBlock,
    baseline,
    comparison,
    headline,
  };
}

function buildTodayBlock(
  dateLocal: string,
  todaySessions: ReadonlyArray<TodaySession>,
): TodayBlock {
  let totalSpendUSD = 0;
  let totalTokens = 0;
  let outputTokens = 0;
  let topLeak: TodayLeak | null = null;
  for (const s of todaySessions) {
    totalSpendUSD += s.estCostUSD;
    totalTokens += s.totalTokens;
    outputTokens += s.outputTokens;
    if (
      s.topDuplicateReadFile !== undefined &&
      (topLeak === null || s.topDuplicateReadFile.costUSD > topLeak.costUSD)
    ) {
      topLeak = {
        kind: "duplicate-reads",
        description: `${s.topDuplicateReadFile.count} re-reads of ${shortPath(s.topDuplicateReadFile.path)}`,
        costUSD: s.topDuplicateReadFile.costUSD,
      };
    }
  }
  return {
    dateLocal,
    sessionCount: todaySessions.length,
    totalSpendUSD,
    totalTokens,
    outputRatioPct: totalTokens > 0 ? (outputTokens / totalTokens) * 100 : 0,
    topLeak,
  };
}

function buildBaseline(
  window: { windowDays: number; isPartial: boolean },
  baselineSessions: ReadonlyArray<TodaySession>,
): TodayBaseline {
  const perDay = new Map<string, { spend: number; tokens: number; outRatio: number; sessions: number }>();
  for (const s of baselineSessions) {
    const day = s.startedAt.slice(0, 10);
    const cur = perDay.get(day) ?? { spend: 0, tokens: 0, outRatio: 0, sessions: 0 };
    cur.spend += s.estCostUSD;
    cur.tokens += s.totalTokens;
    cur.outRatio += s.totalTokens > 0 ? s.outputTokens / s.totalTokens : 0;
    cur.sessions += 1;
    perDay.set(day, cur);
  }
  const spendDays: number[] = [];
  const tokenDays: number[] = [];
  const outRatioDays: number[] = [];
  for (const v of perDay.values()) {
    spendDays.push(v.spend);
    tokenDays.push(v.tokens);
    outRatioDays.push((v.outRatio / v.sessions) * 100);
  }
  return {
    windowDays: window.windowDays,
    isPartial: window.isPartial,
    medianSpendPerDayUSD: median(spendDays),
    medianTokensPerDay: median(tokenDays),
    medianOutputRatioPct: median(outRatioDays),
  };
}

function buildComparison(today: TodayBlock, baseline: TodayBaseline): TodayComparison {
  return {
    spendDeltaPct: pctChange(baseline.medianSpendPerDayUSD, today.totalSpendUSD),
    tokenDeltaPct: pctChange(baseline.medianTokensPerDay, today.totalTokens),
    outputRatioDeltaPp: today.outputRatioPct - baseline.medianOutputRatioPct,
  };
}

function buildHeadline(
  today: TodayBlock,
  baseline: TodayBaseline,
  comparison: TodayComparison,
): string {
  const parts: string[] = [];
  const direction = comparison.spendDeltaPct < 0 ? "below" : "above";
  const magnitude = Math.round(Math.abs(comparison.spendDeltaPct));
  parts.push(
    `You've spent $${fmtUsd(today.totalSpendUSD)} today across ${today.sessionCount} session${today.sessionCount === 1 ? "" : "s"} — ${magnitude}% ${direction} your ${baseline.windowDays}-day median.`,
  );
  parts.push(
    `Output ratio ${today.outputRatioPct.toFixed(1)}% (vs ${baseline.medianOutputRatioPct.toFixed(1)}% baseline).`,
  );
  if (today.topLeak !== null) {
    parts.push(
      `Top leak: ${today.topLeak.description} ($${fmtUsd(today.topLeak.costUSD)}).`,
    );
  }
  return parts.join(" ");
}

function toLocalDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2 : (s[mid] ?? 0);
}

function pctChange(base: number, value: number): number {
  if (base === 0) return 0;
  return ((value - base) / base) * 100;
}

function fmtUsd(v: number): string {
  return v.toFixed(2);
}

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts.slice(-2).join("/");
}
