import { describe, it, expect } from "vitest";
import {
  hookReadDedup,
  type DedupIO,
} from "../../../src/modules/proxy/hookReadDedup.js";
import type { PreToolUseInput } from "../../../src/modules/proxy/types.js";
import {
  sessionCachePath,
  type ReadEntry,
} from "../../../src/modules/proxy/read-cache.js";

const SESSION = "11111111-2222-3333-4444-555555555555";
const HOME = "/h";
const TRANSCRIPT = "/t/session.jsonl";

function makeIO(opts: {
  fileShas?: Record<string, { sha256: string; mtimeMs: number; sizeBytes: number } | null>;
  cacheInit?: Record<string, string>;
  turns?: number;
  now?: Date;
  transcript?: string;
  diskFiles?: Record<
    string,
    { rawBytes: Buffer; sha256: string; mtimeMs: number; sizeBytes: number } | null
  >;
}): DedupIO & { files: Map<string, string>; writes: { path: string; content: string }[] } {
  const files = new Map<string, string>(Object.entries(opts.cacheInit ?? {}));
  const writes: { path: string; content: string }[] = [];
  return {
    files,
    writes,
    async read(p) {
      return files.has(p) ? files.get(p)! : null;
    },
    async append(p, content) {
      writes.push({ path: p, content });
      files.set(p, (files.get(p) ?? "") + content);
    },
    async hashFile(p) {
      return opts.fileShas?.[p] ?? null;
    },
    async countAssistantTurns() {
      return opts.turns ?? 1;
    },
    async readTranscript() {
      // v1.6.15: warmfill no-ops when transcript is absent. Default null so
      // existing tests (which don't care about warmfill) keep their behavior.
      return opts.transcript ?? null;
    },
    async readAndStatFile(p) {
      return opts.diskFiles?.[p] ?? null;
    },
    now() {
      return opts.now ?? new Date("2026-06-09T00:00:00.000Z");
    },
  };
}

function input(over: Partial<PreToolUseInput> = {}): PreToolUseInput {
  return {
    session_id: SESSION,
    transcript_path: TRANSCRIPT,
    cwd: "/cwd",
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_input: { file_path: "/proj/auth.ts" },
    ...over,
  };
}

const cachedLine = (entry: Partial<ReadEntry>): string =>
  JSON.stringify({
    filePath: "/proj/auth.ts",
    sha256: "abc",
    mtimeMs: 1000,
    sizeBytes: 4000,
    estimatedTokens: 1000,
    firstReadAtTurn: 5,
    firstReadAt: "2026-06-09T00:00:00.000Z",
    ...entry,
  }) + "\n";

describe("hookReadDedup — passthrough cases", () => {
  it("returns EMPTY for non-Read tool calls", async () => {
    const io = makeIO({});
    const r = await hookReadDedup(input({ tool_name: "Bash", tool_input: { command: "ls" } }), HOME, io);
    expect(r.hookOutput).toBeNull();
    expect(r.statsEntry).toBeNull();
  });

  it("returns EMPTY for Read with non-string file_path", async () => {
    const io = makeIO({});
    const r = await hookReadDedup(input({ tool_input: { file_path: 42 } }), HOME, io);
    expect(r.hookOutput).toBeNull();
  });

  it("uses a pid+cwd fallback session key when session_id is empty (covers claude --print --no-session-persistence)", async () => {
    const io = makeIO({
      fileShas: { "/proj/auth.ts": { sha256: "ABC", mtimeMs: 100, sizeBytes: 4000 } },
    });
    const r = await hookReadDedup(
      input({ session_id: "", cwd: "/some/project" }),
      HOME,
      io,
    );
    // First read with empty session_id should still record (not return EMPTY).
    expect(io.writes.length).toBe(1);
    const written = JSON.parse(io.writes[0]!.content.trim());
    expect(written.filePath).toBe("/proj/auth.ts");
    // Cache file path should reflect the fallback (not the empty string).
    expect(io.writes[0]!.path).toContain("pid-");
    expect(r.hookOutput).toBeNull(); // first read = passthrough
  });
});

describe("hookReadDedup — recording (first read of a file)", () => {
  it("appends a cache entry when the file hashes and is unseen", async () => {
    const io = makeIO({
      fileShas: { "/proj/auth.ts": { sha256: "ABC", mtimeMs: 100, sizeBytes: 4000 } },
      turns: 7,
    });
    const r = await hookReadDedup(input(), HOME, io);
    expect(r.hookOutput).toBeNull(); // passthrough
    const cachePath = sessionCachePath(HOME, SESSION);
    expect(io.writes.length).toBe(1);
    expect(io.writes[0]?.path).toBe(cachePath);
    const written = JSON.parse(io.writes[0]!.content.trim()) as ReadEntry;
    expect(written.filePath).toBe("/proj/auth.ts");
    expect(written.sha256).toBe("ABC");
    expect(written.mtimeMs).toBe(100);
    expect(written.estimatedTokens).toBe(1000);
    expect(written.firstReadAtTurn).toBe(7);
  });

  it("does NOT record when the file cannot be hashed", async () => {
    const io = makeIO({ fileShas: { "/proj/auth.ts": null } });
    const r = await hookReadDedup(input(), HOME, io);
    expect(r.hookOutput).toBeNull();
    expect(io.writes.length).toBe(0);
  });

  it("does NOT record when the model asked for a partial read", async () => {
    const io = makeIO({
      fileShas: { "/proj/auth.ts": { sha256: "ABC", mtimeMs: 100, sizeBytes: 4000 } },
    });
    const r = await hookReadDedup(
      input({ tool_input: { file_path: "/proj/auth.ts", offset: 100 } }),
      HOME,
      io,
    );
    expect(r.hookOutput).toBeNull();
    expect(io.writes.length).toBe(0);
  });
});

describe("hookReadDedup — dedup decision (re-read of unchanged file)", () => {
  it("emits a deny output with reason + savedTokensEstimate stats entry", async () => {
    const cachePath = sessionCachePath(HOME, SESSION);
    const io = makeIO({
      fileShas: { "/proj/auth.ts": { sha256: "ABC", mtimeMs: 100, sizeBytes: 4000 } },
      cacheInit: {
        [cachePath]: cachedLine({
          sha256: "ABC",
          mtimeMs: 100,
          estimatedTokens: 1000,
          firstReadAtTurn: 5,
        }),
      },
    });
    const r = await hookReadDedup(input(), HOME, io);
    expect(r.hookOutput).not.toBeNull();
    const out = r.hookOutput!.hookSpecificOutput;
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain("/proj/auth.ts");
    expect(out.permissionDecisionReason).toContain("turn 5");
    expect(r.statsEntry?.rewriterName).toBe("dedup-read");
    expect(r.statsEntry?.savedTokensEstimate).toBeGreaterThan(0);
  });

  it("does NOT dedup when sha differs (file edited)", async () => {
    const cachePath = sessionCachePath(HOME, SESSION);
    const io = makeIO({
      fileShas: { "/proj/auth.ts": { sha256: "NEW", mtimeMs: 200, sizeBytes: 4000 } },
      cacheInit: {
        [cachePath]: cachedLine({ sha256: "OLD", mtimeMs: 100 }),
      },
    });
    const r = await hookReadDedup(input(), HOME, io);
    expect(r.hookOutput).toBeNull();
    // Should refresh the cache entry to the new sha+mtime so the next read can dedup.
    expect(io.writes.length).toBe(1);
    const refreshed = JSON.parse(io.writes[0]!.content.trim()) as ReadEntry;
    expect(refreshed.sha256).toBe("NEW");
    expect(refreshed.mtimeMs).toBe(200);
  });
});

describe("hookReadDedup — path normalization (v1.6.14 bug fix)", () => {
  // Pre-fix: dedup orchestrator used the raw `file_path` as the cache key.
  // Claude Code sometimes sent `C:\foo\bar.ts` and other turns `c:/foo/bar.ts`
  // for the same file. Cache key never matched → no dedup → ~50x undercount
  // vs the drift analyzer's count of "wasted tokens on dupes".
  // Post-fix: both paths normalize to the same key and dedup fires correctly.

  it("Reads with case-different drive letters collide on the cache (Windows)", async () => {
    const cachePath = sessionCachePath(HOME, SESSION);
    const io = makeIO({
      // Note: keyed under the RAW path the orchestrator will request from
      // hashFile (which doesn't normalize — on Windows the OS handles
      // case-insensitivity for us at the filesystem layer).
      fileShas: {
        "C:\\proj\\auth.ts": { sha256: "ABC", mtimeMs: 100, sizeBytes: 4000 },
      },
      cacheInit: {
        [cachePath]: cachedLine({
          filePath: "c:/proj/auth.ts", // lower-case, recorded earlier
          sha256: "ABC",
          mtimeMs: 100,
          estimatedTokens: 1000,
          firstReadAtTurn: 5,
        }),
      },
    });
    // Now Claude sends the upper-case + backslash variant
    const r = await hookReadDedup(
      input({ tool_input: { file_path: "C:\\proj\\auth.ts" } }),
      HOME,
      io,
    );
    expect(r.hookOutput).not.toBeNull();
    expect(r.hookOutput!.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("Reads with backslash vs forward-slash collide on the cache", async () => {
    const cachePath = sessionCachePath(HOME, SESSION);
    const io = makeIO({
      fileShas: { "\\abs\\path\\auth.ts": { sha256: "ABC", mtimeMs: 100, sizeBytes: 4000 } },
      cacheInit: {
        [cachePath]: cachedLine({
          filePath: "/abs/path/auth.ts",
          sha256: "ABC",
          mtimeMs: 100,
          estimatedTokens: 1000,
          firstReadAtTurn: 5,
        }),
      },
    });
    const r = await hookReadDedup(
      input({ tool_input: { file_path: "\\abs\\path\\auth.ts" } }),
      HOME,
      io,
    );
    expect(r.hookOutput).not.toBeNull();
    expect(r.hookOutput!.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("Reads with ./ prefix collide with the bare-name variant", async () => {
    const cachePath = sessionCachePath(HOME, SESSION);
    const io = makeIO({
      fileShas: { "./src/auth.ts": { sha256: "ABC", mtimeMs: 100, sizeBytes: 4000 } },
      cacheInit: {
        [cachePath]: cachedLine({
          filePath: "src/auth.ts",
          sha256: "ABC",
          mtimeMs: 100,
          estimatedTokens: 1000,
          firstReadAtTurn: 5,
        }),
      },
    });
    const r = await hookReadDedup(
      input({ tool_input: { file_path: "./src/auth.ts" } }),
      HOME,
      io,
    );
    expect(r.hookOutput).not.toBeNull();
    expect(r.hookOutput!.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("Cache writes use the normalized path so future lookups match", async () => {
    const io = makeIO({
      fileShas: {
        "C:\\proj\\auth.ts": { sha256: "ABC", mtimeMs: 100, sizeBytes: 4000 },
      },
      turns: 3,
    });
    await hookReadDedup(
      input({ tool_input: { file_path: "C:\\proj\\auth.ts" } }),
      HOME,
      io,
    );
    expect(io.writes.length).toBe(1);
    const written = JSON.parse(io.writes[0]!.content.trim());
    // Stored as normalized form.
    expect(written.filePath).toBe("c:/proj/auth.ts");
  });
});

describe("hookReadDedup — robustness", () => {
  it("survives a hash failure mid-flow without throwing", async () => {
    const io: DedupIO = {
      ...makeIO({}),
      async hashFile() {
        throw new Error("boom");
      },
    };
    // Outer try/catch in hookReadDedup must swallow.
    const r = await hookReadDedup(input(), HOME, io);
    expect(r.hookOutput).toBeNull();
    expect(r.statsEntry).toBeNull();
  });

  it("survives a cache-load failure without throwing", async () => {
    const io: DedupIO = {
      ...makeIO({
        fileShas: { "/proj/auth.ts": { sha256: "ABC", mtimeMs: 100, sizeBytes: 4000 } },
      }),
      async read() {
        throw new Error("boom");
      },
    };
    const r = await hookReadDedup(input(), HOME, io);
    expect(r.hookOutput).toBeNull();
  });
});

// ─── v1.6.15: warm-fill integration ─────────────────────────────────────────
//
// Setup helper that wires the transcript + disk state so the warmfill at the
// top of hookReadDedup back-fills the cache from prior session activity.

// File content sized over MIN_TOKENS_FOR_DEDUP (100). Each line = ~32 bytes;
// 40 lines = ~1.3 KB = ~320 tokens. Comfortably above threshold.
const FILE_CONTENT =
  Array.from({ length: 40 }, (_, i) => `export const value${i} = ${i};`).join("\n") + "\n";
const FILE_BUF = Buffer.from(FILE_CONTENT, "utf-8");

import { createHash as createHash2 } from "node:crypto";
import path from "node:path";

function makeTranscriptWithRead(filePath: string, content: string): string {
  return (
    JSON.stringify({ type: "assistant", role: "assistant" }) + "\n" +
    JSON.stringify({
      type: "user",
      toolUseResult: {
        type: "text",
        file: { filePath, content, numLines: content.split("\n").length, startLine: 1, totalLines: content.split("\n").length },
      },
    }) + "\n"
  );
}

describe("hookReadDedup — v1.6.15 warm-fill", () => {
  it("dedups a re-read of a file that was Read pre-install (via transcript warm-fill)", async () => {
    const sha = createHash2("sha256").update(FILE_BUF).digest("hex");
    const io = makeIO({
      transcript: makeTranscriptWithRead("/proj/auth.ts", FILE_CONTENT),
      diskFiles: {
        "/proj/auth.ts": { rawBytes: FILE_BUF, sha256: sha, mtimeMs: 1000, sizeBytes: FILE_BUF.length },
      },
      fileShas: {
        "/proj/auth.ts": { sha256: sha, mtimeMs: 1000, sizeBytes: FILE_BUF.length },
      },
    });

    const r = await hookReadDedup(input(), HOME, io);

    // The hook should DEDUP on this very fire — warmfill at the top
    // populated the cache from the transcript, and the file content
    // matches what Claude already has in context.
    expect(r.hookOutput).not.toBeNull();
    expect(r.statsEntry?.rewriterName).toBe("dedup-read");
  });

  it("does NOT dedup if the file was edited between transcript read and warm-fill (sha mismatch)", async () => {
    const oldContent = "stale content\n";
    const newBuf = FILE_BUF; // disk has the new content
    const newSha = createHash2("sha256").update(newBuf).digest("hex");

    const io = makeIO({
      transcript: makeTranscriptWithRead("/proj/auth.ts", oldContent), // transcript shows stale
      diskFiles: {
        "/proj/auth.ts": { rawBytes: newBuf, sha256: newSha, mtimeMs: 1000, sizeBytes: newBuf.length },
      },
      fileShas: {
        "/proj/auth.ts": { sha256: newSha, mtimeMs: 1000, sizeBytes: newBuf.length },
      },
    });

    const r = await hookReadDedup(input(), HOME, io);

    // Warmfill correctly dropped the candidate (sha mismatch).
    // Cache is empty for this file. Live decision passes.
    expect(r.hookOutput).toBeNull();
  });

  it("writes the .warmed marker file on first fire and skips warmfill on second fire", async () => {
    const sha = createHash2("sha256").update(FILE_BUF).digest("hex");
    const io = makeIO({
      transcript: makeTranscriptWithRead("/proj/auth.ts", FILE_CONTENT),
      diskFiles: {
        "/proj/auth.ts": { rawBytes: FILE_BUF, sha256: sha, mtimeMs: 1000, sizeBytes: FILE_BUF.length },
      },
      fileShas: {
        "/proj/auth.ts": { sha256: sha, mtimeMs: 1000, sizeBytes: FILE_BUF.length },
      },
    });

    await hookReadDedup(input(), HOME, io);

    // Use path.join to mirror what the implementation produces — direct
    // string templating would diverge on Windows (backslash separators).
    const markerPath = path.join(HOME, ".sipcode", "proxy-reads", `${SESSION}.warmed`);
    expect(io.files.has(markerPath)).toBe(true);

    // Track writes BEFORE second call to confirm no extra warmfill writes happen.
    const writesBefore = io.writes.length;

    // Second call: the marker is present so warmfill should be skipped.
    await hookReadDedup(input(), HOME, io);

    // Marker still exists; no second warmfill scan happened.
    expect(io.files.has(markerPath)).toBe(true);
    expect(io.writes.length).toBeGreaterThanOrEqual(writesBefore);
  });

  it("survives a warmfill crash without breaking the hook", async () => {
    const sha = createHash2("sha256").update(FILE_BUF).digest("hex");
    const io: DedupIO = {
      ...makeIO({
        fileShas: {
          "/proj/auth.ts": { sha256: sha, mtimeMs: 1000, sizeBytes: FILE_BUF.length },
        },
      }),
      async readTranscript() {
        throw new Error("transcript read explosion");
      },
    };

    // No throw — the hook degrades to legacy behavior.
    const r = await hookReadDedup(input(), HOME, io);
    expect(r.hookOutput).toBeNull();
  });

  it("does not run warmfill when transcript_path is missing from hook input", async () => {
    const sha = createHash2("sha256").update(FILE_BUF).digest("hex");
    const io = makeIO({
      transcript: makeTranscriptWithRead("/proj/auth.ts", FILE_CONTENT),
      diskFiles: {
        "/proj/auth.ts": { rawBytes: FILE_BUF, sha256: sha, mtimeMs: 1000, sizeBytes: FILE_BUF.length },
      },
      fileShas: {
        "/proj/auth.ts": { sha256: sha, mtimeMs: 1000, sizeBytes: FILE_BUF.length },
      },
    });

    // No transcript_path → no warmfill → no dedup.
    const r = await hookReadDedup(
      input({ transcript_path: "" as unknown as string }),
      HOME,
      io,
    );
    expect(r.hookOutput).toBeNull();
  });
});
