/**
 * Duplicate-read analyzer — M007, M008, R003.
 * Pure.
 */
import path from "node:path";
import type { ParsedSession, ToolCall } from "../parse.js";

export interface DuplicateRead {
  readonly filePath: string;
  readonly readCount: number;
  /** Tokens cost of the duplicate reads (all reads beyond the first). */
  readonly duplicateTokenCost: number;
  /** Tokens cost of the first read (baseline, NOT counted as waste). */
  readonly firstReadTokens: number;
}

export interface DuplicateReadsResult {
  /** M007 — distinct files read. */
  readonly distinctFilesRead: number;
  /** M008 — total tokens spent on duplicate reads. */
  readonly duplicateReadTokenCost: number;
  /** R003 — top offenders. */
  readonly topOffenders: ReadonlyArray<DuplicateRead>;
}

/**
 * Normalize a file path so Windows and POSIX styles dedupe.
 * Lowercases drive letters, replaces backslashes, collapses ../ where safe.
 */
function normalizeFilePath(p: string): string {
  let s = p.replace(/\\/g, "/");
  // Lowercase Windows drive letter.
  s = s.replace(/^([A-Z]):/, (_m, d: string) => d.toLowerCase() + ":");
  try {
    s = path.posix.normalize(s);
  } catch {
    /* ignore */
  }
  return s;
}

/**
 * Read-like tools and the field of their input that names the file.
 * (Add new mappings as Claude Code introduces tools — IDs documented in
 * AUDIT-FRAMEWORK; new ones should not break old transcripts.)
 */
const READ_TOOL_FIELDS: Record<string, string> = {
  Read: "file_path",
  read_file: "path",
};

function extractReadPath(call: ToolCall): string | undefined {
  const field = READ_TOOL_FIELDS[call.name];
  if (!field) return undefined;
  const input = call.input as Record<string, unknown> | undefined;
  if (!input || typeof input !== "object") return undefined;
  const v = input[field];
  if (typeof v !== "string" || v.length === 0) return undefined;
  return v;
}

export function analyzeDuplicateReads(
  session: ParsedSession,
): DuplicateReadsResult {
  const readsByPath = new Map<
    string,
    { calls: ToolCall[]; displayPath: string }
  >();

  for (const call of session.toolCalls) {
    const p = extractReadPath(call);
    if (!p) continue;
    const norm = normalizeFilePath(p);
    const existing = readsByPath.get(norm);
    if (existing) existing.calls.push(call);
    else readsByPath.set(norm, { calls: [call], displayPath: p });
  }

  const distinctFilesRead = readsByPath.size;
  const duplicates: DuplicateRead[] = [];
  let totalDupCost = 0;

  for (const { calls, displayPath } of readsByPath.values()) {
    if (calls.length < 2) continue;
    // For dup cost, estimate ~ per-call cache_creation+input cost of subsequent reads.
    // Use average per-read non-output token cost as the per-read estimate.
    const perRead = calls.map(
      (c) => c.inputTokens + c.cacheCreationTokens + c.cacheReadTokens,
    );
    const first = perRead[0] ?? 0;
    const rest = perRead.slice(1);
    const dupCost = rest.reduce((a, b) => a + b, 0);
    totalDupCost += dupCost;
    duplicates.push({
      filePath: displayPath,
      readCount: calls.length,
      duplicateTokenCost: dupCost,
      firstReadTokens: first,
    });
  }

  duplicates.sort((a, b) => b.duplicateTokenCost - a.duplicateTokenCost);

  return {
    distinctFilesRead,
    duplicateReadTokenCost: totalDupCost,
    topOffenders: duplicates.slice(0, 10),
  };
}
