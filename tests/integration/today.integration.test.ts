/** `sipcode today` with Claude Code and Codex logs on the same machine. */
import { describe, expect, it } from "vitest";
import { runTodayCmd } from "../../src/commands/today.js";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import { addCodexRollout, autoReviewTurn, CODEX_SESSIONS, solTurn } from "./codex-fixtures.js";

const NOW = new Date("2026-05-10T15:00:00.000Z");

const claudeReq = (id: string, ts: string) =>
  JSON.stringify({
    type: "assistant",
    requestId: `req_${id}`,
    timestamp: ts,
    sessionId: "s",
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
  fs.writeFile(
    "/home/u/.claude/projects/C--p/a.jsonl",
    claudeReq("1", "2026-05-10T10:00:00Z"),
    Date.parse("2026-05-10T10:01:00Z"),
  );
  return fs;
}
const withCodex = (fs: InMemoryFs = claudeFs()) => {
  addCodexRollout(fs, "cx1", [solTurn("2026-05-10T11:00:00Z")]);
  return fs;
};

async function run(opts: Parameters<typeof runTodayCmd>[0], fs: InMemoryFs) {
  const out: string[] = [];
  const err: string[] = [];
  const r = await runTodayCmd(opts, {
    fs,
    env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
    clock: new FakeClock(NOW),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  });
  return { exitCode: r.exitCode, out: out.join("\n"), err: err.join("\n") };
}

describe("runTodayCmd: Claude Code and Codex sections", () => {
  it("shows a Claude Code section and a Codex section, then the combined line", async () => {
    const r = await run({}, withCodex());
    expect(r.exitCode).toBe(0);
    expect(r.out).toContain("── Claude Code ──");
    expect(r.out).toContain("── Codex ──");
    expect(r.out).toMatch(/Both tools: .* tokens · ~\$.* \+ ~\$0\.00$/m);
  });

  it("Claude Code alone is unchanged: no headers, no combined line", async () => {
    const r = await run({}, claudeFs());
    expect(r.out.startsWith("sipcode today · ")).toBe(true);
    expect(r.out).not.toContain("──");
    expect(r.out).not.toContain("Both tools");
  });

  it("works for a Codex-only user and shows Codex spend", async () => {
    const r = await run({}, withCodex(new InMemoryFs()));
    expect(r.exitCode).toBe(0);
    expect(r.out.startsWith("sipcode today · ")).toBe(true);
    expect(r.out).toContain("spend so far          $0.00  across 1 session");
    expect(r.out).toContain("tokens so far        1.1K");
  });

  it("an agent with no logs names itself in the empty state", async () => {
    const r = await run({ agent: "codex" }, new InMemoryFs());
    expect(r.exitCode).toBe(0);
    expect(r.out).toContain("No Codex sessions found yet. Run `codex` in any project to start.");
    const claude = await run({}, new InMemoryFs());
    expect(claude.out).toContain("No Claude Code sessions found yet. Run `claude` in any project to start.");
  });

  it("JSON with both installed is the unchanged Claude Code JSON plus a stderr note", async () => {
    const claudeOnly = await run({ json: true }, claudeFs());
    const both = await run({ json: true }, withCodex());
    expect(both.out).toBe(claudeOnly.out);
    expect(both.err).toMatch(/--agent codex/);
    const codex = JSON.parse((await run({ json: true, agent: "codex" }, withCodex())).out);
    expect(codex.today.totalTokens).toBe(1100);
  });

  it("names unpriced tokens under today's spend and marks the combined line", async () => {
    const fs = claudeFs();
    addCodexRollout(fs, "cx1", [solTurn("2026-05-10T11:00:00Z"), autoReviewTurn("2026-05-10T11:05:00Z")]);
    const r = await run({}, fs);
    const lines = r.out.split("\n");
    const codexAt = lines.indexOf("── Codex ──");
    const spend = lines.findIndex((l, i) => i > codexAt && l.startsWith("  spend so far"));
    expect(lines[spend + 1]).toBe(
      "  20,503 tokens on models without a known price (codex-auto-review): not included in the cost above.",
    );
    expect(r.out).toMatch(/\(\+ unpriced\)$/m);
  });

  it("reports skipped compressed Codex logs once, on stderr", async () => {
    const fs = withCodex(new InMemoryFs());
    fs.writeFile(`${CODEX_SESSIONS}/2026/05/09/rollout-a.jsonl.zst`, "z", 1);
    fs.writeFile(`${CODEX_SESSIONS}/2026/05/09/rollout-b.jsonl.zst`, "z", 1);
    const r = await run({}, fs);
    expect(r.err).toBe(
      "note: 2 compressed Codex log(s) (.jsonl.zst) skipped: Sipcode cannot read compressed logs yet.",
    );
  });
});
