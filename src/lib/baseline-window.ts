/**
 * Adaptive baseline window resolver — shared by `today` and `forecast`.
 *
 * Strategy: cascade 30→14→7→3 days. Each tier requires at least that many
 * days of available history (where "available" = (now - earliestSession) ≥
 * tier). If none of the tiers match, return "insufficient".
 *
 * Pure — takes a list of session-start ISO timestamps + `now`, returns the
 * resolved window. No I/O.
 */

export interface BaselineWindow {
  readonly windowDays: number;
  readonly isPartial: boolean;
  /** Human-readable, e.g. "last 30 days" or "last 12 days (all you have so far)". */
  readonly label: string;
  /** ISO date (YYYY-MM-DD) at the start of the window, inclusive. */
  readonly sliceStartIso: string;
}

export type BaselineResolution =
  | { kind: "ok"; window: BaselineWindow }
  | { kind: "insufficient"; daysAvailable: number };

const TIERS: readonly number[] = [30, 14, 7, 3];

/** Minimum days of history to consider ANY baseline. */
export const MIN_DAYS_FOR_BASELINE = 3;

/**
 * Resolve the best baseline window for the given session history.
 *
 * @param sessionStarts ISO timestamps of session start. Order doesn't matter.
 * @param now wall-clock used to compute "how many days of history."
 */
export function resolveBaseline(
  sessionStarts: ReadonlyArray<string>,
  now: Date,
): BaselineResolution {
  if (sessionStarts.length === 0) return { kind: "insufficient", daysAvailable: 0 };

  let earliestMs = Infinity;
  for (const iso of sessionStarts) {
    const t = Date.parse(iso);
    if (Number.isFinite(t) && t < earliestMs) earliestMs = t;
  }
  if (!Number.isFinite(earliestMs)) {
    return { kind: "insufficient", daysAvailable: 0 };
  }
  const daysAvailable = Math.floor((now.getTime() - earliestMs) / 86_400_000);
  if (daysAvailable < MIN_DAYS_FOR_BASELINE) {
    return { kind: "insufficient", daysAvailable };
  }

  for (const tier of TIERS) {
    if (daysAvailable >= tier) {
      const isPartial = tier < 30 && daysAvailable < 30;
      const label = isPartial
        ? `last ${tier} days (all you have so far)`
        : `last ${tier} days`;
      const sliceStartIso = toIsoDay(now.getTime() - tier * 86_400_000);
      return {
        kind: "ok",
        window: { windowDays: tier, isPartial, label, sliceStartIso },
      };
    }
  }
  return { kind: "insufficient", daysAvailable };
}

function toIsoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
