import { describe, it, expect } from "vitest";
import path from "node:path";
import { runDriftCommand, type DriftDeps } from "../../../src/commands/drift.js";
import type { StoreIO } from "../../../src/modules/drift/store.js";
import { InMemoryFs } from "../../../src/lib/fs.js";
import { FakeClock } from "../../../src/lib/clock.js";
import { FakeProcessEnv } from "../../../src/lib/process.js";

/** In-memory StoreIO so tests never touch the real ~/.sipcode/drift/ cache. */
function memStoreIO(): StoreIO {
  const files = new Map<string, string>();
  return {
    async read(p) {
      return files.has(p) ? files.get(p)! : null;
    },
    async write(p, content) {
      files.set(p, content);
    },
    async append(p, content) {
      files.set(p, (files.get(p) ?? "") + content);
    },
  };
}

function transcript(sessionId: string, inputTokens: number): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-06-01T00:00:00.000Z",
    sessionId,
    message: {
      model: "claude-sonnet-4-5",
      usage: { input_tokens: inputTokens, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      content: [],
    },
  });
}

/**
 * Claude Code transcripts under /home/u/.claude/projects/<project>/<id>.jsonl,
 * newest first (`order[0]` is the newest file).
 */
function writeSessions(
  fs: InMemoryFs,
  files: Record<string, string>,
  order: string[],
  project: (id: string) => string = () => "p",
): void {
  order.forEach((id, i) => {
    fs.writeFile(`/home/u/.claude/projects/${project(id)}/${id}.jsonl`, files[id]!, 10_000 - i);
  });
}

function baseDeps(fs: InMemoryFs, out: string[], stateDir: string, storeIO = memStoreIO()): DriftDeps {
  return {
    fs,
    env: new FakeProcessEnv({ homeDir: "/home/u" }),
    clock: new FakeClock(new Date("2026-06-02")),
    homeDir: "/home/u",
    stdout: (s) => out.push(s),
    stderr: () => {},
    now: new Date("2026-06-02"),
    stateDir,
    storeIO,
    configPaths: [],
    configReader: async () => null,
  };
}

function deps(files: Record<string, string>, order: string[]): { deps: DriftDeps; out: string[] } {
  const fs = new InMemoryFs();
  writeSessions(fs, files, order);
  const out: string[] = [];
  return { out, deps: baseDeps(fs, out, "/tmp/test-drift") };
}

describe("runDriftCommand", () => {
  it("flags a regression when the newest session spikes vs history", async () => {
    const files = { A: transcript("A", 1000), B: transcript("B", 100), C: transcript("C", 100), D: transcript("D", 100) };
    const { deps: d, out } = deps(files, ["A", "B", "C", "D"]);
    const r = await runDriftCommand({}, d);
    expect(r.exitCode).toBe(0);
    expect(out.join("\n")).toContain("⚠");
  });

  it("is calm when the newest session is in range", async () => {
    const files = { A: transcript("A", 105), B: transcript("B", 100), C: transcript("C", 100), D: transcript("D", 100) };
    const { deps: d, out } = deps(files, ["A", "B", "C", "D"]);
    await runDriftCommand({}, d);
    expect(out.join("\n")).toContain("stable");
  });

  it("--json emits machine-readable output", async () => {
    const files = { A: transcript("A", 100), B: transcript("B", 100), C: transcript("C", 100), D: transcript("D", 100) };
    const { deps: d, out } = deps(files, ["A", "B", "C", "D"]);
    await runDriftCommand({ json: true }, d);
    const obj = JSON.parse(out.join("\n"));
    expect(obj.schemaVersion).toBe("sipcode-drift/2");
  });

  it("reports not-enough-data with too few sessions", async () => {
    const files = { A: transcript("A", 100) };
    const { deps: d, out } = deps(files, ["A"]);
    await runDriftCommand({}, d);
    expect(out.join("\n")).toContain("not enough");
    expect(out.join("\n")).toContain("Keep using Claude Code and re-run.");
  });

  it("with no sessions at all prints the calm no-data line (unchanged wording)", async () => {
    const out: string[] = [];
    const r = await runDriftCommand({}, baseDeps(new InMemoryFs(), out, "/tmp/test-drift-none"));
    expect(r.exitCode).toBe(0);
    expect(out).toEqual(["Sipcode drift: no sessions found yet. Use Claude Code, then re-run."]);
  });

  it("skips an unparseable newest session without corrupting the split", async () => {
    const files = {
      A: "",                       // newest — empty, must be skipped
      B: transcript("B", 100),     // becomes the effective latest
      C: transcript("C", 100),
      D: transcript("D", 100),
      E: transcript("E", 100),
    };
    const { deps: d, out } = deps(files, ["A", "B", "C", "D", "E"]);
    const r = await runDriftCommand({}, d);
    expect(r.exitCode).toBe(0);
    // B(latest)=100 vs history C/D/E=100 → stable, NOT a false spike.
    expect(out.join("\n")).toContain("stable");
  });

  it("uses per-project baseline when there's enough project history", async () => {
    // Latest belongs to project p1. There are 3 prior p1 sessions and several
    // p2 sessions. The p2 sessions must NOT contaminate the p1 baseline.
    const fileMap: Record<string, { project: string; tokens: number }> = {
      A: { project: "p1", tokens: 1000 },
      B: { project: "p2", tokens: 100 },
      C: { project: "p1", tokens: 100 },
      D: { project: "p2", tokens: 100 },
      E: { project: "p1", tokens: 100 },
      F: { project: "p2", tokens: 100 },
      G: { project: "p1", tokens: 100 },
    };
    const transcripts: Record<string, string> = {};
    for (const id of Object.keys(fileMap)) transcripts[id] = transcript(id, fileMap[id]!.tokens);
    const fs = new InMemoryFs();
    writeSessions(fs, transcripts, Object.keys(fileMap), (id) => fileMap[id]!.project);
    const out: string[] = [];
    const r = await runDriftCommand({ json: true }, baseDeps(fs, out, "/tmp/test-drift-pp"));
    expect(r.exitCode).toBe(0);
    const report = JSON.parse(out.join("\n"));
    expect(report.projectHash).toBe("p1");
    expect(report.baselineScope).toBe("project");
    expect(report.baseline.count).toBe(3); // only the p1 history entries C/E/G
    expect(report.hasRegression).toBe(true); // A=1000 vs p1 median=100
  });

  it("falls back to a global baseline when per-project history is too thin", async () => {
    // Latest project p1 has only 1 other session; baseline must use global.
    const order = ["A", "B", "C", "D", "E"];
    const project: Record<string, string> = {
      A: "p1", B: "p1", C: "p2", D: "p2", E: "p2",
    };
    const transcripts: Record<string, string> = {
      A: transcript("A", 100), B: transcript("B", 100),
      C: transcript("C", 100), D: transcript("D", 100), E: transcript("E", 100),
    };
    const fs = new InMemoryFs();
    writeSessions(fs, transcripts, order, (id) => project[id]!);
    const out: string[] = [];
    const r = await runDriftCommand({ json: true }, baseDeps(fs, out, "/tmp/test-drift-fallback"));
    expect(r.exitCode).toBe(0);
    const report = JSON.parse(out.join("\n"));
    expect(report.baselineScope).toBe("global");
  });

  it("attributes a cache-reuse regression to an MCP server change", async () => {
    // Need a cache-reuse regression: baseline cacheHitRate >= 20%, latest drops 15+ points.
    const cached = (sessionId: string, cacheRead: number, input: number) =>
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-06-01T00:00:00.000Z",
        sessionId,
        message: {
          model: "claude-sonnet-4-5",
          usage: {
            input_tokens: input,
            output_tokens: 10,
            cache_read_input_tokens: cacheRead,
            cache_creation_input_tokens: 0,
          },
          content: [],
        },
      });
    const transcripts: Record<string, string> = {
      A: cached("A", 0, 100),       // latest, no cache reuse
      B: cached("B", 900, 100),     // baseline, 90% cache
      C: cached("C", 900, 100),
      D: cached("D", 900, 100),
    };
    const storeIO = memStoreIO();
    const newConfig = JSON.stringify({ mcpServers: { keep: {}, newserver: {} } });
    // First seed an OLD config snapshot dated before the baseline window.
    await storeIO.append(
      path.join("/tmp/test-drift-attr", "configs.jsonl"),
      JSON.stringify({ capturedAtMs: 500, mcpServers: ["keep"] }) + "\n",
    );
    const fs = new InMemoryFs();
    writeSessions(fs, transcripts, ["A", "B", "C", "D"], () => "p1");
    const out: string[] = [];
    const r = await runDriftCommand(
      { json: true },
      {
        ...baseDeps(fs, out, "/tmp/test-drift-attr", storeIO),
        configPaths: ["/cfg"],
        configReader: async () => newConfig,
      },
    );
    expect(r.exitCode).toBe(0);
    const report = JSON.parse(out.join("\n"));
    expect(report.hasRegression).toBe(true);
    const cacheCause = report.causes.find((c: { metric: string }) => c.metric === "Cache reuse");
    expect(cacheCause).toBeDefined();
    expect(cacheCause.attribution).toContain("newserver");
    expect(cacheCause.attribution).toContain("MCP");
  });

  it("--no-cache skips the persistent cache entirely", async () => {
    const storeIO = memStoreIO();
    const files = {
      A: transcript("A", 100), B: transcript("B", 100),
      C: transcript("C", 100), D: transcript("D", 100),
    };
    const fs = new InMemoryFs();
    writeSessions(fs, files, ["A", "B", "C", "D"], () => "p1");
    const out: string[] = [];
    await runDriftCommand({ noCache: true }, baseDeps(fs, out, "/tmp/test-drift-no-cache", storeIO));
    // No writes — the in-memory io should still have no cache file.
    expect(await storeIO.read(path.join("/tmp/test-drift-no-cache", "sessions-v3.jsonl"))).toBeNull();
    expect(await storeIO.read(path.join("/tmp/test-drift-no-cache", "configs.jsonl"))).toBeNull();
  });

  it("caches metrics in sessions-v3.jsonl and ignores the pre-v3 cache file", async () => {
    const storeIO = memStoreIO();
    // A stale pre-v3 entry claiming B was a huge session must not be used.
    await storeIO.append(
      path.join("/tmp/test-drift-v3", "sessions.jsonl"),
      JSON.stringify({ sessionId: "B", endedAtMs: 9_999, totalTokens: 1e6, assistantTurns: 1, tokensPerTurn: 1e6, cacheHitRate: 0, duplicateReadTokens: 0, outputRatio: 0, projectHash: "p" }) + "\n",
    );
    const files = { A: transcript("A", 100), B: transcript("B", 100), C: transcript("C", 100), D: transcript("D", 100) };
    const fs = new InMemoryFs();
    writeSessions(fs, files, ["A", "B", "C", "D"]);
    const out: string[] = [];
    await runDriftCommand({ json: true }, baseDeps(fs, out, "/tmp/test-drift-v3", storeIO));
    const report = JSON.parse(out.join("\n"));
    expect(report.hasRegression).toBe(false);
    const v3 = await storeIO.read(path.join("/tmp/test-drift-v3", "sessions-v3.jsonl"));
    expect(v3?.trim().split("\n")).toHaveLength(4);
  });

  it("recomputes a cached session whose file changed since (in-flight session)", async () => {
    const storeIO = memStoreIO();
    const fs = new InMemoryFs();
    const files = { A: transcript("A", 100), B: transcript("B", 100), C: transcript("C", 100), D: transcript("D", 100) };
    writeSessions(fs, files, ["A", "B", "C", "D"]);
    const out1: string[] = [];
    await runDriftCommand({ json: true }, baseDeps(fs, out1, "/tmp/test-drift-grow", storeIO));
    expect(JSON.parse(out1.join("\n")).hasRegression).toBe(false);
    // A keeps growing: same id, newer mtime, much bigger turn.
    fs.writeFile("/home/u/.claude/projects/p/A.jsonl", transcript("A", 5000), 20_000);
    const out2: string[] = [];
    await runDriftCommand({ json: true }, baseDeps(fs, out2, "/tmp/test-drift-grow", storeIO));
    const report = JSON.parse(out2.join("\n"));
    expect(report.hasRegression).toBe(true);
    expect(report.latest.tokensPerTurn).toBe(5010);
  });

  it("warm runs reuse cached metrics without parsing unchanged files", async () => {
    const storeIO = memStoreIO();
    const fs = new InMemoryFs();
    const files = { A: transcript("A", 100), B: transcript("B", 100), C: transcript("C", 100), D: transcript("D", 100) };
    writeSessions(fs, files, ["A", "B", "C", "D"]);
    await runDriftCommand({ json: true }, baseDeps(fs, [], "/tmp/test-drift-warm", storeIO));
    // Corrupt B on disk without changing its mtime: the cached metrics are used.
    fs.writeFile("/home/u/.claude/projects/p/B.jsonl", transcript("B", 99_999), 10_000 - 1);
    const out: string[] = [];
    await runDriftCommand({ json: true }, baseDeps(fs, out, "/tmp/test-drift-warm", storeIO));
    expect(JSON.parse(out.join("\n")).baseline.medianTokensPerTurn).toBe(110);
  });

  it("a warm run with nothing changed reads no transcript (the pick comes from the cache)", async () => {
    const files = { A: transcript("A", 100), B: transcript("B", 100), C: transcript("C", 100), D: transcript("D", 100) };
    const fs = new InMemoryFs();
    const storeIO = memStoreIO();
    writeSessions(fs, files, ["A", "B", "C", "D"]);
    const first: string[] = [];
    await runDriftCommand({ json: true }, baseDeps(fs, first, "/tmp/test-drift-pick", storeIO));
    const reads: string[] = [];
    const spy = Object.create(fs, {
      readFile: { value: async (p: string) => (reads.push(p), fs.readFile(p)) },
    }) as InMemoryFs;
    const second: string[] = [];
    await runDriftCommand({ json: true }, baseDeps(spy, second, "/tmp/test-drift-pick", storeIO));
    expect(reads.filter((p) => p.endsWith(".jsonl"))).toEqual([]);
    expect(second).toEqual(first);
    // A changed file is read again (and only that one).
    fs.writeFile("/home/u/.claude/projects/p/A.jsonl", transcript("A", 100), 10_001);
    reads.length = 0;
    await runDriftCommand({ json: true }, baseDeps(spy, [], "/tmp/test-drift-pick", storeIO));
    expect(reads.filter((p) => p.endsWith(".jsonl")).map((p) => path.basename(p))).toEqual(["A.jsonl"]);
  });

  it("a cold run reads only the sessions the report uses (latest + 6 of its project)", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `S${i}`);
    const files = Object.fromEntries(ids.map((id) => [id, transcript(id, 100)]));
    const fs = new InMemoryFs();
    writeSessions(fs, files, ids);
    const reads: string[] = [];
    const spy = Object.create(fs, {
      readFile: { value: async (p: string) => (reads.push(p), fs.readFile(p)) },
    }) as InMemoryFs;
    const out: string[] = [];
    await runDriftCommand({ json: true }, baseDeps(spy, out, "/tmp/test-drift-cold"));
    const report = JSON.parse(out.join("\n"));
    expect(report.latest.sessionId).toBe("S0");
    expect(report.baseline.count).toBe(6);
    expect(reads.filter((p) => p.endsWith(".jsonl")).map((p) => path.basename(p, ".jsonl"))).toEqual(ids.slice(0, 7));
  });

  it("skips a 0-turn (in-flight/empty) newest session — no false alarm", async () => {
    // A parses fine but has NO assistant turns (only a user entry), so its
    // cacheHitRate=0/tokensPerTurn=0 must NOT be treated as 'latest'.
    // Regression guard for the false alarm found dogfooding 1.6.2.
    const userOnly = JSON.stringify({
      type: "user",
      timestamp: "2026-06-01T00:00:00.000Z",
      sessionId: "A",
      message: { role: "user", content: "hi" },
    });
    const files = {
      A: userOnly,
      B: transcript("B", 100),
      C: transcript("C", 100),
      D: transcript("D", 100),
      E: transcript("E", 100),
    };
    const { deps: d, out } = deps(files, ["A", "B", "C", "D", "E"]);
    const r = await runDriftCommand({}, d);
    expect(r.exitCode).toBe(0);
    // A skipped → B(latest)=100 vs C/D/E=100 → stable, NOT a bogus cache-drop.
    expect(out.join("\n")).toContain("stable");
    expect(out.join("\n")).not.toContain("⚠");
  });

  const req = (id: string, input: number) =>
    JSON.stringify({
      type: "assistant",
      requestId: `req_${id}`,
      timestamp: "2026-06-01T00:00:00.000Z",
      sessionId: "s",
      message: { id: `msg_${id}`, model: "claude-sonnet-4-5", role: "assistant", content: [], usage: { input_tokens: input, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    });

  /** Like writeSessions, but each file was last written after the requests it holds (as on disk). */
  function writeRealistic(files: Record<string, string>, order: string[]): { deps: DriftDeps; out: string[] } {
    const fs = new InMemoryFs();
    order.forEach((id, i) => {
      fs.writeFile(`/home/u/.claude/projects/p/${id}.jsonl`, files[id]!, Date.parse("2026-06-01T01:00:00Z") - i * 1_000);
    });
    const out: string[] = [];
    return { out, deps: baseDeps(fs, out, "/tmp/test-drift") };
  }

  it("counts a request repeated in a resumed file once (own requests only)", async () => {
    // R resumes B: it repeats B's huge request and adds one normal request.
    const files = {
      R: [req("big", 10_000), req("r1", 100)].join("\n"),
      B: req("big", 10_000),
      C: req("c1", 100),
      D: req("d1", 100),
      E: req("e1", 100),
    };
    const { deps: d, out } = writeRealistic(files, ["R", "B", "C", "D", "E"]);
    await runDriftCommand({ json: true }, d);
    const report = JSON.parse(out.join("\n"));
    expect(report.latest.sessionId).toBe("R");
    expect(report.latest.assistantTurns).toBe(1);
    expect(report.latest.tokensPerTurn).toBe(110);
  });

  it("drops the copy even when the original is older than the 30 sessions drift reads", async () => {
    const files: Record<string, string> = { R: [req("big", 10_000), req("r1", 100)].join("\n"), B: req("big", 10_000) };
    const fillers = Array.from({ length: 30 }, (_, i) => `F${i}`);
    for (const f of fillers) files[f] = req(f, 100);
    const { deps: d, out } = writeRealistic(files, ["R", ...fillers, "B"]);
    await runDriftCommand({ json: true }, d);
    const report = JSON.parse(out.join("\n"));
    expect(report.latest.sessionId).toBe("R");
    expect(report.latest.assistantTurns).toBe(1);
    expect(report.latest.tokensPerTurn).toBe(110);
  });
});
