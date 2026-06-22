/**
 * Tests for v1.6.16 `detectActiveClaudeSessions` — F-CACHE-DEFER cornerstone.
 *
 * Scans ~/.claude/projects/<project-hash>/sessions/<session-id>.jsonl for
 * files modified within the threshold (default 5 minutes). Pure function,
 * I/O injected via SessionDetectionIO so we can drive every path determ-
 * inistically without hitting the real disk.
 *
 * Coverage matrix:
 *   - no ~/.claude → not active, projectsDirExists=false
 *   - no projects dir → not active, projectsDirExists=false
 *   - empty projects dir → not active, projectsDirExists=true
 *   - project with no sessions dir → skipped silently
 *   - project with empty sessions dir → skipped silently
 *   - single recent session → active
 *   - single stale session → not active
 *   - multiple sessions, one recent → active (count==1 for active set)
 *   - multiple projects, mixed → count reflects active only
 *   - listDir error mid-walk → degrades to not-active (defensive)
 *   - custom threshold respected
 *   - non-.jsonl files ignored
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  detectActiveClaudeSessions,
  type SessionDetectionIO,
} from "../../../src/modules/init/sessionDetection.js";

const HOME = "/home/user";
const NOW = new Date("2026-06-21T12:00:00.000Z");
const NOW_MS = NOW.getTime();
const FIVE_MIN_MS = 5 * 60 * 1000;

interface MockEntry {
  /** "dir" or "file" — affects stat().isDirectory and listDir traversal. */
  readonly type: "dir" | "file";
  readonly mtimeMs?: number;
}

interface MockFs {
  readonly entries: Record<string, MockEntry>;
  /** Optional: paths whose listDir should throw (simulate permission errors). */
  readonly listDirThrows?: ReadonlySet<string>;
}

/** Build a deterministic SessionDetectionIO over a flat path → entry map. */
function makeIO(fs: MockFs, now: Date = NOW): SessionDetectionIO {
  return {
    async listDir(p) {
      if (fs.listDirThrows?.has(p)) throw new Error("EACCES");
      // Return entries whose parent path is `p`.
      const prefix = p.endsWith("/") || p.endsWith("\\") ? p : p + path.sep;
      const out: string[] = [];
      for (const full of Object.keys(fs.entries)) {
        if (!full.startsWith(prefix)) continue;
        const rest = full.slice(prefix.length);
        // direct child only — no further separators
        if (rest.includes("/") || rest.includes("\\")) continue;
        if (rest.length === 0) continue;
        out.push(rest);
      }
      return out;
    },
    async stat(p) {
      const e = fs.entries[p];
      if (!e) return null;
      return {
        mtimeMs: e.mtimeMs ?? 0,
        isDirectory: e.type === "dir",
      };
    },
    now() {
      return now;
    },
  };
}

/** Compose a project-hash/sessions/<file> path under HOME/.claude/projects. */
function projectsRoot(): string {
  return path.join(HOME, ".claude", "projects");
}
function sessionFile(projectHash: string, sessionId: string): string {
  return path.join(
    projectsRoot(),
    projectHash,
    "sessions",
    `${sessionId}.jsonl`,
  );
}
function sessionsDir(projectHash: string): string {
  return path.join(projectsRoot(), projectHash, "sessions");
}
function projectDir(projectHash: string): string {
  return path.join(projectsRoot(), projectHash);
}

describe("detectActiveClaudeSessions — empty / missing layouts", () => {
  it("returns not-active when ~/.claude does not exist", async () => {
    const io = makeIO({ entries: {} });
    const r = await detectActiveClaudeSessions({ homeDir: HOME, io });
    expect(r.active).toBe(false);
    expect(r.count).toBe(0);
    expect(r.projectsDirExists).toBe(false);
  });

  it("returns not-active when ~/.claude/projects does not exist", async () => {
    const io = makeIO({
      entries: {
        [path.join(HOME, ".claude")]: { type: "dir" },
      },
    });
    const r = await detectActiveClaudeSessions({ homeDir: HOME, io });
    expect(r.active).toBe(false);
    expect(r.count).toBe(0);
    expect(r.projectsDirExists).toBe(false);
  });

  it("returns not-active when projects dir exists but is empty", async () => {
    const io = makeIO({
      entries: {
        [path.join(HOME, ".claude")]: { type: "dir" },
        [projectsRoot()]: { type: "dir" },
      },
    });
    const r = await detectActiveClaudeSessions({ homeDir: HOME, io });
    expect(r.active).toBe(false);
    expect(r.count).toBe(0);
    expect(r.projectsDirExists).toBe(true);
  });
});

describe("detectActiveClaudeSessions — recency detection", () => {
  it("detects a single session modified within threshold", async () => {
    const io = makeIO({
      entries: {
        [path.join(HOME, ".claude")]: { type: "dir" },
        [projectsRoot()]: { type: "dir" },
        [projectDir("proj-a")]: { type: "dir" },
        [sessionsDir("proj-a")]: { type: "dir" },
        [sessionFile("proj-a", "s1")]: {
          type: "file",
          mtimeMs: NOW_MS - 60_000, // 1 min ago
        },
      },
    });
    const r = await detectActiveClaudeSessions({ homeDir: HOME, io });
    expect(r.active).toBe(true);
    expect(r.count).toBe(1);
    expect(r.projectsDirExists).toBe(true);
  });

  it("does NOT activate on a stale session (older than threshold)", async () => {
    const io = makeIO({
      entries: {
        [path.join(HOME, ".claude")]: { type: "dir" },
        [projectsRoot()]: { type: "dir" },
        [projectDir("proj-a")]: { type: "dir" },
        [sessionsDir("proj-a")]: { type: "dir" },
        [sessionFile("proj-a", "s1")]: {
          type: "file",
          mtimeMs: NOW_MS - (FIVE_MIN_MS + 1000), // 5m1s ago
        },
      },
    });
    const r = await detectActiveClaudeSessions({ homeDir: HOME, io });
    expect(r.active).toBe(false);
    expect(r.count).toBe(0);
  });

  it("counts only the recently-modified sessions across many files", async () => {
    const io = makeIO({
      entries: {
        [path.join(HOME, ".claude")]: { type: "dir" },
        [projectsRoot()]: { type: "dir" },
        [projectDir("proj-a")]: { type: "dir" },
        [sessionsDir("proj-a")]: { type: "dir" },
        [sessionFile("proj-a", "s1")]: {
          type: "file",
          mtimeMs: NOW_MS - 30_000, // recent
        },
        [sessionFile("proj-a", "s2")]: {
          type: "file",
          mtimeMs: NOW_MS - (60 * 60 * 1000), // 1 hr ago
        },
        [sessionFile("proj-a", "s3")]: {
          type: "file",
          mtimeMs: NOW_MS - (10 * 60 * 1000), // 10 min ago
        },
      },
    });
    const r = await detectActiveClaudeSessions({ homeDir: HOME, io });
    expect(r.active).toBe(true);
    expect(r.count).toBe(1);
  });

  it("counts across multiple projects, only the recent ones", async () => {
    const io = makeIO({
      entries: {
        [path.join(HOME, ".claude")]: { type: "dir" },
        [projectsRoot()]: { type: "dir" },
        [projectDir("proj-a")]: { type: "dir" },
        [sessionsDir("proj-a")]: { type: "dir" },
        [sessionFile("proj-a", "s1")]: {
          type: "file",
          mtimeMs: NOW_MS - 30_000,
        },
        [projectDir("proj-b")]: { type: "dir" },
        [sessionsDir("proj-b")]: { type: "dir" },
        [sessionFile("proj-b", "s1")]: {
          type: "file",
          mtimeMs: NOW_MS - (2 * 60 * 60 * 1000),
        },
        [projectDir("proj-c")]: { type: "dir" },
        [sessionsDir("proj-c")]: { type: "dir" },
        [sessionFile("proj-c", "s1")]: {
          type: "file",
          mtimeMs: NOW_MS - 120_000,
        },
      },
    });
    const r = await detectActiveClaudeSessions({ homeDir: HOME, io });
    expect(r.active).toBe(true);
    expect(r.count).toBe(2);
  });
});

describe("detectActiveClaudeSessions — robustness", () => {
  it("returns not-active when listDir on projects/ throws", async () => {
    const io = makeIO({
      entries: {
        [path.join(HOME, ".claude")]: { type: "dir" },
        [projectsRoot()]: { type: "dir" },
      },
      listDirThrows: new Set([projectsRoot()]),
    });
    const r = await detectActiveClaudeSessions({ homeDir: HOME, io });
    expect(r.active).toBe(false);
    expect(r.count).toBe(0);
    expect(r.projectsDirExists).toBe(true);
  });

  it("skips a project whose sessions/ listDir throws", async () => {
    const io = makeIO({
      entries: {
        [path.join(HOME, ".claude")]: { type: "dir" },
        [projectsRoot()]: { type: "dir" },
        [projectDir("proj-a")]: { type: "dir" },
        [sessionsDir("proj-a")]: { type: "dir" },
        [projectDir("proj-b")]: { type: "dir" },
        [sessionsDir("proj-b")]: { type: "dir" },
        [sessionFile("proj-b", "s1")]: {
          type: "file",
          mtimeMs: NOW_MS - 30_000,
        },
      },
      listDirThrows: new Set([sessionsDir("proj-a")]),
    });
    const r = await detectActiveClaudeSessions({ homeDir: HOME, io });
    expect(r.active).toBe(true);
    expect(r.count).toBe(1);
  });

  it("skips a project with no sessions/ subdirectory", async () => {
    const io = makeIO({
      entries: {
        [path.join(HOME, ".claude")]: { type: "dir" },
        [projectsRoot()]: { type: "dir" },
        [projectDir("proj-a")]: { type: "dir" },
        // no sessions/ subdirectory
      },
    });
    const r = await detectActiveClaudeSessions({ homeDir: HOME, io });
    expect(r.active).toBe(false);
    expect(r.count).toBe(0);
  });

  it("ignores files that are not .jsonl", async () => {
    const io = makeIO({
      entries: {
        [path.join(HOME, ".claude")]: { type: "dir" },
        [projectsRoot()]: { type: "dir" },
        [projectDir("proj-a")]: { type: "dir" },
        [sessionsDir("proj-a")]: { type: "dir" },
        [path.join(sessionsDir("proj-a"), "s1.log")]: {
          type: "file",
          mtimeMs: NOW_MS - 30_000,
        },
        [path.join(sessionsDir("proj-a"), "s1.txt")]: {
          type: "file",
          mtimeMs: NOW_MS - 30_000,
        },
      },
    });
    const r = await detectActiveClaudeSessions({ homeDir: HOME, io });
    expect(r.active).toBe(false);
    expect(r.count).toBe(0);
  });

  it("treats stat returning null as a missing file (skipped, not error)", async () => {
    // Simulate race: listDir returned the name but stat failed.
    const io: SessionDetectionIO = {
      async listDir(p) {
        if (p === projectsRoot()) return ["proj-a"];
        if (p === projectDir("proj-a")) return ["sessions"];
        if (p === sessionsDir("proj-a")) return ["ghost.jsonl"];
        return [];
      },
      async stat(p) {
        if (p === path.join(HOME, ".claude")) return { mtimeMs: 0, isDirectory: true };
        if (p === projectsRoot()) return { mtimeMs: 0, isDirectory: true };
        if (p === projectDir("proj-a")) return { mtimeMs: 0, isDirectory: true };
        if (p === sessionsDir("proj-a")) return { mtimeMs: 0, isDirectory: true };
        if (p.endsWith("ghost.jsonl")) return null; // race deleted before stat
        return null;
      },
      now() {
        return NOW;
      },
    };
    const r = await detectActiveClaudeSessions({ homeDir: HOME, io });
    expect(r.active).toBe(false);
    expect(r.count).toBe(0);
  });
});

describe("detectActiveClaudeSessions — custom threshold", () => {
  it("respects a custom threshold (1-minute window)", async () => {
    const io = makeIO({
      entries: {
        [path.join(HOME, ".claude")]: { type: "dir" },
        [projectsRoot()]: { type: "dir" },
        [projectDir("proj-a")]: { type: "dir" },
        [sessionsDir("proj-a")]: { type: "dir" },
        [sessionFile("proj-a", "s1")]: {
          type: "file",
          mtimeMs: NOW_MS - 90_000, // 90 sec ago — within 5-min default, outside 1-min
        },
      },
    });
    const r5 = await detectActiveClaudeSessions({ homeDir: HOME, io });
    expect(r5.active).toBe(true); // default 5 min

    const r1 = await detectActiveClaudeSessions({
      homeDir: HOME,
      io,
      thresholdMs: 60_000,
    });
    expect(r1.active).toBe(false); // tighter window
  });
});
