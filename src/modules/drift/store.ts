/**
 * Persistent drift cache. Stores parsed `SessionMetrics` as JSONL at
 * `~/.sipcode/drift/sessions-v3.jsonl` (the file name is the caller's, see
 * commands/drift.ts). Skips reparsing unchanged transcripts on repeat runs.
 *
 * Storage shape: one JSON object per line. Dedupe-on-read by `sessionId`
 * (last write wins). Pruned to KEEP_MAX entries once total exceeds PRUNE_AT.
 *
 * No FS abstraction is reused here: the `StoreIO` seam is local so the
 * read-only `FileSystem` interface in lib/fs.ts stays read-only.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SessionMetrics } from "./types.js";

export interface StoreIO {
  /** Return file contents or null if the file does not exist. */
  read(p: string): Promise<string | null>;
  /** Write `content` atomically, creating parent dirs as needed. */
  write(p: string, content: string): Promise<void>;
  /** Append `content`, creating parent dirs on first call. */
  append(p: string, content: string): Promise<void>;
}

export const realStoreIO: StoreIO = {
  async read(p) {
    try {
      return await fs.readFile(p, "utf-8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw err;
    }
  },
  async write(p, content) {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, "utf-8");
  },
  async append(p, content) {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.appendFile(p, content, "utf-8");
  },
};

// Room for two agents' drift windows (Claude Code and Codex, 30 sessions each).
const KEEP_MAX = 100;
const PRUNE_AT = 200;

/** Parse JSONL, dedupe by sessionId (last wins), return newest-first. */
export async function loadCachedSessions(
  filePath: string,
  io: StoreIO = realStoreIO,
): Promise<SessionMetrics[]> {
  const raw = await io.read(filePath);
  if (raw === null) return [];
  const byId = new Map<string, SessionMetrics>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const m = JSON.parse(trimmed) as SessionMetrics;
      if (m && typeof m === "object" && typeof m.sessionId === "string") {
        byId.set(m.sessionId, m);
      }
    } catch {
      // Skip malformed line; the cache must never poison a drift run.
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.endedAtMs - a.endedAtMs);
}

/** Append only the entries whose sessionId is not already known. No-op if all known. */
export async function persistNewSessions(
  filePath: string,
  knownIds: ReadonlySet<string>,
  fresh: ReadonlyArray<SessionMetrics>,
  io: StoreIO = realStoreIO,
): Promise<number> {
  const lines: string[] = [];
  for (const m of fresh) {
    if (knownIds.has(m.sessionId)) continue;
    lines.push(JSON.stringify(m));
  }
  if (lines.length === 0) return 0;
  await io.append(filePath, lines.join("\n") + "\n");
  return lines.length;
}

/**
 * Rewrite the cache keeping only the newest KEEP_MAX entries once the file
 * holds more than PRUNE_AT lines. Lines, not distinct sessions: a session that
 * changed since it was cached is appended again, so a live session adds a line
 * per run. Idempotent; safe to call after every persist.
 */
export async function pruneIfLarge(
  filePath: string,
  io: StoreIO = realStoreIO,
): Promise<void> {
  const raw = await io.read(filePath);
  if (raw === null) return;
  const lines = raw.split("\n").filter((l) => l.trim().length > 0).length;
  if (lines <= PRUNE_AT) return;
  const all = await loadCachedSessions(filePath, io);
  const kept = all.slice(0, KEEP_MAX);
  const body = kept.map((m) => JSON.stringify(m)).join("\n") + "\n";
  await io.write(filePath, body);
}
