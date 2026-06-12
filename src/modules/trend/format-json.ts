/**
 * JSON renderer for `sipcode trend --json`. Pure.
 *
 * Schema is part of the public contract from v1.6.9 onward. Versioned.
 */
import type { TrendResult } from "./compute.js";

export function formatTrendJson(result: TrendResult): string {
  return JSON.stringify(
    {
      schemaVersion: "sipcode-trend/1",
      metric: result.metric,
      window: result.window,
      verdict: result.verdict,
      median: result.median,
      slopePerDay: result.slopePerDay,
      days: result.days,
    },
    null,
    2,
  );
}
