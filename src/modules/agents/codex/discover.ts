/**
 * Codex rollout discovery: $CODEX_HOME/{sessions,archived_sessions}/**\/rollout-*.jsonl
 * and rollout-*.jsonl.zst (Codex compresses older rollouts; mtimes are kept).
 *
 * Only line 1 (`session_meta`) is read here, for the session id and cwd; the
 * full file is read once, later, by loadSessions (readLogText decodes a
 * compressed one). On a Node.js without zstd, compressed rollouts are counted
 * as skipped; folders or files that cannot be read (a damaged `.zst` too) are
 * counted as unreadable: none is ever silently dropped.
 * A missing sessions/ or archived_sessions/ folder is normal, not an error.
 *
 * One log per rollout name: when `X.jsonl` and `X.jsonl.zst` both exist (in
 * either folder), the plain `X.jsonl` is read. It is the one Codex may still
 * be appending to (a resumed session), and the compressed copy can be one
 * whose plain file was not removed yet. Between two copies of the same kind,
 * sessions/ wins over archived_sessions/.
 */
import path from "node:path";
import { isCompressedLog, readCompressedLogFirstLine, type FileSystem } from "../../../lib/fs.js";
import { zstdCodec } from "../../../lib/zstd.js";
import type { ProcessEnv } from "../../../lib/process.js";
import type { SessionMeta } from "../../transcript/discover.js";
import { cwdToProjectHash } from "../../transcript/discover.js";
import { parseCodexMeta } from "./parse.js";

/**
 * Line 1 carries Codex's base instructions, typically 14-41 KB. Start small and
 * double until line 1 ends; past the cap, read the whole file.
 */
const HEAD_START_BYTES = 64 * 1024;
const HEAD_MAX_BYTES = 4 * 1024 * 1024;

export function resolveCodexHome(env: ProcessEnv): string {
  return env.get("CODEX_HOME") || path.join(env.homeDir(), ".codex");
}

export interface CodexDiscovery {
  readonly sessions: SessionMeta[];
  /** Compressed rollouts not read because this Node.js has no zstd. */
  readonly skippedCompressed: number;
  /** Rollout files that could not be read. */
  readonly unreadable: number;
  /** Folders that could not be listed. */
  readonly unreadableFolders: number;
}

interface Found {
  readonly file: string;
  readonly mtimeMs: number;
  readonly size: number;
}

interface Counters {
  unreadable: number;
  unreadableFolders: number;
}

async function walk(fs: FileSystem, dir: string, out: Found[], counters: Counters): Promise<void> {
  let entries;
  try {
    entries = await fs.readDir(dir);
  } catch {
    counters.unreadableFolders++;
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory) await walk(fs, p, out, counters);
    else if (e.isFile && isRolloutName(e.name)) {
      try {
        const s = await fs.stat(p);
        out.push({ file: p, mtimeMs: s.mtimeMs, size: s.size });
      } catch {
        counters.unreadable++;
      }
    }
  }
}

/** `rollout-*.jsonl` or `rollout-*.jsonl.zst`. */
function isRolloutName(name: string): boolean {
  return name.startsWith("rollout-") && (name.endsWith(".jsonl") || name.endsWith(".jsonl.zst"));
}

/** The plain log's name: `X.jsonl` for both `X.jsonl` and `X.jsonl.zst`. */
function plainName(file: string): string {
  return path.basename(file).replace(/\.zst$/, "");
}

/** Line 1 of a rollout, reading the whole file only when line 1 outgrows the largest head window. */
async function readFirstLine(fs: FileSystem, file: string): Promise<string> {
  if (isCompressedLog(file)) return readCompressedLogFirstLine(fs, file);
  for (let n = HEAD_START_BYTES; n <= HEAD_MAX_BYTES; n *= 2) {
    const head = await fs.readHead(file, n);
    const nl = head.indexOf("\n");
    if (nl >= 0) return head.slice(0, nl);
    // A full window decodes to at least n-3 bytes (a split UTF-8 character is
    // held back), so anything shorter means the file ended: a one-line rollout.
    if (Buffer.byteLength(head) < n - 3) return head;
  }
  const full = await fs.readFile(file);
  const fullNl = full.indexOf("\n");
  return fullNl >= 0 ? full.slice(0, fullNl) : full;
}

/** True as soon as one `rollout-*.jsonl` or `.jsonl.zst` is found under `dir` (stops walking there). */
export async function hasCodexRollout(fs: FileSystem, dir: string): Promise<boolean> {
  let entries;
  try {
    entries = await fs.readDir(dir);
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isFile && isRolloutName(e.name)) return true;
  }
  for (const e of entries) {
    if (e.isDirectory && (await hasCodexRollout(fs, path.join(dir, e.name)))) return true;
  }
  return false;
}

export async function listCodexSessions(fs: FileSystem, home: string): Promise<CodexDiscovery> {
  const counters: Counters = { unreadable: 0, unreadableFolders: 0 };
  const byName = new Map<string, Found>();
  for (const sub of ["sessions", "archived_sessions"]) {
    const dir = path.join(home, sub);
    if (!(await fs.exists(dir))) continue;
    const found: Found[] = [];
    await walk(fs, dir, found, counters);
    for (const f of found) {
      const name = plainName(f.file);
      const kept = byName.get(name);
      // The plain log wins over a compressed one; otherwise sessions/ (walked first) wins.
      if (!kept || (isCompressedLog(kept.file) && !isCompressedLog(f.file))) byName.set(name, f);
    }
  }
  const canDecompress = zstdCodec() !== null;
  let skippedCompressed = 0;
  const sessions: SessionMeta[] = [];
  for (const f of byName.values()) {
    if (!canDecompress && isCompressedLog(f.file)) {
      skippedCompressed++;
      continue;
    }
    let line1: string;
    try {
      line1 = await readFirstLine(fs, f.file);
    } catch {
      counters.unreadable++;
      continue;
    }
    // Subagent status: the parser owns it (ParsedSession.isSubagent); this copy marks listings.
    const m = parseCodexMeta(line1);
    const id = m.id ?? plainName(f.file).replace(/\.jsonl$/, "");
    sessions.push({
      sessionId: id,
      filePath: f.file,
      projectHash: m.cwd ? cwdToProjectHash(m.cwd) : "(unknown)",
      mtimeMs: f.mtimeMs,
      size: f.size,
      cwd: m.cwd,
      ...(m.isSubagent ? { isSubagent: true } : {}),
      ...(m.id ? { lineage: { id: m.id, linkedIds: m.linkedIds } } : {}),
      ...(m.cliVersion ? { cliVersion: m.cliVersion } : {}),
    });
  }
  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return {
    sessions,
    skippedCompressed,
    unreadable: counters.unreadable,
    unreadableFolders: counters.unreadableFolders,
  };
}
