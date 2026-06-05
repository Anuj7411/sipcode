import type { DriftReport } from "./types.js";

export function renderDriftJson(report: DriftReport): string {
  return JSON.stringify(report, null, 2);
}
