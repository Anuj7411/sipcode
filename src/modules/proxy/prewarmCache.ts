/**
 * Verified Warm-Fill for the per-session read cache.
 *
 * Problem this solves: when a user installs Sipcode mid-session, the dedup
 * cache starts empty. Re-reads of files Claude already read pre-install can't
 * be deduped because the hook has no historical sha to compare against. Drift
 * sees the waste (it walks the whole transcript); proxy --stats does not.
 * Result: drift and proxy disagree by 1-2 orders of magnitude in real
 * dogfood (Anuj's 2026-06-15 data: 624,940 wasted vs 7,553 saved, 83x gap).
 *
 * The architecture: read the live transcript JSONL, find every Read tool_use
 * whose `toolUseResult.file.content` field contains the raw bytes Claude saw,
 * verify those bytes still match the current on-disk file (after LF + BOM
 * canonicalization), and only then write a cache entry. The entry stores the
 * RAW disk sha + RAW disk mtime so the existing live-dedup decision rule
 * works unchanged.
 *
 * Why this is zero-false-dedup by construction:
 *   - We never trust the historical bytes alone. At warm time, we verify that
 *     the current disk content (canonicalized) matches what the transcript
 *     records as the bytes Claude saw (canonicalized). Only then do we write.
 *   - At the next live Read, the hook re-hashes the disk (raw) and compares
 *     to the cached sha (which was the raw disk sha at verified-warm-time).
 *     If disk changed since warm-fill, sha differs → no dedup → Claude re-reads.
 *   - The dedup decision rule (`decideReadDedup`) is unchanged. Warm-fill
 *     only populates the lookup table; the verification still gates the deny.
 *
 * Backed by `docs/research/2026-06-15-mid-session-cache-warming.md`.
 *
 * Pure module: I/O is injected via `PrewarmIO`.
 */
import { normalizeFilePath } from "../../lib/path-normalize.js";
import type { ReadEntry } from "./read-cache.js";

/** I/O seam for testability. */
export interface PrewarmIO {
  /** Read the entire transcript file as a UTF-8 string, or null if missing/unreadable. */
  readTranscript(transcriptPath: string): Promise<string | null>;
  /**
   * Read a file's raw bytes + stat in a single pass. Returns null if missing.
   * The sha256 is over RAW bytes (no normalization) so it matches what the
   * live dedup hook computes.
   */
  readAndStatFile(filePath: string): Promise<{
    rawBytes: Buffer;
    sha256: string;
    mtimeMs: number;
    sizeBytes: number;
  } | null>;
  /** Current time, injectable for deterministic tests. */
  now(): Date;
}

export interface PrewarmInput {
  readonly transcriptPath: string;
  /** Normalized paths already in the dedup cache; we skip these (idempotent). */
  readonly existingPaths: ReadonlySet<string>;
  readonly io: PrewarmIO;
  /** Maximum entries to write. Defaults to 200 (most recently read files). */
  readonly cap?: number;
  /** Maximum transcript size in bytes; skip entirely if larger. Defaults to 50 MB. */
  readonly maxTranscriptBytes?: number;
}

export interface PrewarmStats {
  /** Transcript lines walked. */
  readonly linesWalked: number;
  /** Distinct full-file Read tool_uses found in transcript. */
  readonly candidates: number;
  /** Skipped because partial read (offset/limit, or numLines < totalLines). */
  readonly skippedPartial: number;
  /** Skipped because already in dedup cache (idempotent). */
  readonly skippedAlreadyCached: number;
  /** Skipped because file missing or unreadable on disk now. */
  readonly skippedMissingFile: number;
  /** Skipped because canonical disk sha didn't match canonical transcript sha. */
  readonly skippedShaMismatch: number;
  /** Skipped because beyond the cap. */
  readonly skippedOverCap: number;
  /** Entries actually written to cache. */
  readonly written: number;
  /** True if we bailed at the very top (e.g. transcript missing). */
  readonly bailed: boolean;
}

const EMPTY_STATS: PrewarmStats = {
  linesWalked: 0,
  candidates: 0,
  skippedPartial: 0,
  skippedAlreadyCached: 0,
  skippedMissingFile: 0,
  skippedShaMismatch: 0,
  skippedOverCap: 0,
  written: 0,
  bailed: true,
};

/**
 * Canonicalize content for cross-source comparison: strip a leading UTF-8 BOM
 * and normalize CRLF / lone CR to LF. Claude Code's Read tool already emits
 * LF in its output (per claude-code#20223), so this is mainly defensive for
 * the disk-side bytes (Windows users editing in tools that write CRLF).
 */
export function canonicalizeForCompare(content: string): string {
  if (content.length === 0) return content;
  let s = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  s = s.replace(/\r\n?/g, "\n");
  return s;
}

/**
 * Run the warm-fill pass.
 *
 * Returns the entries to append + diagnostic stats. The caller is responsible
 * for actually appending to the cache file (this module stays pure).
 */
export async function prewarmFromTranscript(
  input: PrewarmInput,
): Promise<{ entries: ReadEntry[]; stats: PrewarmStats }> {
  const cap = input.cap ?? 200;
  const maxTranscriptBytes = input.maxTranscriptBytes ?? 50 * 1024 * 1024;

  const raw = await input.io.readTranscript(input.transcriptPath);
  if (raw === null) {
    return { entries: [], stats: EMPTY_STATS };
  }
  if (raw.length > maxTranscriptBytes) {
    return { entries: [], stats: { ...EMPTY_STATS, bailed: true } };
  }

  // Stats counters (mutable, snapshotted into the immutable return shape).
  let linesWalked = 0;
  let skippedPartial = 0;
  let skippedAlreadyCached = 0;

  // Walk transcript chronologically. Track assistant turn count for
  // firstReadAtTurn attribution. Collect candidates keyed by normalized path,
  // keeping the EARLIEST turn (closest match to "first read in this session")
  // and the LATEST occurrence (for cap ranking).
  interface Candidate {
    normalizedPath: string;
    transcriptContent: string;
    firstSeenTurn: number;
    lastSeenTurn: number;
  }
  const candidates = new Map<string, Candidate>();
  let assistantTurn = 0;

  // Sync-friendly line iteration. The transcript is bounded; whole-file load
  // is cheap up to the maxTranscriptBytes cap above.
  const lines = raw.split("\n");
  for (const line of lines) {
    linesWalked++;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg: unknown;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      // Skip malformed lines; never poison the warm-fill.
      continue;
    }
    if (typeof msg !== "object" || msg === null) continue;

    // Count assistant turns to give firstReadAtTurn a sensible value.
    const role = readStringField(msg, "role") ?? readNestedString(msg, "message", "role");
    const type = readStringField(msg, "type");
    if (role === "assistant" || type === "assistant") {
      assistantTurn++;
    }

    // Look for a toolUseResult.file payload at top level (the Claude Code
    // schema for tool_result entries that wrap file reads).
    const toolUseResult = (msg as Record<string, unknown>).toolUseResult;
    if (!toolUseResult || typeof toolUseResult !== "object") continue;
    const tType = (toolUseResult as Record<string, unknown>).type;
    if (tType !== "text") continue;

    const file = (toolUseResult as Record<string, unknown>).file;
    if (!file || typeof file !== "object") continue;
    const fileObj = file as Record<string, unknown>;
    const filePath = typeof fileObj.filePath === "string" ? fileObj.filePath : null;
    const content = typeof fileObj.content === "string" ? fileObj.content : null;
    const numLines = typeof fileObj.numLines === "number" ? fileObj.numLines : null;
    const startLine = typeof fileObj.startLine === "number" ? fileObj.startLine : null;
    const totalLines = typeof fileObj.totalLines === "number" ? fileObj.totalLines : null;

    if (!filePath || content === null) continue;

    // Skip partial reads: we only warm full-file reads in v1.6.15.
    // (Partial-incoming reads never dedup anyway by safety floor in
    //  decideReadDedup, so partial warm entries would be unused.)
    const isFull =
      (startLine === null || startLine === 1) &&
      (totalLines === null || numLines === null || numLines >= totalLines);
    if (!isFull) {
      skippedPartial++;
      continue;
    }

    const normalizedPath = normalizeFilePath(filePath);
    if (input.existingPaths.has(normalizedPath)) {
      skippedAlreadyCached++;
      continue;
    }

    const turn = Math.max(1, assistantTurn);
    const existing = candidates.get(normalizedPath);
    if (existing) {
      // Update LAST seen turn (for cap ranking); keep first seen turn.
      existing.lastSeenTurn = turn;
      // Update content to the latest copy seen — but for sha-verification
      // purposes, the latest copy is what Claude has freshest in context.
      existing.transcriptContent = content;
    } else {
      candidates.set(normalizedPath, {
        normalizedPath,
        transcriptContent: content,
        firstSeenTurn: turn,
        lastSeenTurn: turn,
      });
    }
  }

  // Cap by most-recently-read.
  const sorted = [...candidates.values()].sort(
    (a, b) => b.lastSeenTurn - a.lastSeenTurn,
  );
  const inScope = sorted.slice(0, cap);
  const skippedOverCap = sorted.length - inScope.length;

  // Verify each candidate against current disk content. Parallel because
  // these are independent disk reads — sequential await would push first-fire
  // latency from <200ms to 500ms+ on real sessions with 50-200 candidates.
  // Each task can resolve to either a ReadEntry or a counter increment.
  const nowIso = input.io.now().toISOString();
  type VerifyResult =
    | { kind: "entry"; entry: ReadEntry }
    | { kind: "missing" }
    | { kind: "mismatch" };
  const verifyResults = await Promise.all(
    inScope.map(async (cand): Promise<VerifyResult> => {
      const disk = await input.io.readAndStatFile(cand.normalizedPath);
      if (!disk) return { kind: "missing" };
      const transcriptCanonical = canonicalizeForCompare(cand.transcriptContent);
      const diskCanonical = canonicalizeForCompare(disk.rawBytes.toString("utf-8"));
      if (transcriptCanonical !== diskCanonical) {
        // Disk drifted from what Claude saw. Do NOT warm. The next live Read
        // will fetch fresh bytes naturally, which is correct.
        return { kind: "mismatch" };
      }
      return {
        kind: "entry",
        entry: {
          filePath: cand.normalizedPath,
          sha256: disk.sha256, // RAW disk sha — matches what live dedup computes
          mtimeMs: disk.mtimeMs, // RAW disk mtime
          sizeBytes: disk.sizeBytes,
          estimatedTokens: Math.ceil(disk.sizeBytes / 4),
          firstReadAtTurn: cand.firstSeenTurn,
          firstReadAt: nowIso,
          source: "warmfill",
        },
      };
    }),
  );

  const entries: ReadEntry[] = [];
  let skippedMissingFile = 0;
  let skippedShaMismatch = 0;
  for (const r of verifyResults) {
    if (r.kind === "entry") entries.push(r.entry);
    else if (r.kind === "missing") skippedMissingFile++;
    else skippedShaMismatch++;
  }

  return {
    entries,
    stats: {
      linesWalked,
      candidates: candidates.size,
      skippedPartial,
      skippedAlreadyCached,
      skippedMissingFile,
      skippedShaMismatch,
      skippedOverCap,
      written: entries.length,
      bailed: false,
    },
  };
}

function readStringField(obj: unknown, key: string): string | null {
  if (typeof obj !== "object" || obj === null) return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

function readNestedString(obj: unknown, outer: string, inner: string): string | null {
  if (typeof obj !== "object" || obj === null) return null;
  const o = (obj as Record<string, unknown>)[outer];
  if (typeof o !== "object" || o === null) return null;
  const v = (o as Record<string, unknown>)[inner];
  return typeof v === "string" ? v : null;
}
