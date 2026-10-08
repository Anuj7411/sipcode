/**
 * why / receipt on a resumed Claude Code session: the requests it copied from
 * the original file are counted once, in the original (the period commands'
 * rule), so the single-session report shows only this session's own spend.
 * Same for a Codex fork, which copies its parent's history.
 */
import { describe, expect, it } from "vitest";
import { InMemoryFs, type FileSystem } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import { FakeClipboard } from "../../src/lib/clipboard.js";
import { runWhy } from "../../src/commands/why.js";
import { runReceipt } from "../../src/commands/receipt.js";
import { runDriftCommand } from "../../src/commands/drift.js";
import type { StoreIO } from "../../src/modules/drift/store.js";
import { CODEX_SESSIONS, codexRollout, solTurn } from "./codex-fixtures.js";

const NOW = new Date("2026-05-19T12:00:00.000Z");
const DIR = "/home/u/.claude/projects/C--p";
const ms = (iso: string) => new Date(iso).getTime();

function req(id: string, ts: string, cacheRead: number, content: unknown[] = [{ type: "text", text: "." }]): string {
  return JSON.stringify({
    type: "assistant",
    requestId: `req_${id}`,
    timestamp: ts,
    sessionId: "s",
    cwd: "/w",
    message: {
      id: `msg_${id}`,
      model: "claude-opus-4-8",
      role: "assistant",
      content,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0 },
    },
  });
}

const readCall = (id: string) => [{ type: "tool_use", id, name: "Read", input: { file_path: "/w/a.ts" } }];
const readResult = (id: string, ts: string) =>
  JSON.stringify({
    type: "user",
    timestamp: ts,
    sessionId: "s",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "x".repeat(4_000) }] },
  });

const T1 = "2026-05-19T09:00:00.000Z";
const T2 = "2026-05-19T10:00:00.000Z";

/** orig: request 1 (reads a.ts). resumed: copies request 1, then request 2 reads a.ts again. */
function resumedFs(): InMemoryFs {
  const fs = new InMemoryFs();
  const r1 = [req("1", T1, 1_000_000, readCall("tu1")), readResult("tu1", T1)];
  fs.writeFile(`${DIR}/orig.jsonl`, r1.join("\n"), ms("2026-05-19T09:01:00Z"));
  fs.writeFile(
    `${DIR}/resumed.jsonl`,
    [...r1, req("2", T2, 2_000, readCall("tu2")), readResult("tu2", T2)].join("\n"),
    ms("2026-05-19T10:01:00Z"),
  );
  return fs;
}

function io() {
  const out: string[] = [];
  return {
    out,
    deps: {
      env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
      clock: new FakeClock(NOW),
      stdout: (s: string) => out.push(s),
      stderr: () => {},
    },
  };
}

async function whyJson(fs: FileSystem, opts: { session?: string } = {}) {
  const c = io();
  const r = await runWhy({ json: true, cwd: "/w", agent: "claude-code", ...opts }, { fs, ...c.deps });
  expect(r.exitCode).toBe(0);
  return JSON.parse(c.out.join("\n"));
}

describe("why on a resumed session", () => {
  it("counts only the session's own requests (the copied one belongs to the original)", async () => {
    const j = await whyJson(resumedFs());
    expect(j.punchline.totalTokens).toBe(2_000);
  });

  it("a read already made in the copied history makes the new read a re-read", async () => {
    const j = await whyJson(resumedFs());
    expect(j.duplicates).toEqual([{ filePath: "/w/a.ts", reads: 2, wastedTokens: 1_000 }]);
  });

  it("the original still reports everything it holds", async () => {
    const j = await whyJson(resumedFs(), { session: "orig" });
    expect(j.punchline.totalTokens).toBe(1_000_000);
  });

  it("a file in another project folder is never read (and cannot hold a copy)", async () => {
    const fs = resumedFs();
    fs.writeFile("/home/u/.claude/projects/C--other/x.jsonl", req("1", T1, 1_000_000), ms("2026-05-19T11:00:00Z"));
    const reads: string[] = [];
    const spy: FileSystem = Object.create(fs, {
      readFile: { value: async (p: string) => (reads.push(p), fs.readFile(p)) },
    });
    const j = await whyJson(spy, { session: "resumed" });
    expect(j.punchline.totalTokens).toBe(2_000);
    expect(reads.filter((p) => p.includes("C--other"))).toEqual([]);
  });

  it("a file last written before the session started is not read", async () => {
    const fs = resumedFs();
    fs.writeFile(`${DIR}/old.jsonl`, req("0", "2026-05-01T09:00:00.000Z", 5), ms("2026-05-01T09:01:00Z"));
    const reads: string[] = [];
    const spy: FileSystem = Object.create(fs, {
      readFile: { value: async (p: string) => (reads.push(p), fs.readFile(p)) },
    });
    await whyJson(spy);
    expect(reads.filter((p) => p.endsWith("old.jsonl"))).toEqual([]);
  });
});

describe("receipt on a resumed session", () => {
  it("the hero total is the session's own tokens", async () => {
    const c = io();
    const r = await runReceipt(
      { json: true, cwd: "/w", agent: "claude-code", htmlOnly: true, noShare: true },
      { fs: resumedFs(), ...c.deps, clipboard: new FakeClipboard(), writeFile: async () => {} },
    );
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(c.out.join("\n")).hero.tokens).toBe(2_000);
  });
});

describe("why on a Codex fork", () => {
  it("counts only the fork's own requests (the copied history belongs to the parent)", async () => {
    const fs = new InMemoryFs();
    const parent = codexRollout("p1", "C:\\p", [solTurn("2026-05-10T10:00:00Z", 500_000, 100)]);
    fs.writeFile(`${CODEX_SESSIONS}/2026/05/10/rollout-p1.jsonl`, parent, ms("2026-05-10T10:01:00Z"));
    // The fork runs in another folder and restamps the copied history: its
    // own session_meta, the parent's lines, then one request of its own.
    const meta = JSON.stringify({
      timestamp: "2026-05-11T09:59:00Z",
      type: "session_meta",
      payload: { id: "f1", session_id: "f1", forked_from_id: "p1", cwd: "C:\\q" },
    });
    const copied = parent.split("\n").map((l) => l.replace(/2026-05-10T10:00:00Z/g, "2026-05-11T09:59:00Z"));
    const own = codexRollout("f1", "C:\\q", [solTurn("2026-05-11T10:00:00Z", 3_000, 30)]).split("\n").slice(1);
    fs.writeFile(
      `${CODEX_SESSIONS}/2026/05/11/rollout-f1.jsonl`,
      [meta, ...copied, ...own].join("\n"),
      ms("2026-05-11T10:01:00Z"),
    );
    const c = io();
    const r = await runWhy({ json: true, cwd: "/w", agent: "codex", session: "f1" }, { fs, ...c.deps });
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(c.out.join("\n")).punchline.totalTokens).toBe(3_030);
  });
});


/**
 * A session resumed a moment ago: Claude Code copied the original's requests
 * and the user typed a prompt, but no reply has been logged yet. Every request
 * it holds belongs to the original, so it has nothing of its own to report.
 */
function copiedOnlyFs(): InMemoryFs {
  const fs = new InMemoryFs();
  const r1 = [req("1", T1, 1_000_000, readCall("tu1")), readResult("tu1", T1)];
  fs.writeFile(`${DIR}/orig.jsonl`, r1.join("\n"), ms("2026-05-19T09:01:00Z"));
  const prompt = JSON.stringify({
    type: "user",
    timestamp: T2,
    sessionId: "s",
    message: { role: "user", content: [{ type: "text", text: "go on" }] },
  });
  fs.writeFile(`${DIR}/copied.jsonl`, [...r1, prompt].join("\n"), ms("2026-05-19T10:01:00Z"));
  return fs;
}

function memStoreIO(): StoreIO {
  const files = new Map<string, string>();
  return {
    async read(p) {
      return files.get(p) ?? null;
    },
    async write(p, c) {
      files.set(p, c);
    },
    async append(p, c) {
      files.set(p, (files.get(p) ?? "") + c);
    },
  };
}

describe("auto-pick skips a resumed session that is all copied history", () => {
  it("why reports the original, not the copy", async () => {
    const j = await whyJson(copiedOnlyFs());
    expect(j.punchline.totalTokens).toBe(1_000_000);
  });

  it("why --session still shows the copy when asked for it", async () => {
    const j = await whyJson(copiedOnlyFs(), { session: "copied" });
    expect(j.punchline.totalTokens).toBe(0);
  });

  it("receipt reports the original", async () => {
    const c = io();
    const r = await runReceipt(
      { json: true, cwd: "/w", agent: "claude-code", htmlOnly: true, noShare: true },
      { fs: copiedOnlyFs(), ...c.deps, clipboard: new FakeClipboard(), writeFile: async () => {} },
    );
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(c.out.join("\n")).hero.tokens).toBe(1_000_000);
  });

  it("drift checks the original", async () => {
    const c = io();
    const r = await runDriftCommand(
      { json: true, cwd: "/w", agent: "claude-code" },
      { fs: copiedOnlyFs(), ...c.deps, now: NOW, homeDir: "/home/u", stateDir: "/state", storeIO: memStoreIO(), configPaths: [], configReader: async () => null },
    );
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(c.out.join("\n")).latest.sessionId).toBe("orig");
  });
});
