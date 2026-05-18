/**
 * JSON formatter — stable shape, snapshot-tested.
 * Pure.
 */
import type { RenderedReport } from "./render.js";

export function formatJson(report: RenderedReport): string {
  return JSON.stringify(report, null, 2);
}
