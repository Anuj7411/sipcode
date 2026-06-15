/**
 * Hook-side orchestrator for re-read dedup.
 *
 * Runs when Claude Code asks to invoke the Read tool. Stats the file, hashes
 * it, looks up the per-session read cache, asks the pure `decideReadDedup`
 * module, and shapes the hook output.
 *
 * The pure decision module lives at `rewriters/dedupRead.ts`. This file owns
 * the I/O. Rewriter-purity guard does NOT apply here (the file lives outside
 * `rewriters/` and is explicitly impure by contract).
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeFilePath } from "../../lib/path-normalize.js";
import { decideReadDedup } from "./rewriters/dedupRead.js";
import { prewarmFromTranscript } from "./prewarmCache.js";
import {
  loadReadCache,
  appendReadEntry,
  sanitizeSessionId,
  sessionCachePath,
  realStoreIO,
  type StoreIO,
  type ReadEntry,
} from "./read-cache.js";
import type {
  PreToolUseInput,
  HookSpecificOutput,
  ProxyStatsEntry,
} from "./types.js";

export interface HookReadDedupResult {
  readonly hookOutput: HookSpecificOutput | null;
  readonly statsEntry: ProxyStatsEntry | null;
}

const EMPTY: HookReadDedupResult = { hookOutput: null, statsEntry: null };

/** I/O seam for tests. */
export interface DedupIO extends StoreIO {
  hashFile(p: string): Promise<{ sha256: string; mtimeMs: number; sizeBytes: number } | null>;
  countAssistantTurns(transcriptPath: string): Promise<number>;
  now(): Date;
  /**
   * v1.6.15: read the whole Claude Code transcript JSONL as a UTF-8 string.
   * Returns null if missing or unreadable. Used by warmfill at the top of
   * the hook to back-fill the dedup cache from prior session activity.
   */
  readTranscript(transcriptPath: string): Promise<string | null>;
  /**
   * v1.6.15: read a file's raw bytes + stat in one pass. Returns null if the
   * file is missing or unreadable. The `rawBytes` field lets warmfill canonicalize
   * (LF, no BOM) for cross-source comparison with what the transcript shows.
   * The `sha256` is over RAW bytes (no normalization) so it matches what the
   * live dedup decision computes.
   */
  readAndStatFile(filePath: string): Promise<{
    rawBytes: Buffer;
    sha256: string;
    mtimeMs: number;
    sizeBytes: number;
  } | null>;
}

export const realDedupIO: DedupIO = {
  ...realStoreIO,
  async hashFile(p) {
    try {
      const data = await fs.readFile(p);
      const stat = await fs.stat(p);
      return {
        sha256: createHash("sha256").update(data).digest("hex"),
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
      };
    } catch {
      return null;
    }
  },
  async countAssistantTurns(p) {
    try {
      const raw = await fs.readFile(p, "utf-8");
      let count = 0;
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line) as { role?: string; type?: string };
          if (m.role === "assistant" || m.type === "assistant") count++;
        } catch {
          // ignore malformed transcript lines
        }
      }
      return count || 1;
    } catch {
      return 1;
    }
  },
  async readTranscript(p) {
    try {
      return await fs.readFile(p, "utf-8");
    } catch {
      return null;
    }
  },
  async readAndStatFile(p) {
    try {
      const data = await fs.readFile(p);
      const stat = await fs.stat(p);
      return {
        rawBytes: data,
        sha256: createHash("sha256").update(data).digest("hex"),
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
      };
    } catch {
      return null;
    }
  },
  now() {
    return new Date();
  },
};

/**
 * Resolve the marker-file path that tracks whether warmfill has been
 * attempted in a session. Coincident with the cache file's directory so
 * cleanup is in one place. We use a sentinel file rather than a marker
 * entry in the cache JSONL so existing consumers of the cache schema
 * don't need to filter sentinels.
 */
function warmfillMarkerPath(home: string, sessionId: string): string {
  return path.join(
    home,
    ".sipcode",
    "proxy-reads",
    `${sanitizeSessionId(sessionId)}.warmed`,
  );
}

export async function hookReadDedup(
  input: PreToolUseInput,
  homeDir: string,
  io: DedupIO = realDedupIO,
): Promise<HookReadDedupResult> {
  try {
    if (input.tool_name !== "Read") return EMPTY;
    const filePath = input.tool_input.file_path;
    if (typeof filePath !== "string" || filePath.length === 0) return EMPTY;

    // session_id is empty in `claude --print --no-session-persistence` runs
    // (e.g. the benchmark live runner). Fall back to a per-process session
    // key keyed on cwd so re-reads inside the same spawn still dedup.
    // Cache files keyed by an ephemeral session live and die with the spawn.
    const sessionKey =
      input.session_id && input.session_id.length > 0
        ? input.session_id
        : `pid-${process.pid}-${(input.cwd ?? "no-cwd")
            .replace(/[^a-zA-Z0-9_-]/g, "_")
            .slice(-40)}`;

    // v1.6.14: normalize the file path BEFORE looking up the cache, so
    // `C:\foo\bar.ts` and `c:/foo/bar.ts` from the same on-disk file collide
    // on the same cache key. Pre-fix this is the gap that made dedup miss
    // ~50x of the dupes the drift analyzer was correctly counting.
    const normalizedPath = normalizeFilePath(filePath);
    const current = await io.hashFile(filePath);
    const cachePath = sessionCachePath(homeDir, sessionKey);
    const cache = await loadReadCache(cachePath, io);

    // v1.6.15: Verified Warm-Fill. On the first hook fire in this session,
    // walk the transcript JSONL and back-fill the cache with every full-file
    // Read whose historical bytes (per `toolUseResult.file.content`) still
    // match current disk content after LF + BOM canonicalization. Only the
    // verified-matching entries are written. This closes the mid-session
    // install gap (cache empty → no dedup against pre-install reads).
    //
    // Architecture detail in docs/research/2026-06-15-mid-session-cache-warming.md.
    // Zero false-dedup: warmfill only adds entries to the lookup table; the
    // dedup DECISION rule still requires sha match against current disk at
    // every Read. If disk drifted between warmfill and re-read, sha differs,
    // we let the read through.
    //
    // Gated by a one-shot marker so a long session does not re-walk the
    // transcript on every hook fire. Marker is written BEFORE running so a
    // crash mid-warmfill cannot trigger an infinite retry loop.
    if (input.transcript_path) {
      const markerPath = warmfillMarkerPath(homeDir, sessionKey);
      const alreadyAttempted = (await io.read(markerPath)) !== null;
      if (!alreadyAttempted) {
        try {
          const result = await prewarmFromTranscript({
            transcriptPath: input.transcript_path,
            existingPaths: new Set(cache.keys()),
            io: {
              readTranscript: io.readTranscript,
              readAndStatFile: io.readAndStatFile,
              now: io.now,
            },
          });
          // Only mark the session "warmed" after a real attempt (transcript
          // was readable). If we bailed (transcript missing or too big), we
          // want to retry on the next hook fire — maybe the transcript file
          // appeared, or Claude Code rotated to a smaller one.
          if (!result.stats.bailed) {
            try {
              await io.append(markerPath, "");
            } catch {
              // Marker write failure is silent; worst case we re-attempt next fire.
            }
            for (const entry of result.entries) {
              try {
                await appendReadEntry(cachePath, entry, io);
              } catch {
                // Cache write failures are silent — must never break Claude Code.
              }
              // Mirror the entry into the in-memory cache so the decision
              // below sees freshly warm-filled entries on THIS hook fire.
              cache.set(entry.filePath, entry);
            }
          }
        } catch {
          // Any prewarm crash → write marker to prevent infinite retry.
          try {
            await io.append(markerPath, "");
          } catch {
            // ignore
          }
        }
      }
    }

    const cached = cache.get(normalizedPath);

    const decision = decideReadDedup({
      toolInput: input.tool_input,
      current: current ? { sha256: current.sha256, mtimeMs: current.mtimeMs } : null,
      cached,
    });

    if (decision.kind === "dedup") {
      return {
        hookOutput: {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: decision.reason,
          },
        },
        statsEntry: {
          timestamp: io.now().toISOString(),
          toolName: "Read",
          rewriterName: "dedup-read",
          savedTokensEstimate: decision.savedTokensEstimate,
          integrityScore: 0.95,
        },
      };
    }

    // Record/refresh the cache when:
    //   - current fingerprint is available, AND
    //   - the model did not ask for a partial read, AND
    //   - the file_path was usable
    const shouldRecord =
      current !== null &&
      decision.reason !== "partial-read-requested" &&
      decision.reason !== "missing-file-path" &&
      decision.reason !== "missing-current-fingerprint";

    if (shouldRecord && current) {
      const turn = await io.countAssistantTurns(input.transcript_path);
      const entry: ReadEntry = {
        // Store the normalized path so future lookups match regardless of
        // whether Claude sent C:\foo\bar or c:/foo/bar this time.
        filePath: normalizedPath,
        sha256: current.sha256,
        mtimeMs: current.mtimeMs,
        sizeBytes: current.sizeBytes,
        estimatedTokens: Math.ceil(current.sizeBytes / 4),
        firstReadAtTurn: cached ? cached.firstReadAtTurn : turn,
        firstReadAt: cached ? cached.firstReadAt : io.now().toISOString(),
      };
      try {
        await appendReadEntry(cachePath, entry, io);
      } catch {
        // Cache write failures are silent — must never break Claude Code.
      }
    }
    return EMPTY;
  } catch {
    return EMPTY;
  }
}
