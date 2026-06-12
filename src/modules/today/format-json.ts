/**
 * JSON renderer for `sipcode today --json` / `get_today_summary` MCP tool. Pure.
 *
 * The schema is the public contract from v1.6.10+. Pinned schemaVersion.
 */
import type { TodayReport } from "./types.js";

export function formatTodayJson(report: TodayReport): string {
  return JSON.stringify(report, null, 2);
}
