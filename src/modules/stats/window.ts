/**
 * --since flag parser. Pure.
 *
 * Accepts:
 *   - durations: "7d", "30d", "90d", "1d"
 *   - keyword: "all"
 *   - ISO date: "2026-04-01"
 *
 * Always returns a StatsWindow anchored to `now` (UTC). For "all", sinceIso
 * is the epoch start so every transcript falls inside the window.
 */
import { issue, type SipcodeIssue } from "../../lib/errors.js";
import { err, ok, type Result } from "../../lib/result.js";
import { MESSAGES } from "../../lib/messages.js";
import type { StatsWindow } from "./types.js";

const DURATION_RE = /^([1-9]\d*)d$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function endOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + MS_PER_DAY,
  );
}

/**
 * Parse a --since flag. Defaults to "30d" when raw is undefined.
 */
export function parseSince(
  raw: string | undefined,
  now: Date,
): Result<StatsWindow, SipcodeIssue> {
  const input = (raw ?? "30d").trim();
  if (input.length === 0) {
    return err(issue("E010", MESSAGES.statsBadSince(raw ?? "")));
  }

  const until = endOfUtcDay(now);
  const untilIso = until.toISOString();

  if (input === "all") {
    // Use epoch as the lower bound — practical "all-time".
    const sinceIso = new Date(0).toISOString();
    const days = Math.max(
      1,
      Math.round((until.getTime() - 0) / MS_PER_DAY),
    );
    return ok({ sinceIso, untilIso, days, raw: "all" });
  }

  const dur = input.match(DURATION_RE);
  if (dur && dur[1]) {
    const n = Number.parseInt(dur[1], 10);
    if (!Number.isFinite(n) || n <= 0 || n > 36500) {
      return err(issue("E010", MESSAGES.statsBadSince(input)));
    }
    const startToday = startOfUtcDay(now);
    // "7d" means the last 7 days including today; sinceIso = startToday - (n-1)*day.
    const since = new Date(startToday.getTime() - (n - 1) * MS_PER_DAY);
    return ok({
      sinceIso: since.toISOString(),
      untilIso,
      days: n,
      raw: input,
    });
  }

  const iso = input.match(ISO_DATE_RE);
  if (iso) {
    const since = new Date(`${input}T00:00:00.000Z`);
    if (Number.isNaN(since.getTime())) {
      return err(issue("E010", MESSAGES.statsBadSince(input)));
    }
    if (since.getTime() > until.getTime()) {
      return err(issue("E010", MESSAGES.statsBadSince(input)));
    }
    const days = Math.max(
      1,
      Math.round((until.getTime() - since.getTime()) / MS_PER_DAY),
    );
    return ok({
      sinceIso: since.toISOString(),
      untilIso,
      days,
      raw: input,
    });
  }

  return err(issue("E010", MESSAGES.statsBadSince(input)));
}

/** True if the given ISO timestamp falls inside [sinceIso, untilIso). */
export function isInWindow(window: StatsWindow, iso: string): boolean {
  return iso >= window.sinceIso && iso < window.untilIso;
}

/**
 * Enumerate every day in the window as YYYY-MM-DD. Capped at 366 days to
 * keep "all" reasonable; longer windows are downsampled in trend rendering.
 */
export function enumerateDays(window: StatsWindow): string[] {
  const cap = 366;
  const since = new Date(window.sinceIso);
  const until = new Date(window.untilIso);
  const rawSpan = Math.max(
    1,
    Math.round((until.getTime() - since.getTime()) / MS_PER_DAY),
  );
  const totalDays = Math.min(cap, rawSpan);
  // When span > cap (e.g. "all"), anchor to the most-recent N days so the
  // sparkline reflects the immediate past.
  const startMs =
    rawSpan > cap
      ? until.getTime() - totalDays * MS_PER_DAY
      : since.getTime();
  const days: string[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startMs + i * MS_PER_DAY);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}
