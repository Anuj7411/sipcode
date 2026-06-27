/**
 * Session discovery — the only I/O module in the transcript pipeline.
 *
 * Walks `~/.claude/projects/<project-hash>/*.jsonl` (or SIPCODE_PROJECTS_DIR
 * override). Returns metadata sorted by recency.
 */
import path from "node:path";
import type { FileSystem } from "../../lib/fs.js";
import type { ProcessEnv } from "../../lib/process.js";

export interface SessionMeta {
  /** Bare session id (filename without .jsonl). */
  readonly sessionId: string;
  /** Absolute path to the .jsonl. */
  readonly filePath: string;
  /** The "project hash" directory name. */
  readonly projectHash: string;
  /** Mtime in ms epoch. */
  readonly mtimeMs: number;
  /** File size in bytes. */
  readonly size: number;
}

export function resolveProjectsDir(env: ProcessEnv): string {
  const override = env.get("SIPCODE_PROJECTS_DIR");
  if (override) return override;
  return path.join(env.homeDir(), ".claude", "projects");
}

export async function projectsDirExists(
  fs: FileSystem,
  dir: string,
): Promise<boolean> {
  return fs.exists(dir);
}

/**
 * Project dirs created by observer/telemetry plugins (e.g. claude-mem) that
 * hold synthetic, zero-work sessions. They pollute session counts and the
 * "latest session" pick, so they are excluded from discovery entirely.
 */
const OBSERVER_DIR_PATTERNS: readonly RegExp[] = [
  /-observer-sessions$/i,
  /claude-mem-observer/i,
];

/** True if a project-hash dir name belongs to an observer/telemetry plugin. */
export function isObserverProjectDir(name: string): boolean {
  return OBSERVER_DIR_PATTERNS.some((re) => re.test(name));
}

/**
 * List all sessions across all project directories.
 * Sorted by mtime descending (most recent first).
 * Observer/telemetry project dirs (see {@link isObserverProjectDir}) are skipped.
 */
export async function listAllSessions(
  fs: FileSystem,
  projectsDir: string,
): Promise<SessionMeta[]> {
  const out: SessionMeta[] = [];
  if (!(await fs.exists(projectsDir))) return out;
  const projectDirs = await fs.readDir(projectsDir);
  for (const proj of projectDirs) {
    if (!proj.isDirectory) continue;
    if (isObserverProjectDir(proj.name)) continue;
    const projPath = path.join(projectsDir, proj.name);
    let entries;
    try {
      entries = await fs.readDir(projPath);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile || !e.name.endsWith(".jsonl")) continue;
      const filePath = path.join(projPath, e.name);
      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch {
        continue;
      }
      out.push({
        sessionId: e.name.replace(/\.jsonl$/, ""),
        filePath,
        projectHash: proj.name,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Scope to the project dir whose name matches the current cwd's path-hash.
 * Claude Code project-hashes are derived from cwd by replacing path separators
 * with `-` and prepending the drive (Windows). We don't replicate the exact
 * algorithm; instead we look for a project dir whose name contains the cwd's
 * basename and prefer it.
 */
export async function listSessionsHere(
  fs: FileSystem,
  projectsDir: string,
  cwd: string,
): Promise<SessionMeta[]> {
  const all = await listAllSessions(fs, projectsDir);
  // Match by cwd path → claude-code style hash.
  // Windows: C:\Projects\Sipcode -> "C--Projects-Sipcode"
  // POSIX:   /home/u/proj         -> "-home-u-proj"
  const cwdHash = cwdToProjectHash(cwd);
  return all.filter((s) => s.projectHash === cwdHash || cwdHash.endsWith(s.projectHash));
}

/**
 * Encode a working-directory path the way Claude Code names its project dirs:
 * EVERY character that is not a letter or digit collapses to "-". Verified
 * empirically against ~/.claude/projects — Claude Code turns
 * "C:\Projects\just research" into "C--Projects-just-research" and ".claude-mem"
 * into "--claude-mem" (the dot is replaced too). Matching only ":/\ + whitespace"
 * is not enough: any path with a dot, parenthesis, underscore, etc. would
 * mismatch and `--here` would silently find nothing.
 */
export function cwdToProjectHash(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

export async function findSessionById(
  fs: FileSystem,
  projectsDir: string,
  idPrefix: string,
): Promise<SessionMeta | undefined> {
  const all = await listAllSessions(fs, projectsDir);
  return all.find((s) => s.sessionId.startsWith(idPrefix));
}
