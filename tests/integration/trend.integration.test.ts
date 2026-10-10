/** `sipcode trend` with Claude Code and Codex logs on the same machine. */
import { describe, expect, it } from "vitest";
import { runTrend } from "../../src/commands/trend.js";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import { addCodexRollout, autoReviewTurn, CODEX_SESSIONS, solTurn } from "./codex-fixtures.js";

const NOW = new Date("2026-05-20T12:00:00.000Z");

const claudeReq = (id: string, ts: string) =>
  JSON.stringify({
    type: "assistant",
    requestId: `req_${id}`,
    timestamp: ts,
    sessionId: id,
    message: {
      id: `msg_${id}`,
      model: "claude-opus-4-8",
      role: "assistant",
      content: [{ type: "text", text: "." }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
    },
  });

function claudeFs(): InMemoryFs {
  const fs = new InMemoryFs();
  fs.writeFile("/home/u/.claude/projects/C--p/a.jsonl", claudeReq("a", "2026-05-12T10:00:00Z"), Date.parse("2026-05-12T10:01:00Z"));
  return fs;
}
const withCodex = (fs: InMemoryFs = claudeFs()) => {
  addCodexRollout(fs, "cx1", [solTurn("2026-05-13T10:00:00Z")]);
  return fs;
};

async function run(opts: Parameters<typeof runTrend>[0], fs: InMemoryFs) {
  const out: string[] = [];
  const err: string[] = [];
  const r = await runTrend(opts, {
    fs,
    env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
    clock: new FakeClock(NOW),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  });
  return { exitCode: r.exitCode, out: out.join("\n"), err: err.join("\n") };
}

describe("runTrend: Claude Code and Codex sections", () => {
  it("shows both sections and no combined line (a ratio does not add up)", async () => {
    const r = await run({}, withCodex());
    expect(r.exitCode).toBe(0);
    expect(r.out).toContain("── Claude Code ──");
    expect(r.out).toContain("── Codex ──");
    expect(r.out).not.toContain("Both tools");
    expect(r.out.match(/total sessions across window: 1/g)).toHaveLength(2);
  });

  it("Claude Code alone is unchanged: no headers", async () => {
    const r = await run({}, claudeFs());
    expect(r.out.startsWith("sipcode trend · ")).toBe(true);
    expect(r.out).not.toContain("──");
  });

  it("works for a Codex-only user", async () => {
    const r = await run({}, withCodex(new InMemoryFs()));
    expect(r.exitCode).toBe(0);
    expect(r.out.startsWith("sipcode trend · ")).toBe(true);
    expect(r.out).toContain("total sessions across window: 1");
  });

  it("JSON with both installed is the unchanged Claude Code JSON plus a stderr note", async () => {
    const claudeOnly = await run({ json: true }, claudeFs());
    const both = await run({ json: true }, withCodex());
    expect(both.out).toBe(claudeOnly.out);
    expect(both.err).toMatch(/--agent codex/);
    const codex = JSON.parse((await run({ json: true, agent: "codex", metric: "cost-per-session" }, withCodex())).out);
    const day = codex.days.find((d: { sessions: number }) => d.sessions === 1);
    expect(day.value).toBeCloseTo(0.003, 6);
  });

  it("names unpriced tokens under the cost metric only", async () => {
    const fs = withCodex(new InMemoryFs());
    addCodexRollout(fs, "cx2", [autoReviewTurn("2026-05-14T10:00:00Z")]);
    const cost = await run({ metric: "cost-per-session" }, fs);
    const lines = cost.out.split("\n");
    const minMax = lines.findIndex((l) => l.startsWith("  min "));
    expect(lines[minMax + 1]).toBe(
      "  20,503 tokens on models without a known price (codex-auto-review): not included in the cost above.",
    );
    const ratio = await run({}, fs);
    expect(ratio.out).not.toContain("without a known price");
  });

  it("reports skipped compressed Codex logs once, on stderr", async () => {
    const fs = withCodex(new InMemoryFs());
    fs.writeFile(`${CODEX_SESSIONS}/2026/05/09/rollout-a.jsonl.zst`, "z", 1);
    const r = await run({}, fs);
    expect(r.err).toBe(
      "note: 1 compressed Codex log(s) (.jsonl.zst) skipped: Sipcode cannot read compressed logs yet.",
    );
  });
});
