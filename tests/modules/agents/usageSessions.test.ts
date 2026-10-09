/**
 * loadSessions with the usage cache: the same sessions, dedupe and totals as
 * without it, with tool calls only where the caller needs them, and a
 * per-file cache that skips reading unchanged transcripts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryFs } from "../../../src/lib/fs.js";
import { FakeClock } from "../../../src/lib/clock.js";
import { FakeProcessEnv } from "../../../src/lib/process.js";
import { claudeCodeAgent } from "../../../src/modules/agents/claude-code/adapter.js";
import { codexAgent } from "../../../src/modules/agents/codex/adapter.js";
import { loadSessions, type LoadedSession, type LoadSessionsInput } from "../../../src/modules/agents/loadSessions.js";
import {
  cacheHeader,
  entryFile,
  fileUsageCacheIO,
  usageOnly,
} from "../../../src/modules/agents/usageSessions.js";
import { memCache, type MemCache } from "./memCache.js";
import type { ParsedSession } from "../../../src/modules/agents/shared.js";
import { addCodexRollout, solTurn } from "../../integration/codex-fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => readFileSync(path.resolve(__dirname, "../../fixtures/transcripts", n), "utf-8");
const DIR = "/home/u/.claude/projects/C--p";

const req = (id: string, ts: string, cacheRead = 1000) =>
  JSON.stringify({
    type: "assistant",
    requestId: `req_${id}`,
    timestamp: ts,
    sessionId: "s",
    message: {
      id: `msg_${id}`,
      model: "claude-opus-5",
      role: "assistant",
      content: [{ type: "tool_use", id: `tu_${id}`, name: "Read", input: { file_path: "/w/a.ts" } }],
      usage: { input_tokens: 1, output_tokens: 10, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0 },
    },
  });

/** a: original; b: resumes a (copies request 1 with a larger usage) and adds 2; c: read-heavy fixture. */
function logs(): InMemoryFs {
  const fs = new InMemoryFs();
  fs.writeFile(`${DIR}/a.jsonl`, req("1", "2026-09-01T10:00:00Z"), Date.parse("2026-09-01T10:01:00Z"));
  fs.writeFile(
    `${DIR}/b.jsonl`,
    [req("1", "2026-09-01T10:00:00Z", 5000), req("2", "2026-09-02T10:00:00Z")].join("\n"),
    Date.parse("2026-09-02T10:01:00Z"),
  );
  fs.writeFile(`${DIR}/c.jsonl`, fixture("read-heavy.jsonl"), Date.parse("2026-09-03T10:01:00Z"));
  return fs;
}

function deps(fs: InMemoryFs) {
  return { fs, env: new FakeProcessEnv({ homeDir: "/home/u" }), clock: new FakeClock(new Date("2026-10-01T00:00:00Z")) };
}

/** Records every transcript the loader reads. */
function spy(fs: InMemoryFs): { fs: InMemoryFs; reads: string[] } {
  const reads: string[] = [];
  const s = Object.create(fs, {
    readFile: { value: async (p: string) => (reads.push(path.basename(p)), fs.readFile(p)) },
  }) as InMemoryFs;
  return { fs: s, reads };
}

/** What dedupe and the token analyzers read: everything but tool calls. */
function usageView(s: ParsedSession) {
  return { ...s, toolCalls: [], priorReads: undefined, assistantTurns: s.assistantTurns.map((t) => ({ ...t, toolCalls: [] })) };
}

describe("usageOnly", () => {
  it("keeps every field but tool calls (Claude Code fixtures and a Codex rollout)", () => {
    for (const name of ["read-heavy.jsonl", "multi-model.jsonl", "older-schema-no-usage.jsonl", "malformed-mid-stream.jsonl"]) {
      const p = claudeCodeAgent.parseTranscript(fixture(name));
      if (!p.ok) throw new Error(name);
      const u = usageOnly(p.value);
      expect(u.toolCalls, name).toEqual([]);
      expect(JSON.parse(JSON.stringify({ ...u, models: [...u.models] })), name).toEqual(
        JSON.parse(JSON.stringify({ ...usageView(p.value), models: [...p.value.models] })),
      );
    }
    const fs = new InMemoryFs();
    addCodexRollout(fs, "cx1", [solTurn("2026-05-10T10:00:00Z"), solTurn("2026-05-10T10:05:00Z")]);
    return fs.readDir("/home/u/.codex/sessions/2026/05/10").then(async ([e]) => {
      const p = codexAgent.parseTranscript(await fs.readFile(`/home/u/.codex/sessions/2026/05/10/${e!.name}`));
      if (!p.ok) throw new Error("codex");
      const u = usageOnly(p.value);
      expect(u.isSubagent).toBe(p.value.isSubagent);
      expect(u.agent).toBe("codex");
      expect(u.assistantTurns.map((t) => t.requestKey)).toEqual(p.value.assistantTurns.map((t) => t.requestKey));
    });
  });
});

const parsed = (s: LoadedSession) => s.parsed;

/** loadSessions with the usage cache, returning each session as loaded. */
function load(fs: InMemoryFs, cache: MemCache | null, extra: Partial<LoadSessionsInput<ParsedSession>> = {}) {
  return loadSessions({ agent: claudeCodeAgent, deps: deps(fs), cwd: "/", cache, analyze: parsed, ...extra });
}

const cachedFiles = (c: MemCache) =>
  c.text!
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((l) => path.basename(entryFile(l)!))
    .sort();

describe("loadSessions with the usage cache", () => {
  it("matches a load without a cache: same sessions, order, dedupe (incl. the larger copied usage) and counts", async () => {
    const full = await load(logs(), null);
    const cache = memCache();
    const cold = await load(logs(), cache);
    const warm = await load(logs(), cache);
    if (!full.ok || !cold.ok || !warm.ok) throw new Error("load failed");
    for (const usage of [cold, warm]) {
      if (!usage.ok) throw new Error("load failed");
      expect(usage.value.sessions.map((s) => s.meta.filePath)).toEqual(full.value.sessions.map((s) => s.meta.filePath));
      expect(usage.value.sessions.map((s) => usageView(s.value))).toEqual(full.value.sessions.map((s) => usageView(s.value)));
      expect(usage.value.droppedDuplicateRequests).toBe(1);
    }
    // a keeps request 1, carrying b's larger usage.
    const a = warm.value.sessions.find((s) => s.meta.filePath.endsWith("a.jsonl"))!;
    expect(a.value.assistantTurns[0]!.cacheReadTokens).toBe(5000);
    // Served from the cache: no tool calls unless asked for.
    expect(warm.value.sessions.every((s) => s.value.toolCalls.length === 0)).toBe(true);
  });

  it("a warm run reads only changed files and returns the same sessions", async () => {
    const cache = memCache();
    const fs = logs();
    const cold = await load(fs, cache);
    expect(cache.writes).toBe(1);
    const s = spy(fs);
    const warm = await load(s.fs, cache);
    expect(s.reads).toEqual([]);
    expect(cache.writes).toBe(1); // nothing changed, nothing written
    if (!cold.ok || !warm.ok) throw new Error("load failed");
    expect(warm.value.sessions.map((x) => usageView(x.value))).toEqual(cold.value.sessions.map((x) => usageView(x.value)));

    // b grows (a new request): only b is read again, and dedupe still applies.
    fs.writeFile(
      `${DIR}/b.jsonl`,
      [req("1", "2026-09-01T10:00:00Z", 5000), req("2", "2026-09-02T10:00:00Z"), req("3", "2026-09-02T11:00:00Z")].join("\n"),
      Date.parse("2026-09-02T11:01:00Z"),
    );
    s.reads.length = 0;
    const after = await load(s.fs, cache);
    const ref = await load(fs, null);
    expect(s.reads).toEqual(["b.jsonl"]);
    if (!after.ok || !ref.ok) throw new Error("load failed");
    expect(after.value.sessions.map((x) => usageView(x.value))).toEqual(ref.value.sessions.map((x) => usageView(x.value)));
    expect(after.value.droppedDuplicateRequests).toBe(1);
    expect(cachedFiles(cache)).toEqual(["a.jsonl", "b.jsonl", "c.jsonl"]);
  });

  it("sessions that need tool calls come back fully parsed, from a cached file too", async () => {
    const cache = memCache();
    const fs = logs();
    await load(fs, cache);
    const s = spy(fs);
    const r = await load(s.fs, cache, { needsToolCalls: (x) => x.meta.filePath.endsWith("c.jsonl") });
    if (!r.ok) throw new Error("load failed");
    expect(s.reads).toEqual(["c.jsonl"]);
    const full = await load(logs(), null);
    if (!full.ok) throw new Error("load failed");
    const c = (o: typeof r) => o.ok && o.value.sessions.find((x) => x.meta.filePath.endsWith("c.jsonl"))!.value;
    expect(c(r)).toEqual(c(full));
    expect((c(r) as ParsedSession).toolCalls.length).toBeGreaterThan(0);
  });

  it("a cached session dedupe rewrites is rebuilt from the cache, with tool calls when asked", async () => {
    const cache = memCache();
    const fs = logs();
    await load(fs, cache);
    const s = spy(fs);
    const r = await load(s.fs, cache, { needsToolCalls: (x) => x.meta.filePath.endsWith("b.jsonl") });
    if (!r.ok) throw new Error("load failed");
    expect(s.reads).toEqual(["b.jsonl"]);
    const full = await load(logs(), null);
    if (!full.ok) throw new Error("load failed");
    const b = (o: typeof r) => o.ok && o.value.sessions.find((x) => x.meta.filePath.endsWith("b.jsonl"))!.value;
    expect(b(r)).toEqual(b(full));
    expect((b(r) as ParsedSession).assistantTurns.map((t) => t.requestKey)).toEqual(["msg_2|req_2"]);
    expect((b(r) as ParsedSession).priorReads?.size).toBe(1);
  });

  it("drops entries of deleted files, keeps entries --here did not look at", async () => {
    const cache = memCache();
    const fs = logs();
    fs.writeFile("/home/u/.claude/projects/C--q/d.jsonl", req("9", "2026-09-04T10:00:00Z"), Date.parse("2026-09-04T10:01:00Z"));
    await load(fs, cache);
    expect(cachedFiles(cache)).toEqual(["a.jsonl", "b.jsonl", "c.jsonl", "d.jsonl"]);
    // --here in C:\p: d (another project) keeps its entry.
    fs.writeFile(`${DIR}/c.jsonl`, fixture("minimal-2turn.jsonl"), Date.parse("2026-09-05T10:01:00Z"));
    await load(fs, cache, { cwd: "C:\\p", here: true });
    expect(cachedFiles(cache)).toEqual(["a.jsonl", "b.jsonl", "c.jsonl", "d.jsonl"]);
    const fresh = new InMemoryFs();
    fresh.writeFile(`${DIR}/a.jsonl`, req("1", "2026-09-01T10:00:00Z"), Date.parse("2026-09-01T10:01:00Z"));
    await load(fresh, cache);
    expect(cachedFiles(cache)).toEqual(["a.jsonl"]);
  });

  it("ignores a damaged cache, one from another version, and the 1.6 single-object cache", async () => {
    const old = JSON.stringify({ schema: "sipcode-usage-cache/1", version: "1.7.0", entries: {} });
    const otherVersion = JSON.stringify({ schema: "sipcode-usage-cache/2", version: "0.0.0" });
    for (const text of ["{not json", old, `${otherVersion}\n`]) {
      const cache = memCache();
      cache.text = text;
      const s = spy(logs());
      const r = await load(s.fs, cache);
      expect(r.ok).toBe(true);
      // Every file is parsed; a twice, as b (read after it) raises a's copy of request 1.
      expect(s.reads.sort()).toEqual(["a.jsonl", "a.jsonl", "b.jsonl", "c.jsonl"]);
      expect(cache.text!.split("\n")[0]).toBe(cacheHeader());
      expect(cachedFiles(cache)).toEqual(["a.jsonl", "b.jsonl", "c.jsonl"]);
    }
    // A damaged entry line: that file is parsed again, the others still come from the cache.
    const cache = memCache();
    await load(logs(), cache);
    cache.text = cache.text!
      .split("\n")
      .map((l) => (l.includes("a.jsonl") ? l.slice(0, 40) : l))
      .join("\n");
    const s = spy(logs());
    await load(s.fs, cache);
    expect(s.reads).toEqual(["a.jsonl"]);
  });

  it("does not cache a file whose text is not the size discovery saw (it grew mid-read)", async () => {
    const cache = memCache();
    const fs = logs();
    const grown = Object.create(fs, {
      readFile: {
        value: async (p: string) => (await fs.readFile(p)) + (p.endsWith("a.jsonl") ? "\n" : ""),
      },
    }) as InMemoryFs;
    await load(grown, cache);
    expect(cachedFiles(cache)).toEqual(["b.jsonl", "c.jsonl"]);
  });

  it("a cache that fails mid-way: the rest is parsed, results unchanged", async () => {
    const cache = memCache();
    await load(logs(), cache);
    const lines = cache.text!.split("\n").filter(Boolean);
    const broken: MemCache = {
      ...cache,
      async *lines() {
        yield lines[0]!;
        yield lines[1]!;
        throw new Error("EIO");
      },
    };
    const s = spy(logs());
    const r = await load(s.fs, broken);
    const ref = await load(logs(), null);
    if (!r.ok || !ref.ok) throw new Error("load failed");
    expect(s.reads.length).toBeGreaterThan(0);
    expect(r.value.sessions.map((x) => usageView(x.value))).toEqual(ref.value.sessions.map((x) => usageView(x.value)));
  });
});

describe("fileUsageCacheIO", () => {
  it("concurrent writers in one process (MCP tools in parallel) leave a whole file, read back line by line", async () => {
    const { mkdtempSync, readFileSync: read, readdirSync, rmSync } = await import("node:fs");
    const os = await import("node:os");
    const dir = mkdtempSync(path.join(os.tmpdir(), "sipcode-usage-cache-"));
    try {
      const file = path.join(dir, "claude-code.json");
      const io = fileUsageCacheIO(file);
      const big = (tag: string, n: number) => [tag, tag.repeat(n), tag.repeat(n >> 1)];
      const contents = [big("a", 3_000_000), big("b", 1_000_000), big("c", 2_000_000), big("d", 500_000)];
      for (let round = 0; round < 3; round++) {
        await Promise.all(
          contents.map(async (lines) => {
            const w = io.writer();
            for (const l of lines) await w.add(l);
            await w.commit();
          }),
        );
        const text = read(file, "utf-8");
        expect(contents.map((c) => c.join("\n") + "\n")).toContain(text);
        const back: string[] = [];
        for await (const l of io.lines()) back.push(l);
        expect(back.join("\n") + "\n").toBe(text);
      }
      // A discarded writer leaves nothing; no temp files left behind.
      const w = io.writer();
      await w.add("x");
      await w.discard();
      expect(readdirSync(dir)).toEqual(["claude-code.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reading the cache removes temp files a killed writer left, never a recent one", async () => {
    const { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } = await import("node:fs");
    const os = await import("node:os");
    const dir = mkdtempSync(path.join(os.tmpdir(), "sipcode-usage-cache-"));
    try {
      const file = path.join(dir, "claude-code.json");
      writeFileSync(file, "header\n");
      const old = Date.now() / 1000 - 3600;
      for (const n of ["claude-code.json.111.0.tmp", "claude-code.json.222.7.tmp"]) {
        writeFileSync(path.join(dir, n), "partial");
        utimesSync(path.join(dir, n), old, old);
      }
      writeFileSync(path.join(dir, "claude-code.json.333.1.tmp"), "being written"); // recent: another process may be writing it
      writeFileSync(path.join(dir, "codex.json.444.0.tmp"), "other cache");
      utimesSync(path.join(dir, "codex.json.444.0.tmp"), old, old);
      writeFileSync(path.join(dir, "notes.tmp"), "x");
      utimesSync(path.join(dir, "notes.tmp"), old, old);
      const back: string[] = [];
      for await (const l of fileUsageCacheIO(file).lines()) back.push(l);
      expect(back).toEqual(["header"]);
      expect(readdirSync(dir).sort()).toEqual(["claude-code.json", "claude-code.json.333.1.tmp", "codex.json.444.0.tmp", "notes.tmp"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no cache file: no lines", async () => {
    const io = fileUsageCacheIO(path.join(process.cwd(), "no-such-dir", "x.json"));
    const back: string[] = [];
    for await (const l of io.lines()) back.push(l);
    expect(back).toEqual([]);
  });
});
