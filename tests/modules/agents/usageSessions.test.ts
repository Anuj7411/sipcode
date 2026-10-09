/**
 * loadUsageSessions: the same sessions, dedupe and totals as loadSessions,
 * with tool calls only where the caller needs them, and a per-file cache that
 * skips reading unchanged transcripts.
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
import { loadSessions } from "../../../src/modules/agents/loadSessions.js";
import {
  loadUsageSessions,
  usageOnly,
  type UsageCacheIO,
} from "../../../src/modules/agents/usageSessions.js";
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

function memCache(): UsageCacheIO & { text: string | null; writes: number } {
  return {
    text: null,
    writes: 0,
    async read() {
      return this.text;
    },
    async write(c: string) {
      this.text = c;
      this.writes++;
    },
  };
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

describe("loadUsageSessions", () => {
  it("matches loadSessions: same sessions, order, dedupe (incl. the larger copied usage) and counts", async () => {
    const full = await loadSessions({ agent: claudeCodeAgent, deps: deps(logs()), cwd: "/" });
    const usage = await loadUsageSessions({ agent: claudeCodeAgent, deps: deps(logs()), cwd: "/", cache: null });
    if (!full.ok || !usage.ok) throw new Error("load failed");
    expect(usage.value.sessions.map((s) => s.meta.filePath)).toEqual(full.value.sessions.map((s) => s.meta.filePath));
    expect(usage.value.sessions.map((s) => usageView(s.parsed))).toEqual(full.value.sessions.map((s) => usageView(s.parsed)));
    expect(usage.value.droppedDuplicateRequests).toBe(1);
    expect(usage.value.droppedDuplicateRequests).toBe(full.value.droppedDuplicateRequests);
    // a keeps request 1, carrying b's larger usage.
    const a = usage.value.sessions.find((s) => s.meta.filePath.endsWith("a.jsonl"))!;
    expect(a.parsed.assistantTurns[0]!.cacheReadTokens).toBe(5000);
    // No tool calls unless asked for.
    expect(usage.value.sessions.every((s) => s.parsed.toolCalls.length === 0)).toBe(true);
  });

  it("a warm run reads only changed files and returns the same sessions", async () => {
    const cache = memCache();
    const fs = logs();
    const cold = await loadUsageSessions({ agent: claudeCodeAgent, deps: deps(fs), cwd: "/", cache });
    expect(cache.writes).toBe(1);
    const s = spy(fs);
    const warm = await loadUsageSessions({ agent: claudeCodeAgent, deps: deps(s.fs), cwd: "/", cache });
    expect(s.reads).toEqual([]);
    expect(cache.writes).toBe(1); // nothing changed, nothing written
    if (!cold.ok || !warm.ok) throw new Error("load failed");
    expect(warm.value).toEqual(cold.value);

    // b grows (a new request): only b is read again, and dedupe still applies.
    fs.writeFile(
      `${DIR}/b.jsonl`,
      [req("1", "2026-09-01T10:00:00Z", 5000), req("2", "2026-09-02T10:00:00Z"), req("3", "2026-09-02T11:00:00Z")].join("\n"),
      Date.parse("2026-09-02T11:01:00Z"),
    );
    s.reads.length = 0;
    const after = await loadUsageSessions({ agent: claudeCodeAgent, deps: deps(s.fs), cwd: "/", cache });
    const ref = await loadUsageSessions({ agent: claudeCodeAgent, deps: deps(fs), cwd: "/", cache: null });
    expect(s.reads).toEqual(["b.jsonl"]);
    if (!after.ok || !ref.ok) throw new Error("load failed");
    expect(after.value).toEqual(ref.value);
    expect(after.value.droppedDuplicateRequests).toBe(1);
  });

  it("sessions that need tool calls come back fully parsed, from a cached file too", async () => {
    const cache = memCache();
    const fs = logs();
    await loadUsageSessions({ agent: claudeCodeAgent, deps: deps(fs), cwd: "/", cache });
    const s = spy(fs);
    const r = await loadUsageSessions({
      agent: claudeCodeAgent,
      deps: deps(s.fs),
      cwd: "/",
      cache,
      needsToolCalls: (x) => x.meta.filePath.endsWith("c.jsonl"),
    });
    if (!r.ok) throw new Error("load failed");
    expect(s.reads).toEqual(["c.jsonl"]);
    const full = await loadSessions({ agent: claudeCodeAgent, deps: deps(logs()), cwd: "/" });
    if (!full.ok) throw new Error("load failed");
    const c = (o: typeof r) => o.ok && o.value.sessions.find((x) => x.meta.filePath.endsWith("c.jsonl"))!.parsed;
    expect(c(r)).toEqual(c(full));
    expect((c(r) as ParsedSession).toolCalls.length).toBeGreaterThan(0);
  });

  it("drops entries of deleted files, keeps entries --here did not look at", async () => {
    const cache = memCache();
    const fs = logs();
    fs.writeFile("/home/u/.claude/projects/C--q/d.jsonl", req("9", "2026-09-04T10:00:00Z"), Date.parse("2026-09-04T10:01:00Z"));
    await loadUsageSessions({ agent: claudeCodeAgent, deps: deps(fs), cwd: "/", cache });
    const files = () => Object.keys((JSON.parse(cache.text!) as { entries: object }).entries).map((f) => path.basename(f)).sort();
    expect(files()).toEqual(["a.jsonl", "b.jsonl", "c.jsonl", "d.jsonl"]);
    // --here in C:\p: d (another project) keeps its entry.
    fs.writeFile(`${DIR}/c.jsonl`, fixture("minimal-2turn.jsonl"), Date.parse("2026-09-05T10:01:00Z"));
    await loadUsageSessions({ agent: claudeCodeAgent, deps: deps(fs), cwd: "C:\\p", here: true, cache });
    expect(files()).toEqual(["a.jsonl", "b.jsonl", "c.jsonl", "d.jsonl"]);
    const fresh = new InMemoryFs();
    fresh.writeFile(`${DIR}/a.jsonl`, req("1", "2026-09-01T10:00:00Z"), Date.parse("2026-09-01T10:01:00Z"));
    await loadUsageSessions({ agent: claudeCodeAgent, deps: deps(fresh), cwd: "/", cache });
    expect(files()).toEqual(["a.jsonl"]);
  });

  it("ignores a damaged cache or one from another version", async () => {
    for (const text of ["{not json", JSON.stringify({ schema: "sipcode-usage-cache/1", version: "0.0.0", entries: {} })]) {
      const cache = memCache();
      cache.text = text;
      const s = spy(logs());
      const r = await loadUsageSessions({ agent: claudeCodeAgent, deps: deps(s.fs), cwd: "/", cache });
      expect(r.ok).toBe(true);
      expect(s.reads.sort()).toEqual(["a.jsonl", "b.jsonl", "c.jsonl"]);
    }
  });

  it("does not cache a file whose text is not the size discovery saw (it grew mid-read)", async () => {
    const cache = memCache();
    const fs = logs();
    const grown = Object.create(fs, {
      readFile: {
        value: async (p: string) => (await fs.readFile(p)) + (p.endsWith("a.jsonl") ? "\n" : ""),
      },
    }) as InMemoryFs;
    await loadUsageSessions({ agent: claudeCodeAgent, deps: deps(grown), cwd: "/", cache });
    const files = Object.keys((JSON.parse(cache.text!) as { entries: object }).entries).map((f) => path.basename(f)).sort();
    expect(files).toEqual(["b.jsonl", "c.jsonl"]);
  });
});

describe("fileUsageCacheIO", () => {
  it("concurrent writes in one process (MCP tools in parallel) leave a whole file", async () => {
    const { mkdtempSync, readFileSync: read, readdirSync, rmSync } = await import("node:fs");
    const os = await import("node:os");
    const { fileUsageCacheIO } = await import("../../../src/modules/agents/usageSessions.js");
    const dir = mkdtempSync(path.join(os.tmpdir(), "sipcode-usage-cache-"));
    try {
      const file = path.join(dir, "claude-code.json");
      const io = fileUsageCacheIO(file);
      const big = (tag: string, n: number) => JSON.stringify({ tag, pad: tag.repeat(n) });
      const contents = [big("a", 3_000_000), big("b", 1_000_000), big("c", 2_000_000), big("d", 500_000)];
      for (let round = 0; round < 3; round++) {
        await Promise.all(contents.map((c) => io.write(c)));
        const text = read(file, "utf-8");
        expect(contents).toContain(text);
      }
      // No temp files left behind.
      expect(readdirSync(dir)).toEqual(["claude-code.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
