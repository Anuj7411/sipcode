import { describe, expect, it } from "vitest";
import { InMemoryFs, type FileSystem } from "../../../../src/lib/fs.js";
import { FakeProcessEnv } from "../../../../src/lib/process.js";
import { listCodexSessions, resolveCodexHome } from "../../../../src/modules/agents/codex/discover.js";

const meta = (id: string, cwd: string) => JSON.stringify({ timestamp: "2026-10-01T10:00:00Z", type: "session_meta", payload: { id, session_id: id, cwd, cli_version: "0.160.0" } });
const turn = JSON.stringify({ timestamp: "2026-10-01T10:00:01Z", type: "event_msg", payload: { type: "token_count", info: null } });

/** Wraps a FileSystem, counting full reads and optionally failing some paths. */
function spyFs(base: FileSystem, fail: (p: string, op: string) => boolean = () => false) {
  const calls = { readFile: 0, readHead: 0, headSizes: [] as number[] };
  const guard = (p: string, op: string) => {
    if (fail(p.replace(/\\/g, "/"), op)) throw Object.assign(new Error(`EACCES: ${p}`), { code: "EACCES" });
  };
  const fs: FileSystem = {
    exists: (p) => base.exists(p),
    readFile: async (p) => {
      calls.readFile++;
      guard(p, "readFile");
      return base.readFile(p);
    },
    readHead: async (p, n) => {
      calls.readHead++;
      calls.headSizes.push(n);
      guard(p, "readHead");
      return base.readHead(p, n);
    },
    readDir: async (p) => {
      guard(p, "readDir");
      return base.readDir(p);
    },
    stat: async (p) => {
      guard(p, "stat");
      return base.stat(p);
    },
  };
  return { fs, calls };
}

describe("Codex discovery", () => {
  it("uses CODEX_HOME when set", () => {
    expect(resolveCodexHome(new FakeProcessEnv({ homeDir: "/h", vars: { CODEX_HOME: "/c" } }))).toBe("/c");
    expect(resolveCodexHome(new FakeProcessEnv({ homeDir: "/h" }))).toMatch(/[\\/]h[\\/]\.codex$/);
  });

  it("finds rollouts in sessions and archived_sessions, preferring sessions for the same file", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/c/sessions/2026/10/01/rollout-2026-10-01T10-00-00-aaa.jsonl", meta("aaa", "C:\\p"), 3);
    fs.writeFile("/c/archived_sessions/rollout-2026-10-01T10-00-00-aaa.jsonl", meta("aaa", "C:\\old"), 1);
    fs.writeFile("/c/archived_sessions/rollout-2026-09-01T10-00-00-bbb.jsonl", meta("bbb", "C:\\q"), 2);
    fs.writeFile("/c/sessions/2026/10/01/rollout-2026-10-01T11-00-00-ccc.jsonl.zst", "binary", 4);
    fs.writeFile("/c/sessions/2026/10/01/notes.txt", "x", 5);
    const r = await listCodexSessions(fs, "/c");
    expect(r.sessions.map((s) => [s.sessionId, s.cwd])).toEqual([["aaa", "C:\\p"], ["bbb", "C:\\q"]]);
    expect(r.skippedCompressed).toBe(1);
    expect(r.compressedFiles.map((f) => f.replace(/\\/g, "/"))).toEqual([
      "/c/sessions/2026/10/01/rollout-2026-10-01T11-00-00-ccc.jsonl.zst",
    ]);
    expect(r.unreadable).toBe(0);
  });

  it("returns nothing when the folder does not exist", async () => {
    const r = await listCodexSessions(new InMemoryFs(), "/none");
    expect(r.sessions).toEqual([]);
    expect(r.unreadable).toBe(0);
    expect(r.unreadableFolders).toBe(0);
    expect(r.skippedCompressed).toBe(0);
  });

  it("a missing archived_sessions folder is not an error", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/c/sessions/2026/10/01/rollout-a.jsonl", meta("a", "/p"), 1);
    const r = await listCodexSessions(fs, "/c");
    expect(r.sessions.map((s) => s.sessionId)).toEqual(["a"]);
    expect(r.unreadable).toBe(0);
  });

  it("counts a folder that cannot be listed as unreadable", async () => {
    const mem = new InMemoryFs();
    mem.writeFile("/c/sessions/2026/10/01/rollout-a.jsonl", meta("a", "/p"), 1);
    mem.writeFile("/c/sessions/2026/10/02/rollout-b.jsonl", meta("b", "/p"), 2);
    const { fs } = spyFs(mem, (p, op) => op === "readDir" && p.endsWith("/10/02"));
    const r = await listCodexSessions(fs, "/c");
    expect(r.sessions.map((s) => s.sessionId)).toEqual(["a"]);
    expect(r.unreadableFolders).toBe(1);
    expect(r.unreadable).toBe(0);
  });

  it("counts a rollout whose first line cannot be read as unreadable", async () => {
    const mem = new InMemoryFs();
    mem.writeFile("/c/sessions/2026/10/01/rollout-a.jsonl", meta("a", "/p"), 1);
    mem.writeFile("/c/sessions/2026/10/01/rollout-b.jsonl", meta("b", "/p"), 2);
    const { fs } = spyFs(mem, (p, op) => op === "readHead" && p.endsWith("rollout-b.jsonl"));
    const r = await listCodexSessions(fs, "/c");
    expect(r.sessions.map((s) => s.sessionId)).toEqual(["a"]);
    expect(r.unreadable).toBe(1);
    expect(r.unreadableFolders).toBe(0);
  });

  it("reads only the head of each rollout, not the whole file", async () => {
    const mem = new InMemoryFs();
    mem.writeFile("/c/sessions/2026/10/01/rollout-a.jsonl", [meta("a", "/p"), turn, turn].join("\n"), 1);
    const { fs, calls } = spyFs(mem);
    const r = await listCodexSessions(fs, "/c");
    expect(r.sessions.map((s) => [s.sessionId, s.cwd])).toEqual([["a", "/p"]]);
    expect(calls.readFile).toBe(0);
    expect(calls.headSizes).toEqual([64 * 1024]);
  });

  const bigMeta = (id: string, chars: number) =>
    JSON.stringify({
      type: "session_meta",
      payload: { id, cwd: "/p", base_instructions: { text: "é".repeat(chars) } },
    });

  it("doubles the head window from 64 KiB until line 1 ends", async () => {
    const mem = new InMemoryFs();
    const line1 = bigMeta("mid", 50_000); // ~100 KB: past 64 KiB, inside 128 KiB
    mem.writeFile("/c/sessions/2026/10/01/rollout-mid.jsonl", [line1, turn].join("\n"), 1);
    const { fs, calls } = spyFs(mem);
    const r = await listCodexSessions(fs, "/c");
    expect(r.sessions.map((s) => [s.sessionId, s.cwd])).toEqual([["mid", "/p"]]);
    expect(calls.headSizes).toEqual([64 * 1024, 128 * 1024]);
    expect(calls.readFile).toBe(0);
  });

  it("does not re-read a one-line rollout shorter than the head window", async () => {
    const mem = new InMemoryFs();
    mem.writeFile("/c/sessions/2026/10/01/rollout-one.jsonl", meta("one", "/p"), 1);
    const { fs, calls } = spyFs(mem);
    const r = await listCodexSessions(fs, "/c");
    expect(r.sessions.map((s) => s.sessionId)).toEqual(["one"]);
    expect(calls.headSizes).toEqual([64 * 1024]);
    expect(calls.readFile).toBe(0);
  });

  it("falls back to a full read when line 1 is longer than 4 MiB", async () => {
    const mem = new InMemoryFs();
    const big = bigMeta("big", 2_200_000);
    expect(Buffer.byteLength(big)).toBeGreaterThan(4 * 1024 * 1024);
    mem.writeFile("/c/sessions/2026/10/01/rollout-big.jsonl", [big, turn].join("\n"), 1);
    const { fs, calls } = spyFs(mem);
    const r = await listCodexSessions(fs, "/c");
    expect(r.sessions.map((s) => [s.sessionId, s.cwd])).toEqual([["big", "/p"]]);
    expect(calls.headSizes).toEqual([64, 128, 256, 512, 1024, 2048, 4096].map((k) => k * 1024));
    expect(calls.readFile).toBe(1);
  });

  it("falls back to the file name when line 1 is not session_meta", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/c/sessions/2026/10/01/rollout-2026-10-01T10-00-00-zzz.jsonl", turn, 1);
    const r = await listCodexSessions(fs, "/c");
    expect(r.sessions.map((s) => [s.sessionId, s.cwd, s.projectHash])).toEqual([
      ["rollout-2026-10-01T10-00-00-zzz", undefined, "(unknown)"],
    ]);
  });

  it("sorts most recent first and records size and mtime", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/c/sessions/2026/09/01/rollout-old.jsonl", meta("old", "/p"), 10);
    fs.writeFile("/c/sessions/2026/10/01/rollout-new.jsonl", meta("new", "/p"), 20);
    const r = await listCodexSessions(fs, "/c");
    expect(r.sessions.map((s) => [s.sessionId, s.mtimeMs, s.size])).toEqual([
      ["new", 20, meta("new", "/p").length],
      ["old", 10, meta("old", "/p").length],
    ]);
  });
});
