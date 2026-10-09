/** `sipcode impact` with Claude Code and Codex logs on the same machine. */
import { describe, expect, it } from "vitest";
import { runImpactCommand } from "../../src/commands/impact.js";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import { addCodexRollout, autoReviewTurn, CODEX_SESSIONS, solTurn } from "./codex-fixtures.js";

const NOW = new Date("2026-05-20T12:00:00.000Z");
// A folder with no .sipcode/install-state.json: no install marker.
const CWD = "/nonexistent-sipcode-impact-test";

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
  for (const [id, ts] of [["a", "2026-05-02T10:00:00Z"], ["b", "2026-05-15T10:00:00Z"]] as const) {
    fs.writeFile(`/home/u/.claude/projects/C--p/${id}.jsonl`, claudeReq(id, ts), Date.parse(ts) + 60_000);
  }
  return fs;
}
const withCodex = (fs: InMemoryFs = claudeFs()) => {
  addCodexRollout(fs, "cx1", [solTurn("2026-05-03T10:00:00Z")]);
  addCodexRollout(fs, "cx2", [solTurn("2026-05-16T10:00:00Z")]);
  return fs;
};

async function run(opts: Parameters<typeof runImpactCommand>[0], fs: InMemoryFs) {
  const out: string[] = [];
  const err: string[] = [];
  const r = await runImpactCommand(
    { cwd: CWD, ...opts },
    {
      fs,
      env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
      clock: new FakeClock(NOW),
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    },
  );
  return { exitCode: r.exitCode, out: out.join("\n"), err: err.join("\n"), outLines: out };
}

describe("runImpactCommand: Claude Code and Codex sections", () => {
  it("shows both sections and no combined line (before/after does not add up)", async () => {
    const r = await run({ since: "2026-05-10" }, withCodex());
    expect(r.exitCode).toBe(0);
    expect(r.out).toContain("── Claude Code ──");
    expect(r.out).toContain("── Codex ──");
    expect(r.out).not.toContain("Both tools");
    expect(r.out).not.toContain("detected agent:");
    expect(r.out.match(/sipcode impact · before vs after/g)).toHaveLength(2);
  });

  it("Claude Code alone is unchanged: banner, no headers", async () => {
    const r = await run({}, claudeFs());
    expect(r.outLines[0]).toBe("detected agent: claude-code (auto). pass --agent to override.");
    expect(r.out).not.toContain("── Claude Code ──");
    expect(r.out).toContain("all-time totals (across every Claude Code session on disk):");
  });

  it("works for a Codex-only user: Codex sessions, not 'no sessions on disk'", async () => {
    const r = await run({}, withCodex(new InMemoryFs()));
    expect(r.exitCode).toBe(0);
    expect(r.outLines[0]).toBe("detected agent: codex (auto). pass --agent to override.");
    expect(r.out).not.toContain("no sessions on disk yet");
    expect(r.out).toContain("all-time totals (across every Codex session on disk):");
    expect(r.out).toContain("  sessions:       2");
  });

  it("an agent with no logs names its own start command", async () => {
    const r = await run({ agent: "codex" }, new InMemoryFs());
    expect(r.out).toContain("no sessions on disk yet: run `codex` in a project");
    const claude = await run({}, new InMemoryFs());
    expect(claude.out).toContain("no sessions on disk yet: run `claude` in a project");
  });

  it("JSON with both installed is the unchanged Claude Code JSON plus a stderr note", async () => {
    const claudeOnly = await run({ json: true }, claudeFs());
    const both = await run({ json: true }, withCodex());
    expect(both.out).toBe(claudeOnly.out);
    expect(both.err).toMatch(/--agent codex/);
    const codex = JSON.parse((await run({ json: true, agent: "codex" }, withCodex())).out);
    expect(codex.allTime.sessionCount).toBe(2);
  });

  it("names unpriced tokens under the spend", async () => {
    const fs = withCodex(new InMemoryFs());
    addCodexRollout(fs, "cx3", [autoReviewTurn("2026-05-17T10:00:00Z")]);
    const r = await run({}, fs);
    const lines = r.out.split("\n");
    const spend = lines.findIndex((l) => l.startsWith("  total spend:"));
    expect(lines[spend + 1]).toBe(
      "  20,503 tokens on models without a known price (codex-auto-review): not included in the cost above.",
    );
    const measured = await run({ since: "2026-05-10" }, fs);
    expect(measured.out).toContain(
      "20,503 tokens on models without a known price (codex-auto-review): not included in the cost above.",
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

describe("runImpactCommand --agent cursor", () => {
  it("prints the same coded E009 as the other commands", async () => {
    const { MESSAGES } = await import("../../src/lib/messages.js");
    const r = await run({ agent: "cursor" }, claudeFs());
    expect(r.exitCode).toBe(1);
    expect(r.err).toBe(MESSAGES.cursorTranscriptNotSupported());
  });
});

describe("runImpactCommand: Codex with no install marker", () => {
  it("never tells Codex users to run rules --install (it returns E009 for Codex)", async () => {
    for (const fs of [withCodex(new InMemoryFs()), new InMemoryFs()]) {
      const r = await run({ agent: "codex" }, fs);
      expect(r.out).not.toContain("rules --install");
      expect(r.out).toContain("not supported for Codex yet");
      expect(r.out).toContain("--since YYYY-MM-DD");
      const j = JSON.parse((await run({ agent: "codex", json: true }, fs)).out);
      expect(JSON.stringify(j)).not.toContain("rules --install");
      expect(j.headline).toContain("not supported for Codex yet");
    }
  });

  it("Claude Code keeps its rules --install advice", async () => {
    const r = await run({}, claudeFs());
    expect(r.out).toContain("sipcode rules --install");
  });
});

