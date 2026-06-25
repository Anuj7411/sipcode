import { describe, expect, it } from "vitest";
import { runEstimate } from "../../src/commands/estimate.js";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";

function setup() {
  const fs = new InMemoryFs();
  const clock = new FakeClock(new Date("2026-05-19T12:00:00Z"));
  const env = new FakeProcessEnv({
    vars: { SIPCODE_PROJECTS_DIR: "/projects" },
  });
  const out: string[] = [];
  const err: string[] = [];
  const stdout = (s: string) => out.push(s);
  const stderr = (s: string) => err.push(s);
  return { fs, clock, env, out, err, stdout, stderr };
}

const SAMPLE_MANIFEST = [
  "# Project manifest — demo",
  "",
  "- files-scanned: 50",
  "",
  "## Framework",
  "",
  "- framework: cli",
  "",
].join("\n");

describe("sipcode estimate (integration)", () => {
  it("emits an error for empty task", async () => {
    const ctx = setup();
    const r = await runEstimate({ task: "" }, { ...ctx });
    expect(r.exitCode).toBe(1);
    expect(ctx.err.join("\n")).toMatch(/missing task/i);
  });

  it("runs end-to-end against a manifest with no historical anchors", async () => {
    const ctx = setup();
    ctx.fs.writeFile("/repo/.sipcode/manifest.md", SAMPLE_MANIFEST);
    const r = await runEstimate(
      { task: "refactor the auth module", repo: "/repo" },
      { ...ctx },
    );
    expect(r.exitCode).toBe(0);
    const out = ctx.out.join("\n");
    expect(out).toContain("complexity: high");
    expect(out).toContain("framework: cli");
    expect(out).toContain("50 files");
    expect(out).toMatch(/low confidence/i);
  });

  it("uses historical anchors when transcripts are present", async () => {
    const ctx = setup();
    ctx.fs.writeFile("/repo/.sipcode/manifest.md", SAMPLE_MANIFEST);
    // Seed three high-tier sessions.
    ctx.fs.mkdir("/projects/proj1");
    for (let i = 0; i < 4; i++) {
      const lines: string[] = [];
      // 35 tool calls, 25 distinct reads → matches high tier
      for (let j = 0; j < 35; j++) {
        const useRead = j < 25;
        const tool = useRead
          ? {
              type: "tool_use",
              id: `t${j}`,
              name: "Read",
              input: { file_path: `/p/file${j}.ts` },
            }
          : { type: "tool_use", id: `t${j}`, name: "Bash", input: { command: "ls" } };
        lines.push(
          JSON.stringify({
            type: "assistant",
            uuid: `a${i}-${j}`,
            sessionId: `s${i}`,
            timestamp: "2026-05-01T10:00:00.000Z",
            cwd: "/p",
            message: {
              model: "claude-opus-4",
              role: "assistant",
              content: [tool],
              usage: {
                input_tokens: 200,
                output_tokens: 100,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
              },
            },
          }),
        );
      }
      ctx.fs.writeFile(`/projects/proj1/s${i}.jsonl`, lines.join("\n"), 1000 + i);
    }
    const r = await runEstimate(
      { task: "refactor the auth module", repo: "/repo" },
      { ...ctx },
    );
    expect(r.exitCode).toBe(0);
    const out = ctx.out.join("\n");
    expect(out).toMatch(/4 matched/);
    expect(out).toMatch(/confidence: high/);
  });

  it("--no-anchors skips lookup and labels low confidence", async () => {
    const ctx = setup();
    ctx.fs.writeFile("/repo/.sipcode/manifest.md", SAMPLE_MANIFEST);
    const r = await runEstimate(
      { task: "refactor the auth module", repo: "/repo", anchors: false },
      { ...ctx },
    );
    expect(r.exitCode).toBe(0);
    const out = ctx.out.join("\n");
    expect(out).toContain("--no-anchors");
    expect(out).toMatch(/low confidence/i);
  });

  it("--json emits a parseable, stable-shape document", async () => {
    const ctx = setup();
    ctx.fs.writeFile("/repo/.sipcode/manifest.md", SAMPLE_MANIFEST);
    const r = await runEstimate(
      {
        task: "refactor the auth module",
        repo: "/repo",
        json: true,
        anchors: false,
      },
      { ...ctx },
    );
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(ctx.out[0]!);
    expect(parsed.schemaVersion).toBe("sipcode-estimate/1");
    expect(parsed.task).toBe("refactor the auth module");
    expect(parsed.complexity.tier).toBe("high");
    expect(parsed.predictions).toHaveLength(3);
    expect(parsed.recommendation.model).toMatch(/claude-/);
  });

  it("--model opus filters terminal output to opus only", async () => {
    const ctx = setup();
    ctx.fs.writeFile("/repo/.sipcode/manifest.md", SAMPLE_MANIFEST);
    const r = await runEstimate(
      {
        task: "refactor the auth module",
        repo: "/repo",
        model: "opus",
        anchors: false,
      },
      { ...ctx },
    );
    expect(r.exitCode).toBe(0);
    const out = ctx.out.join("\n");
    // Header still includes all models implicitly through the recommendation,
    // but the table itself only has the opus row.
    const tableLines = out
      .split("\n")
      .filter((l) => /\bopus 4|sonnet 4|haiku 4\b/.test(l) && /\$/.test(l));
    expect(tableLines.length).toBeGreaterThan(0);
    expect(tableLines.every((l) => /opus 4.8/.test(l))).toBe(true);
  });

  it("falls back to quick scan when no manifest", async () => {
    const ctx = setup();
    ctx.fs.writeFile("/repo/src/index.ts", "x");
    ctx.fs.writeFile("/repo/src/util.ts", "y");
    const r = await runEstimate(
      { task: "rename foo to bar", repo: "/repo", anchors: false },
      { ...ctx },
    );
    expect(r.exitCode).toBe(0);
    const out = ctx.out.join("\n");
    expect(out).toMatch(/no manifest/);
    expect(out).toMatch(/quick scan/);
  });
});
