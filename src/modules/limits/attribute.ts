/**
 * Which requests used a limit period. Pure.
 *
 * Each rise of the period's running maximum is split across the requests made
 * since the previous rise (since the period start for the first one), in
 * proportion to their tokens (input + output; cached input is part of input).
 * Readings that do not raise the maximum do not end that interval: older Codex
 * versions refresh the limit only when a turn starts, so a rise shows on the
 * first reading of the next turn, after the requests that caused it; and at
 * 1% resolution several small requests add up to one step. A rise with no
 * local request since the previous rise is unattributed (Codex on another
 * device or in the cloud, or usage from before these logs). Attributed plus
 * unattributed equals the period's percent exactly (floating sums; rounding is
 * for display only).
 */
import type { LimitPeriod } from "./periods.js";

/** Codex's automatic review requests: shown as one line of their own. */
export const AUTO_REVIEW_MODEL = "codex-auto-review";

export interface LimitRequest {
  /** Request time, epoch ms. */
  readonly at: number;
  readonly sessionId: string;
  /** The session's working folder. */
  readonly cwd: string | undefined;
  readonly model: string | undefined;
  /** Input + output tokens. */
  readonly tokens: number;
}

export interface RequestShare {
  readonly request: LimitRequest;
  /** Percent of the limit this request used (0 when it raised nothing). */
  readonly percent: number;
}

export interface Attribution {
  /** Every request in (period start, newest reading], oldest first. */
  readonly shares: readonly RequestShare[];
  readonly unattributedPercent: number;
}

/** Requests with tokens in (period start, newest reading], oldest first. */
export function requestsInPeriod(period: LimitPeriod, requests: readonly LimitRequest[]): LimitRequest[] {
  return requests
    .filter((r) => r.tokens > 0 && r.at > period.startedAt && r.at <= period.newestAt)
    .sort((a, b) => a.at - b.at);
}

export function attribute(period: LimitPeriod, requests: readonly LimitRequest[]): Attribution {
  const inPeriod = requestsInPeriod(period, requests);
  const percent = new Array<number>(inPeriod.length).fill(0);
  let unattributed = 0;
  let previous = 0;
  let next = 0;
  for (const point of period.points) {
    const rise = point.usedPercent - previous;
    if (rise <= 0) continue;
    previous = point.usedPercent;
    const from = next;
    while (next < inPeriod.length && inPeriod[next]!.at <= point.at) next++;
    let tokens = 0;
    for (let i = from; i < next; i++) tokens += inPeriod[i]!.tokens;
    if (tokens === 0) {
      unattributed += rise;
      continue;
    }
    for (let i = from; i < next; i++) percent[i] = (percent[i] ?? 0) + (rise * inPeriod[i]!.tokens) / tokens;
  }
  return {
    shares: inPeriod.map((request, i) => ({ request, percent: percent[i] ?? 0 })),
    unattributedPercent: unattributed,
  };
}

export interface SessionUse {
  readonly sessionId: string;
  /** Folder name of the session's working folder (never the full path); null when unknown. */
  readonly project: string | null;
  readonly percent: number;
  readonly tokens: number;
}

export interface AutoReviewUse {
  readonly percent: number;
  readonly tokens: number;
  readonly requests: number;
}

export interface UsageSummary {
  /** Highest percent first. */
  readonly sessions: readonly SessionUse[];
  /** codex-auto-review requests as one line; null when they used none of the limit. */
  readonly autoReview: AutoReviewUse | null;
}

/** Last segment of a working folder, in either path style. */
export function folderName(cwd: string | undefined): string | null {
  if (cwd === undefined) return null;
  const parts = cwd.split(/[\\/]+/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? null;
}

/** Per-session totals of the shares `include` keeps (--here); codex-auto-review grouped. */
export function summarizeShares(
  shares: readonly RequestShare[],
  include: (r: LimitRequest) => boolean = () => true,
): UsageSummary {
  const bySession = new Map<string, { project: string | null; percent: number; tokens: number }>();
  let review: AutoReviewUse = { percent: 0, tokens: 0, requests: 0 };
  for (const { request: r, percent } of shares) {
    if (!include(r)) continue;
    if (r.model === AUTO_REVIEW_MODEL) {
      review = { percent: review.percent + percent, tokens: review.tokens + r.tokens, requests: review.requests + 1 };
      continue;
    }
    const s = bySession.get(r.sessionId) ?? { project: folderName(r.cwd), percent: 0, tokens: 0 };
    s.percent += percent;
    s.tokens += r.tokens;
    bySession.set(r.sessionId, s);
  }
  const sessions = [...bySession]
    .map(([sessionId, s]) => ({ sessionId, project: s.project, percent: s.percent, tokens: s.tokens }))
    .sort(
      (a, b) =>
        b.percent - a.percent ||
        b.tokens - a.tokens ||
        (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0),
    );
  return { sessions, autoReview: review.percent > 0 ? review : null };
}
