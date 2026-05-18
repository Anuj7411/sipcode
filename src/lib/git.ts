/**
 * Git seam — the ONLY place in src/ that imports node:child_process.
 *
 * All git invocations use execFile (NEVER shell) to avoid argv injection.
 * Pure code receives a `Git` instance; tests inject `FakeGit`.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/** A single entry from `git log --name-only`. */
export interface GitLogEntry {
  readonly sha: string;
  readonly timestampUnix: number;
  readonly files: ReadonlyArray<string>;
}

export interface Git {
  /** Returns true iff `git` is available on PATH and `cwd` is inside a repo. */
  available(cwd: string): Promise<boolean>;
  /** Short HEAD sha (e.g. "68a183e"). Returns undefined if not in a repo. */
  headShort(cwd: string): Promise<string | undefined>;
  /** Returns ls-files output as POSIX-style relative paths. */
  lsFiles(cwd: string): Promise<ReadonlyArray<string>>;
  /**
   * Returns commit entries newer than `sinceDays` ago, oldest first.
   * Each entry lists the files touched by that commit (POSIX paths).
   */
  logSince(cwd: string, sinceDays: number): Promise<ReadonlyArray<GitLogEntry>>;
}

export class RealGit implements Git {
  async available(cwd: string): Promise<boolean> {
    try {
      await execFileP("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd,
        windowsHide: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  async headShort(cwd: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileP(
        "git",
        ["rev-parse", "--short", "HEAD"],
        { cwd, windowsHide: true },
      );
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  async lsFiles(cwd: string): Promise<ReadonlyArray<string>> {
    try {
      const { stdout } = await execFileP("git", ["ls-files"], {
        cwd,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
      });
      return stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } catch {
      return [];
    }
  }

  async logSince(
    cwd: string,
    sinceDays: number,
  ): Promise<ReadonlyArray<GitLogEntry>> {
    try {
      // Stable, machine-readable format. Each commit header is "COMMIT\t<sha>\t<unix>".
      // Followed by file paths, one per line, blank line between commits.
      const { stdout } = await execFileP(
        "git",
        [
          "log",
          `--since=${sinceDays}.days.ago`,
          "--name-only",
          "--no-merges",
          "--pretty=format:COMMIT\t%H\t%ct",
          "--reverse",
        ],
        { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
      );
      return parseGitLog(stdout);
    } catch {
      return [];
    }
  }
}

/** Parser shared between RealGit and FakeGit-from-string fixtures. */
export function parseGitLog(stdout: string): GitLogEntry[] {
  const out: GitLogEntry[] = [];
  const lines = stdout.split(/\r?\n/);
  let cur: { sha: string; ts: number; files: string[] } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("COMMIT\t")) {
      if (cur) {
        out.push({
          sha: cur.sha,
          timestampUnix: cur.ts,
          files: cur.files,
        });
      }
      const parts = line.split("\t");
      const sha = parts[1] ?? "";
      const ts = Number(parts[2] ?? 0);
      cur = { sha, ts: Number.isFinite(ts) ? ts : 0, files: [] };
    } else if (line.length === 0) {
      continue;
    } else if (cur) {
      cur.files.push(line);
    }
  }
  if (cur) {
    out.push({ sha: cur.sha, timestampUnix: cur.ts, files: cur.files });
  }
  return out;
}

export interface FakeGitInit {
  available?: boolean;
  headShort?: string;
  files?: ReadonlyArray<string>;
  log?: ReadonlyArray<GitLogEntry>;
}

/** Deterministic in-memory git for tests. */
export class FakeGit implements Git {
  private readonly _available: boolean;
  private readonly _head: string | undefined;
  private readonly _files: ReadonlyArray<string>;
  private readonly _log: ReadonlyArray<GitLogEntry>;

  constructor(init: FakeGitInit = {}) {
    this._available = init.available ?? true;
    this._head = init.headShort;
    this._files = init.files ?? [];
    this._log = init.log ?? [];
  }

  async available(_cwd: string): Promise<boolean> {
    return this._available;
  }
  async headShort(_cwd: string): Promise<string | undefined> {
    return this._head;
  }
  async lsFiles(_cwd: string): Promise<ReadonlyArray<string>> {
    return this._files;
  }
  async logSince(
    _cwd: string,
    _sinceDays: number,
  ): Promise<ReadonlyArray<GitLogEntry>> {
    // FakeGit ignores sinceDays; tests provide the exact log they want.
    return this._log;
  }
}
