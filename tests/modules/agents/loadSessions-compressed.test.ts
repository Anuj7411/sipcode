/** loadSessions reads Codex's compressed rollouts (.jsonl.zst) through every path: parse, key scan, cache. */
import { afterEach, describe, expect, it } from "vitest";
import zlib from "node:zlib";
import { InMemoryFs } from "../../../src/lib/fs.js";
import { FakeClock } from "../../../src/lib/clock.js";
import { FakeProcessEnv } from "../../../src/lib/process.js";
import { setZstdCodecForTests } from "../../../src/lib/zstd.js";
import { codexAgent } from "../../../src/modules/agents/codex/adapter.js";
import { loadSessions } from "../../../src/modules/agents/loadSessions.js";
import { memCache } from "./memCache.js";

const zst = (s: string): Buffer => (zlib as unknown as { zstdCompressSync: (b: Buffer) => Buffer }).zstdCompressSync(Buffer.from(s, "utf8"));
const deps = (fs: InMemoryFs) => ({
  fs,
  env: new FakeProcessEnv({ homeDir: "/h", vars: { CODEX_HOME: "/c" } }),
  clock: new FakeClock(new Date("2026-10-08")),
});

const line = (o: unknown) => JSON.stringify(o);
const metaLine = (id: string, at: string) => line({ timestamp: at, type: "session_meta", payload: { id, session_id: id, cwd: "/p", cli_version: "0.160.0" } });
const request = (rid: string, at: string, input: number) => [
  line({ timestamp: at, type: "turn_context", payload: { turn_id: `t-${rid}`, model: "gpt-5.5" } }),
  line({
    timestamp: at,
    type: "token_usage_record",
    payload: {
      turn_id: `t-${rid}`,
      response_id: rid,
      usage: { input_tokens: input, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: input + 10 },
    },
  }),
];
const rollout = (id: string, at: string, ...reqs: string[][]) => [metaLine(id, at), ...reqs.flat()].join("\n") + "\n";

const OLD_AT = "2026-10-01T10:00:00Z";
const NEW_AT = "2026-10-07T10:00:00Z";
/** The original (old, compressed) and a resumed copy in the window that repeats r1 and adds r2. */
function resumedHome(compressOriginal: boolean): InMemoryFs {
  const fs = new InMemoryFs();
  const original = rollout("orig", OLD_AT, request("r1", OLD_AT, 1000));
  const resumed = rollout("orig", OLD_AT, request("r1", OLD_AT, 1000), request("r2", NEW_AT, 500));
  if (compressOriginal) fs.writeBytes("/c/sessions/2026/10/01/rollout-orig.jsonl.zst", zst(original), Date.parse(OLD_AT) + 60_000);
  else fs.writeFile("/c/sessions/2026/10/01/rollout-orig.jsonl", original, Date.parse(OLD_AT) + 60_000);
  fs.writeFile("/c/sessions/2026/10/07/rollout-resumed.jsonl", resumed, Date.parse(NEW_AT) + 60_000);
  return fs;
}

afterEach(() => setZstdCodecForTests(undefined));

const turns = (fs: InMemoryFs, windowSinceMs?: number) =>
  loadSessions({
    agent: codexAgent,
    deps: deps(fs),
    cwd: "/",
    windowSinceMs,
    analyze: (s) => s.parsed.assistantTurns.map((t) => `${t.requestKey}:${t.inputTokens}`),
  });

describe("loadSessions with compressed Codex rollouts", () => {
  it("parses a compressed rollout exactly like the plain one", async () => {
    const plain = await turns(resumedHome(false));
    const compressed = await turns(resumedHome(true));
    if (!plain.ok || !compressed.ok) throw new Error("load failed");
    expect(compressed.value.sessions.map((s) => s.value)).toEqual(plain.value.sessions.map((s) => s.value));
    expect(compressed.value.sessions.map((s) => s.value)).toEqual([["r2:500"], ["r1:1000"]]);
    expect(compressed.value.unreadable).toBe(0);
  });

  it("key scan: a compressed original outside the window still keeps the requests it holds", async () => {
    const since = Date.parse("2026-10-05T00:00:00Z");
    const r = await turns(resumedHome(true), since);
    if (!r.ok) throw new Error("load failed");
    // Only the resumed log is returned; r1 belongs to the original (read by key scan only).
    expect(r.value.sessions.map((s) => s.value)).toEqual([["r2:500"]]);
    expect(r.value.scannedOnly).toBe(1);
    expect(r.value.droppedDuplicateRequests).toBe(1);
    expect(r.value.unreadable).toBe(0);
  });

  it("usage cache: a compressed rollout is cached and then served without decoding it again", async () => {
    const cache = memCache();
    const fs = new InMemoryFs();
    fs.writeBytes("/c/sessions/2026/10/01/rollout-orig.jsonl.zst", zst(rollout("orig", OLD_AT, request("r1", OLD_AT, 1000))), 5);
    fs.writeFile("/c/sessions/2026/10/07/rollout-new.jsonl", rollout("new", NEW_AT, request("r2", NEW_AT, 500)), 6);
    let fullReads = 0;
    const spy = Object.create(fs, {
      readBytes: { value: async (p: string) => (p.endsWith(".zst") && fullReads++, fs.readBytes(p)) },
    }) as InMemoryFs;
    const run = () =>
      loadSessions({ agent: codexAgent, deps: deps(spy), cwd: "/", cache, analyze: (s) => s.parsed.assistantTurns.length });
    const cold = await run();
    expect(cache.text).toContain("rollout-orig.jsonl.zst");
    const coldReads = fullReads;
    const warm = await run();
    if (!cold.ok || !warm.ok) throw new Error("load failed");
    expect(warm.value.sessions.map((s) => s.value)).toEqual(cold.value.sessions.map((s) => s.value));
    // Warm: discovery decodes line 1 only (one readBytes per compressed log), no full read.
    expect(fullReads - coldReads).toBe(1);
  });

  it("counts a truncated compressed rollout as unreadable, never a crash", async () => {
    const fs = new InMemoryFs();
    const text = rollout("cut", OLD_AT, ...Array.from({ length: 400 }, (_, i) => request(`r${i}`, OLD_AT, 100 + i)));
    const full = zst(text);
    // Line 1 decodes (a stream stops at the first newline), the whole file does not.
    fs.writeBytes("/c/sessions/2026/10/01/rollout-cut.jsonl.zst", full.subarray(0, full.length - 2), 1);
    fs.writeFile("/c/sessions/2026/10/02/rollout-ok.jsonl", rollout("ok", OLD_AT, request("x", OLD_AT, 5)), 2);
    const r = await turns(fs);
    if (!r.ok) throw new Error("load failed");
    expect(r.value.sessions.map((s) => s.meta.sessionId)).toEqual(["ok"]);
    expect(r.value.unreadable).toBe(1);
    expect(r.value.issues).toEqual([]);
  });

  it("without zstd: the compressed original is skipped and counted, the plain log still loads", async () => {
    setZstdCodecForTests(null);
    const r = await turns(resumedHome(true));
    if (!r.ok) throw new Error("load failed");
    expect(r.value.sessions.map((s) => s.value)).toEqual([["r1:1000", "r2:500"]]);
    expect(r.value.skippedCompressed).toBe(1);
    expect(r.value.unreadable).toBe(0);
  });
});
