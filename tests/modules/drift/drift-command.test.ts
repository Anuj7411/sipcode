import { describe, it, expect } from "vitest";
import { runDriftCommand, type DriftDeps } from "../../../src/commands/drift.js";

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
    expect(obj.schemaVersion).toBe("sipcode-drift/1");
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
});
