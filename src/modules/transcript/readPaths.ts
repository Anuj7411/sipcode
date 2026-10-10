/**
 * Read-tool path extraction. Pure.
 *
 * Shared by the duplicate-read analyzer and cross-session dedupe so core
 * transcript code does not depend on analyzers.
 */
import type { ToolCall } from "./parse.js";

/**
 * Read-like tools and the field of their input that names the file.
 * (Add new mappings as agents introduce tools — IDs documented in
 * AUDIT-FRAMEWORK; new ones should not break old transcripts.)
 */
export const READ_TOOL_FIELDS: Record<string, string> = {
  Read: "file_path",
  read_file: "path",
};

export function extractReadPath(call: ToolCall): string | undefined {
  const field = READ_TOOL_FIELDS[call.name];
  if (!field) return undefined;
  const input = call.input as Record<string, unknown> | undefined;
  if (!input || typeof input !== "object") return undefined;
  const v = input[field];
  if (typeof v !== "string" || v.length === 0) return undefined;
  return v;
}
