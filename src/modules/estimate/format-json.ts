/**
 * JSON formatter — stable schema, snapshot-tested.
 * Pure.
 */
import type { EstimateResult } from "./types.js";

export function formatJson(result: EstimateResult): string {
  return JSON.stringify(result, null, 2);
}
