/**
 * Commands that do not read Codex sessions yet must say so for --agent codex,
 * never fall through to Claude Code data under a Codex flag. (why and receipt
 * read Codex now: see single-session-agents.integration.test.ts.)
 */
import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import { runEstimate } from "../../src/commands/estimate.js";

const claudeReq = JSON.stringify({
  type: "assistant",
  requestId: "q1",
  timestamp: "2026-10-01T10:00:00Z",
  sessionId: "cl1",
  message: {
    id: "m1",
    model: "claude-opus-5",
    role: "assistant",
    content: [{ type: "text", text: "." }],
    usage: { input_tokens: 5, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  },
});

function deps() {
  const fs = new InMemoryFs();
  fs.writeFile("/h/.claude/projects/C--p/cl1.jsonl", claudeReq, Date.parse("2026-10-01T10:01:00Z"));
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    deps: {
      fs,
      env: new FakeProcessEnv({ homeDir: "/h" }),
      clock: new FakeClock(new Date("2026-10-08T00:00:00Z")),
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
      writeFile: async () => {},
    },
  };
}

describe("--agent codex on commands without Codex support yet", () => {
  const cases: Array<[string, (d: ReturnType<typeof deps>["deps"]) => Promise<{ exitCode: number }>]> = [
    ["estimate", (d) => runEstimate({ agent: "codex", task: "refactor auth" }, d)],
  ];
  for (const [name, run] of cases) {
    it(`${name} exits 1 with E009 instead of showing Claude Code data`, async () => {
      const { out, err, deps: d } = deps();
      const r = await run(d);
      expect(r.exitCode).toBe(1);
      expect(err.join("\n")).toContain("[E009]");
      expect(err.join("\n")).toContain(`sipcode ${name}`);
      expect(out.join("\n")).not.toContain("cl1");
    });
  }
});
