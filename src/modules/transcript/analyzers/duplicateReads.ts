/**
 * Duplicate-read analyzer — M007, M008, R003.
 * Pure.
 *
 * v1.6.14: the path normalizer used to live here as a private function. It
 * was extracted to `src/lib/path-normalize.ts` because hookReadDedup,
 * vsRtk's heuristic walker, and topExpensive ALL had divergent path-keying
 * code that undercounted dupes vs what this analyzer correctly counted.
 * Single source of truth now.
 */
import type { ParsedSession, ToolCall } from "../parse.js";
import { normalizeFilePath } from "../../../lib/path-normalize.js";

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

// normalizeFilePath now lives in src/lib/path-normalize.ts (imported above).
// Used to be a private function here; was duplicated and divergent across
// hookReadDedup, vsRtk, topExpensive before v1.6.14 — see header comment.

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
