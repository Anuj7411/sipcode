/**
 * JSON renderer for `sipcode forecast --json` / `forecast_monthly_spend` MCP tool.
 */
import type { ForecastReport } from "./types.js";

export function formatForecastJson(report: ForecastReport): string {
  return JSON.stringify(report, null, 2);
}
