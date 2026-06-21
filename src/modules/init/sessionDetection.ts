/**
 * Detect active Claude Code sessions for F-CACHE-DEFER (v1.6.16).
 *
 * Scans `~/.claude/projects/PROJ/sessions/SID.jsonl` (where PROJ is any
 * project-hash dir and SID is any session id) for files whose mtime is
 * within `thresholdMs` of `now()`. If any such file exists, the user has
 * an active Claude Code session and `sipcode init` should defer the
 * `settings.json` write to protect Anthropic's prompt cache.
 *
 * Pure-ish: all I/O is injected via {@link SessionDetectionIO} so the function
 * is fully deterministic for tests. Defensive: any listDir or stat failure on
 * a subtree is treated as "skip this subtree", not as a hard error. The whole
 * walk degrades to "not active" rather than throwing. Callers should never
 * crash because of a permission glitch in a sibling directory.
 *
 * The threshold default of 5 minutes mirrors Anthropic's prompt cache TTL.
 * Any file written within that window is presumed to be a live session.
 */
import path from "node:path";

const DEFAULT_THRESHOLD_MS = 5 * 60 * 1000;

/** Filesystem I/O seam. Pure-only operations. */
export interface SessionDetectionIO {
  /** List immediate children of a directory. Throws on permission errors etc. */
  listDir(absPath: string): Promise<string[]>;
  /** Stat a path. Returns null if missing. Throws on permission errors. */
  stat(absPath: string): Promise<{ mtimeMs: number; isDirectory: boolean } | null>;
  /** Current time. Injected for test determinism. */
  now(): Date;
}

export interface ActiveSessionsInput {
  readonly homeDir: string;
  readonly io: SessionDetectionIO;
  /** Activity threshold in ms. Defaults to 5 minutes (Anthropic prompt-cache TTL). */
  readonly thresholdMs?: number;
}

export interface ActiveSessionsResult {
  /** True iff at least one `.jsonl` was modified within the threshold. */
  readonly active: boolean;
  /** Count of `.jsonl` files within the threshold, across all projects. */
  readonly count: number;
  /** Did `~/.claude/projects` exist as a directory at scan time? */
  readonly projectsDirExists: boolean;
}

/**
 * Walk the projects directory and count session jsonl files whose mtime is
 * within `thresholdMs` of `now()`. See module docstring for the path layout
 * and rationale.
 *
 * Never throws. Permission errors on any subtree degrade to "skip subtree".
 */
export async function detectActiveClaudeSessions(
  input: ActiveSessionsInput,
): Promise<ActiveSessionsResult> {
  const threshold = input.thresholdMs ?? DEFAULT_THRESHOLD_MS;
  const cutoffMs = input.io.now().getTime() - threshold;

  // Step 1: is ~/.claude there at all?
  const claudeDir = path.join(input.homeDir, ".claude");
  const claudeStat = await safeStat(input.io, claudeDir);
  if (!claudeStat || !claudeStat.isDirectory) {
    return { active: false, count: 0, projectsDirExists: false };
  }

  // Step 2: is the projects subdirectory there?
  const projectsDir = path.join(claudeDir, "projects");
  const projectsStat = await safeStat(input.io, projectsDir);
  if (!projectsStat || !projectsStat.isDirectory) {
    return { active: false, count: 0, projectsDirExists: false };
  }

  // Step 3: list projects. Permission failure → projectsDirExists=true but
  // empty walk, treated as not-active.
  let projectEntries: string[];
  try {
    projectEntries = await input.io.listDir(projectsDir);
  } catch {
    return { active: false, count: 0, projectsDirExists: true };
  }

  // Step 4: walk each project's sessions/ directory.
  let count = 0;
  for (const projectName of projectEntries) {
    const projectDir = path.join(projectsDir, projectName);
    const pStat = await safeStat(input.io, projectDir);
    if (!pStat || !pStat.isDirectory) continue;

    const sessionsDir = path.join(projectDir, "sessions");
    const sStat = await safeStat(input.io, sessionsDir);
    if (!sStat || !sStat.isDirectory) continue;

    let sessionEntries: string[];
    try {
      sessionEntries = await input.io.listDir(sessionsDir);
    } catch {
      continue; // permission error on this project; skip without failing
    }

    for (const file of sessionEntries) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = path.join(sessionsDir, file);
      const fStat = await safeStat(input.io, filePath);
      if (!fStat) continue; // race: file was listed but missing at stat time
      if (fStat.isDirectory) continue; // .jsonl directory: ignore
      if (fStat.mtimeMs >= cutoffMs) {
        count += 1;
      }
    }
  }

  return { active: count > 0, count, projectsDirExists: true };
}

/** Stat that swallows permission errors as "not found". */
async function safeStat(
  io: SessionDetectionIO,
  p: string,
): Promise<{ mtimeMs: number; isDirectory: boolean } | null> {
  try {
    return await io.stat(p);
  } catch {
    return null;
  }
}
