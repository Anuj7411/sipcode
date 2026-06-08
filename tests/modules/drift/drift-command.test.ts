import { describe, it, expect } from "vitest";
import { runDriftCommand, type DriftDeps } from "../../../src/commands/drift.js";
import type { StoreIO } from "../../../src/modules/drift/store.js";

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

function deps(files: Record<string, string>, order: string[]): { deps: DriftDeps; out: string[] } {
  const out: string[] = [];
  return {
    out,
    deps: {
      homeDir: "/home/u",
      stdout: (s) => out.push(s),
      listSessions: async () => order.map((id, i) => ({
        sessionId: id, filePath: `/p/${id}.jsonl`, projectHash: "p",
        mtimeMs: 1000 - i, size: files[id]!.length,
      })),
      readFile: async (p: string) => {
        const id = p.replace("/p/", "").replace(".jsonl", "");
        return files[id] ?? "";
      },
      now: new Date("2026-06-02"),
      stateDir: "/tmp/test-drift",
      storeIO: memStoreIO(),
      configPaths: [],
      configReader: async () => null,
    },
  };
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
    const out: string[] = [];
    const storeIO = memStoreIO();
    const fileMap: Record<string, { project: string; tokens: number; size: number }> = {
      A: { project: "p1", tokens: 1000, size: 0 },
      B: { project: "p2", tokens: 100, size: 0 },
      C: { project: "p1", tokens: 100, size: 0 },
      D: { project: "p2", tokens: 100, size: 0 },
      E: { project: "p1", tokens: 100, size: 0 },
      F: { project: "p2", tokens: 100, size: 0 },
      G: { project: "p1", tokens: 100, size: 0 },
    };
    const transcripts: Record<string, string> = {};
    for (const id of Object.keys(fileMap)) transcripts[id] = transcript(id, fileMap[id]!.tokens);
    const r = await runDriftCommand(
      { json: true },
      {
        homeDir: "/home/u",
        stdout: (s) => out.push(s),
        listSessions: async () =>
          Object.entries(fileMap).map(([id, meta], i) => ({
            sessionId: id,
            filePath: `/p/${id}.jsonl`,
            projectHash: meta.project,
            mtimeMs: 10_000 - i,
            size: transcripts[id]!.length,
          })),
        readFile: async (p: string) => transcripts[p.replace("/p/", "").replace(".jsonl", "")] ?? "",
        now: new Date("2026-06-02"),
        stateDir: "/tmp/test-drift-pp",
        storeIO,
        configPaths: [],
        configReader: async () => null,
      },
    );
    expect(r.exitCode).toBe(0);
    const report = JSON.parse(out.join("\n"));
    expect(report.projectHash).toBe("p1");
    expect(report.baselineScope).toBe("project");
    expect(report.baseline.count).toBe(3); // only the p1 history entries C/E/G
    expect(report.hasRegression).toBe(true); // A=1000 vs p1 median=100
  });

  it("falls back to a global baseline when per-project history is too thin", async () => {
    // Latest project p1 has only 1 other session; baseline must use global.
    const out: string[] = [];
    const storeIO = memStoreIO();
    const order = ["A", "B", "C", "D", "E"];
    const project: Record<string, string> = {
      A: "p1", B: "p1", C: "p2", D: "p2", E: "p2",
    };
    const transcripts: Record<string, string> = {
      A: transcript("A", 100), B: transcript("B", 100),
      C: transcript("C", 100), D: transcript("D", 100), E: transcript("E", 100),
    };
    const r = await runDriftCommand(
      { json: true },
      {
        homeDir: "/home/u",
        stdout: (s) => out.push(s),
        listSessions: async () =>
          order.map((id, i) => ({
            sessionId: id,
            filePath: `/p/${id}.jsonl`,
            projectHash: project[id]!,
            mtimeMs: 10_000 - i,
            size: transcripts[id]!.length,
          })),
        readFile: async (p: string) => transcripts[p.replace("/p/", "").replace(".jsonl", "")] ?? "",
        now: new Date("2026-06-02"),
        stateDir: "/tmp/test-drift-fallback",
        storeIO,
        configPaths: [],
        configReader: async () => null,
      },
    );
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
    const out: string[] = [];
    const storeIO = memStoreIO();
    const oldConfig = JSON.stringify({ mcpServers: { keep: {} } });
    const newConfig = JSON.stringify({ mcpServers: { keep: {}, newserver: {} } });
    // First seed an OLD config snapshot dated before the baseline window.
    await storeIO.append(
      "/tmp/test-drift-attr/configs.jsonl",
      JSON.stringify({ capturedAtMs: 500, mcpServers: ["keep"] }) + "\n",
    );
    let configBody = newConfig;
    void oldConfig;
    const r = await runDriftCommand(
      { json: true },
      {
        homeDir: "/home/u",
        stdout: (s) => out.push(s),
        listSessions: async () =>
          ["A", "B", "C", "D"].map((id, i) => ({
            sessionId: id,
            filePath: `/p/${id}.jsonl`,
            projectHash: "p1",
            mtimeMs: 10_000 - i,
            size: transcripts[id]!.length,
          })),
        readFile: async (p: string) => transcripts[p.replace("/p/", "").replace(".jsonl", "")] ?? "",
        now: new Date("2026-06-02"),
        stateDir: "/tmp/test-drift-attr",
        storeIO,
        configPaths: ["/cfg"],
        configReader: async () => configBody,
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
    const out: string[] = [];
    const storeIO = memStoreIO();
    const files = {
      A: transcript("A", 100), B: transcript("B", 100),
      C: transcript("C", 100), D: transcript("D", 100),
    };
    await runDriftCommand(
      { noCache: true },
      {
        homeDir: "/home/u",
        stdout: (s) => out.push(s),
        listSessions: async () =>
          ["A", "B", "C", "D"].map((id, i) => ({
            sessionId: id,
            filePath: `/p/${id}.jsonl`,
            projectHash: "p1",
            mtimeMs: 10_000 - i,
            size: files[id as keyof typeof files].length,
          })),
        readFile: async (p: string) => files[p.replace("/p/", "").replace(".jsonl", "") as keyof typeof files] ?? "",
        now: new Date("2026-06-02"),
        stateDir: "/tmp/test-drift-no-cache",
        storeIO,
        configPaths: [],
        configReader: async () => null,
      },
    );
    // No writes — the in-memory io should still have an empty sessions.jsonl.
    expect(await storeIO.read("/tmp/test-drift-no-cache/sessions.jsonl")).toBeNull();
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
});
