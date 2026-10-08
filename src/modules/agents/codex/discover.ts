/**
 * Codex rollout discovery: $CODEX_HOME/{sessions,archived_sessions}/**\/rollout-*.jsonl.
 *
 * Only line 1 (`session_meta`) is read here, for the session id and cwd; the
 * full file is read once, later, by loadSessions. `.jsonl.zst` (Codex's
 * optional compression of old rollouts) is listed as skipped, and folders or
 * files that cannot be read are counted: neither is ever silently dropped.
 * A missing sessions/ or archived_sessions/ folder is normal, not an error.
 */
import path from "node:path";
import type { FileSystem } from "../../../lib/fs.js";
import type { ProcessEnv } from "../../../lib/process.js";
import type { SessionMeta } from "../../transcript/discover.js";
import { cwdToProjectHash } from "../../transcript/discover.js";
import { parseCodexMeta } from "./parse.js";

/** Line 1 carries Codex's base instructions, typically tens of KB; 1 MiB covers it. */
const HEAD_BYTES = 1024 * 1024;

export function resolveCodexHome(env: ProcessEnv): string {
  return env.get("CODEX_HOME") || path.join(env.homeDir(), ".codex");
}

export interface CodexDiscovery {
  readonly sessions: SessionMeta[];
  readonly skippedCompressed: number;
  /** Paths of the skipped `.jsonl.zst` rollouts. */
  readonly compressedFiles: string[];
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
  compressed: string[];
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
    else if (e.isFile && e.name.startsWith("rollout-")) {
      if (e.name.endsWith(".jsonl.zst")) counters.compressed.push(p);
      else if (e.name.endsWith(".jsonl")) {
        try {
          const s = await fs.stat(p);
          out.push({ file: p, mtimeMs: s.mtimeMs, size: s.size });
        } catch {
          counters.unreadable++;
        }
      }
    }
  }
}

/** Line 1 of a rollout, reading the whole file only when line 1 outgrows the head window. */
async function readFirstLine(fs: FileSystem, file: string): Promise<string> {
  const head = await fs.readHead(file, HEAD_BYTES);
  const nl = head.indexOf("\n");
  if (nl >= 0) return head.slice(0, nl);
  const full = await fs.readFile(file);
  const fullNl = full.indexOf("\n");
  return fullNl >= 0 ? full.slice(0, fullNl) : full;
}

/** True as soon as one `rollout-*.jsonl` is found under `dir` (stops walking there). */
export async function hasCodexRollout(fs: FileSystem, dir: string): Promise<boolean> {
  let entries;
  try {
    entries = await fs.readDir(dir);
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isFile && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) return true;
  }
  for (const e of entries) {
    if (e.isDirectory && (await hasCodexRollout(fs, path.join(dir, e.name)))) return true;
  }
  return false;
}

export async function listCodexSessions(fs: FileSystem, home: string): Promise<CodexDiscovery> {
  const counters: Counters = { compressed: [], unreadable: 0, unreadableFolders: 0 };
  const byName = new Map<string, Found>();
  for (const sub of ["sessions", "archived_sessions"]) {
    const dir = path.join(home, sub);
    if (!(await fs.exists(dir))) continue;
    const found: Found[] = [];
    await walk(fs, dir, found, counters);
    for (const f of found) {
      const name = path.basename(f.file);
      if (!byName.has(name)) byName.set(name, f); // sessions/ is walked first and wins
    }
  }
  const sessions: SessionMeta[] = [];
  for (const f of byName.values()) {
    let line1: string;
    try {
      line1 = await readFirstLine(fs, f.file);
    } catch {
      counters.unreadable++;
      continue;
    }
    // Subagent status also lives on line 1, but the parser owns it (ParsedSession.isSubagent).
    const m = parseCodexMeta(line1);
    const id = m.id ?? path.basename(f.file).replace(/\.jsonl$/, "");
    sessions.push({
      sessionId: id,
      filePath: f.file,
      projectHash: m.cwd ? cwdToProjectHash(m.cwd) : "(unknown)",
      mtimeMs: f.mtimeMs,
      size: f.size,
      cwd: m.cwd,
    });
  }
  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return {
    sessions,
    skippedCompressed: counters.compressed.length,
    compressedFiles: counters.compressed,
    unreadable: counters.unreadable,
    unreadableFolders: counters.unreadableFolders,
  };
}
