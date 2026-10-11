/**
 * Usage-limit readings from a Codex rollout. Pure.
 *
 * Codex writes `payload.rate_limits` on its `event_msg` / `token_count`
 * lines: { limit_id, plan_type, primary, secondary, ... }, each window
 * { used_percent, window_minutes, resets_at (epoch seconds) } or null.
 * One reading per non-null window. Only lines containing "rate_limits" are
 * parsed. A null rate_limits or a null window is skipped quietly (Codex
 * writes them; they are not errors). A line that does not parse, a reading
 * without a timestamp, or a window with a missing or invalid number is
 * skipped and counted in `malformed`. Unknown fields are ignored.
 * A resets_at above 1e12 is already in milliseconds (epoch seconds stay
 * below that until the year 33658) and is taken as is.
 */
export type LimitSlot = "primary" | "secondary";

export interface LimitReading {
  /** Time of the log line, epoch ms. */
  readonly at: number;
  readonly sessionId: string;
  /** `limit_id` ("codex", "premium", ...); "codex" when the line has none. */
  readonly limitId: string;
  readonly planType: string | undefined;
  readonly windowMinutes: number;
  readonly slot: LimitSlot;
  /** Percent used (Codex reports whole numbers). */
  readonly usedPercent: number;
  /** When the window resets, epoch ms. */
  readonly resetsAt: number;
}

export interface RateLimitScan {
  readonly readings: LimitReading[];
  /** Lines or windows that could not be read (skipped). */
  readonly malformed: number;
}

const SLOTS: readonly LimitSlot[] = ["primary", "secondary"];

/** Above this a resets_at is epoch milliseconds, not seconds. */
const MS_THRESHOLD = 1e12;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

export function scanCodexRateLimits(content: string, meta: { readonly sessionId: string }): RateLimitScan {
  const readings: LimitReading[] = [];
  let malformed = 0;
  for (const raw of content.split(/\r?\n/)) {
    if (!raw.includes('"rate_limits"')) continue;
    let line: unknown;
    try {
      line = JSON.parse(raw);
    } catch {
      malformed++;
      continue;
    }
    if (!isObject(line)) {
      malformed++;
      continue;
    }
    const payload = line.payload;
    if (line.type !== "event_msg" || !isObject(payload) || payload.type !== "token_count") continue;
    const limits = payload.rate_limits;
    if (limits === null || limits === undefined) continue;
    const at = typeof line.timestamp === "string" ? Date.parse(line.timestamp) : Number.NaN;
    if (!isObject(limits) || !Number.isFinite(at)) {
      malformed++;
      continue;
    }
    for (const slot of SLOTS) {
      const w = limits[slot];
      if (w === null || w === undefined) continue;
      const used = isObject(w) ? w.used_percent : undefined;
      const minutes = isObject(w) ? w.window_minutes : undefined;
      const resets = isObject(w) ? w.resets_at : undefined;
      if (!isNum(used) || used < 0 || !isNum(minutes) || minutes <= 0 || !isNum(resets) || resets <= 0) {
        malformed++;
        continue;
      }
      readings.push({
        at,
        sessionId: meta.sessionId,
        limitId: text(limits.limit_id) ?? "codex",
        planType: text(limits.plan_type),
        windowMinutes: minutes,
        slot,
        usedPercent: used,
        resetsAt: resets > MS_THRESHOLD ? resets : resets * 1000,
      });
    }
  }
  return { readings, malformed };
}
