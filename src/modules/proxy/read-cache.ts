/**
 * Per-session read cache for re-read dedup.
 *
 * Records what files Claude has read this session (path + sha256 + mtimeMs +
 * approximate token cost + first-seen turn ordinal). When Claude tries to read
 * the same file again and nothing has changed, the proxy denies the call with
 * a reason so Claude knows the content is already in its context.
 *
 * Cache file: `~/.sipcode/proxy-reads/<session-id>.jsonl`. Session-keyed
 * because Claude's working memory resets per session — an unchanged file from
 * a prior session is NOT in the new session's context.
 *
 * StoreIO seam mirrors `drift/store.ts`. lib/fs.ts is read-only; this module
 * needs writes, so it keeps its own seam.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export interface ReadEntry {
  /** Absolute file path Claude asked to read. */
  readonly filePath: string;
  /** sha256 of file contents at first read time. */
  readonly sha256: string;
  /** mtimeMs at first read time. */
  readonly mtimeMs: number;
  /** File size in bytes at first read time. */
  readonly sizeBytes: number;
  /** Rough token estimate (bytes / 4) of what Claude saw. */
  readonly estimatedTokens: number;
  /** Turn ordinal when first read in this session (1-based). */
  readonly firstReadAtTurn: number;
  /** ISO timestamp when first read. */
  readonly firstReadAt: string;
  /**
   * How this entry got into the cache. Optional for backwards compatibility:
   * entries written by v1.6.14 and earlier have no `source` field and should
   * be treated as `"live"`. v1.6.15+ tags warm-fill entries explicitly so
   * `sipcode proxy --stats` (and tests) can distinguish them.
   */
  readonly source?: "live" | "warmfill";
}

export interface StoreIO {
  read(p: string): Promise<string | null>;
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
  async append(p, content) {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.appendFile(p, content, "utf-8");
  },
};

/** Parse JSONL, dedupe by filePath (last write wins — handles file-changed updates). */
export async function loadReadCache(
  filePath: string,
  io: StoreIO = realStoreIO,
): Promise<Map<string, ReadEntry>> {
  const raw = await io.read(filePath);
  if (raw === null) return new Map();
  const byPath = new Map<string, ReadEntry>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const e = JSON.parse(trimmed) as ReadEntry;
      if (
        e &&
        typeof e === "object" &&
        typeof e.filePath === "string" &&
        typeof e.sha256 === "string" &&
        typeof e.mtimeMs === "number"
      ) {
        byPath.set(e.filePath, e);
      }
    } catch {
      // Skip malformed line; cache must never poison a Read call.
    }
  }
  return byPath;
}

/** Append a single ReadEntry to the cache. */
export async function appendReadEntry(
  filePath: string,
  entry: ReadEntry,
  io: StoreIO = realStoreIO,
): Promise<void> {
  await io.append(filePath, JSON.stringify(entry) + "\n");
}

/**
 * Resolve the on-disk cache path for a given session.
 * Exposed so the hook script and tests both use the same convention.
 *
 * Security (defense-in-depth): sessionId is sanitized to allowlist
 * [a-zA-Z0-9_-]{1,64} so a malicious or malformed PreToolUse event cannot
 * cause path traversal (e.g. "../../tmp/evil"). The realistic threat is
 * small (Claude Code generates UUIDv4 session ids) but the cost of the
 * check is zero.
 */
const SAFE_SESSION_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function sanitizeSessionId(sessionId: string): string {
  if (typeof sessionId === "string" && SAFE_SESSION_RE.test(sessionId)) {
    return sessionId;
  }
  return "unsafe-session";
}

export function sessionCachePath(home: string, sessionId: string): string {
  return path.join(
    home,
    ".sipcode",
    "proxy-reads",
    `${sanitizeSessionId(sessionId)}.jsonl`,
  );
}
