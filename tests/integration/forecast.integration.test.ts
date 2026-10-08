/** `sipcode forecast` with Claude Code and Codex logs on the same machine. */
import { describe, expect, it } from "vitest";
import { runForecastCmd } from "../../src/commands/forecast.js";
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
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0 },
    },
  });

function claudeFs(): InMemoryFs {
  const fs = new InMemoryFs();
  for (const [id, ts] of [["a", "2026-05-05T10:00:00Z"], ["b", "2026-05-19T10:00:00Z"]] as const) {
    fs.writeFile(`/home/u/.claude/projects/C--p/${id}.jsonl`, claudeReq(id, ts), Date.parse(ts) + 60_000);
  }
  return fs;
}
const withCodex = (fs: InMemoryFs = claudeFs()) => {
  addCodexRollout(fs, "cx1", [solTurn("2026-05-06T10:00:00Z", 100_000, 10_000)]);
  addCodexRollout(fs, "cx2", [solTurn("2026-05-19T10:00:00Z", 100_000, 10_000)]);
  return fs;
};

async function run(opts: Parameters<typeof runForecastCmd>[0], fs: InMemoryFs) {
  const out: string[] = [];
  const err: string[] = [];
  const r = await runForecastCmd(opts, {
    fs,
    env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
    clock: new FakeClock(NOW),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  });
  return { exitCode: r.exitCode, out: out.join("\n"), err: err.join("\n") };
}

describe("runForecastCmd: Claude Code and Codex sections", () => {
  it("shows both sections, then a dollars-only combined line", async () => {
    const r = await run({}, withCodex());
    expect(r.exitCode).toBe(0);
    expect(r.out).toContain("── Claude Code ──");
    expect(r.out).toContain("── Codex ──");
    expect(r.out).toMatch(/^Both tools: ~\$\S+ \+ ~\$\S+$/m);
    expect(r.out).not.toMatch(/Both tools: .*tokens/);
  });

  it("Claude Code alone is unchanged: no headers, no combined line", async () => {
    const r = await run({}, claudeFs());
    expect(r.out.startsWith("sipcode forecast · ")).toBe(true);
    expect(r.out).not.toContain("──");
    expect(r.out).not.toContain("Both tools");
  });

  it("works for a Codex-only user", async () => {
    const r = await run({}, withCodex(new InMemoryFs()));
    expect(r.exitCode).toBe(0);
    expect(r.out.startsWith("sipcode forecast · ")).toBe(true);
    expect(r.out).toContain("projected month-end");
  });

  it("an agent with no logs names itself in the empty state", async () => {
    const r = await run({ agent: "codex" }, new InMemoryFs());
    expect(r.out).toContain("No Codex sessions found yet. Run `codex` in any project to start.");
  });

  it("JSON with both installed is the unchanged Claude Code JSON plus a stderr note", async () => {
    const claudeOnly = await run({ json: true }, claudeFs());
    const both = await run({ json: true }, withCodex());
    expect(both.out).toBe(claudeOnly.out);
    expect(both.err).toMatch(/--agent codex/);
    const codex = JSON.parse((await run({ json: true, agent: "codex" }, withCodex())).out);
    expect(codex.status).toBe("ok");
    // Codex spend only: two sessions of 100,000 in + 10,000 out on gpt-6.1-sol ($0.30 each).
    expect(codex.monthEnd.spendSoFarUSD).toBeCloseTo(0.6, 6);
  });

  it("names unpriced tokens under the projected spend", async () => {
    const fs = withCodex(new InMemoryFs());
    addCodexRollout(fs, "cx3", [autoReviewTurn("2026-05-18T10:00:00Z")]);
    const r = await run({}, fs);
    const lines = r.out.split("\n");
    const spend = lines.findIndex((l) => l.startsWith("    spend "));
    expect(lines[spend + 1]).toBe(
      "    20,503 tokens on models without a known price (codex-auto-review): not included in the cost above.",
    );
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
