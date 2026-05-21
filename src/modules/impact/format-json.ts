/**
 * JSON rendering for the impact report. Stable shape so downstream tools
 * (the MCP server, scripts, third-party dashboards) can rely on the keys.
 */
import type { ImpactReport } from "./types.js";

export function formatJson(report: ImpactReport): string {
  return JSON.stringify(report, null, 2);
}
