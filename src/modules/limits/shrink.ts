/**
 * How many tokens 1% of a limit bought, per finished period, with a cautious
 * "possible limit cut" flag. Pure.
 *
 * A period is comparable when it finished (its reset time is before the
 * newest reading), started inside --since, had at least 20% used, and at
 * least 90% of its tokens came from one model, which names the period.
 * Tokens per 1% = tokens of the period's requests ÷ percent used.
 * A period is flagged when its tokens per 1% is at most half the median of at
 * least two earlier comparable periods of the same window on the same model.
 * The first flagged period is the possible cut; its factor is that median ÷
 * its tokens per 1%, to one decimal. Usage on other devices raises the percent
 * without local tokens and can look like a cut, so the wording is always
 * "possible".
 */
import { requestsInPeriod, type LimitRequest } from "./attribute.js";
import type { LimitWindow } from "./periods.js";

export const MIN_USED_PERCENT = 20;
export const MIN_MODEL_SHARE = 0.9;
export const MIN_BASELINE_PERIODS = 2;
export const CUT_RATIO = 0.5;

export interface TokensPerPercentPoint {
  readonly model: string;
  /** Period start, epoch ms. */
  readonly periodStart: number;
  readonly tokensPerPercent: number;
}

export interface PossibleCut {
  readonly model: string;
  readonly periodStart: number;
  readonly tokensPerPercent: number;
  readonly baselineMedian: number;
  /** baselineMedian ÷ tokensPerPercent, to one decimal. */
  readonly factor: number;
}

export interface ShrinkSeries {
  /** Comparable periods, oldest first. */
  readonly points: readonly TokensPerPercentPoint[];
  readonly possibleCut: PossibleCut | null;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2 : (s[mid] ?? 0);
}

export function tokensPerPercent(
  window: LimitWindow,
  requests: readonly LimitRequest[],
  opts: { readonly asOf: number; readonly sinceMs: number },
): ShrinkSeries {
  const points: TokensPerPercentPoint[] = [];
  for (const p of window.periods) {
    if (p.resetsAt >= opts.asOf || p.startedAt < opts.sinceMs || p.usedPercent < MIN_USED_PERCENT) continue;
    const byModel = new Map<string, number>();
    let total = 0;
    for (const r of requestsInPeriod(p, requests)) {
      total += r.tokens;
      if (r.model !== undefined) byModel.set(r.model, (byModel.get(r.model) ?? 0) + r.tokens);
    }
    let model: string | undefined;
    let top = 0;
    for (const [m, t] of byModel) {
      if (t > top) {
        model = m;
        top = t;
      }
    }
    if (model === undefined || total === 0 || top / total < MIN_MODEL_SHARE) continue;
    points.push({ model, periodStart: p.startedAt, tokensPerPercent: total / p.usedPercent });
  }
  for (let i = 0; i < points.length; i++) {
    const pt = points[i]!;
    const earlier = points.slice(0, i).filter((q) => q.model === pt.model).map((q) => q.tokensPerPercent);
    if (earlier.length < MIN_BASELINE_PERIODS) continue;
    const base = median(earlier);
    if (pt.tokensPerPercent <= base * CUT_RATIO) {
      return {
        points,
        possibleCut: {
          model: pt.model,
          periodStart: pt.periodStart,
          tokensPerPercent: pt.tokensPerPercent,
          baselineMedian: base,
          factor: Math.round((base / pt.tokensPerPercent) * 10) / 10,
        },
      };
    }
  }
  return { points, possibleCut: null };
}
