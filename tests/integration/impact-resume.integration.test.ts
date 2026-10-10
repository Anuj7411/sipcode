/**
 * A resumed session whose copied history predates the install marker and whose
 * own requests come after it: the copy counts once in "before", only the new
 * requests land in "after".
 */
import { describe, expect, it } from "vitest";
import { runImpactCommand } from "../../src/commands/impact.js";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";

const NOW = new Date("2026-05-19T12:00:00.000Z");
const DIR = "/home/u/.claude/projects/C--p";

function req(id: string, ts: string): string {
  return JSON.stringify({
    type: "assistant",
    requestId: `req_${id}`,
    timestamp: ts,
    sessionId: "s",
    message: {
      id: `msg_${id}`,
      model: "claude-opus-4-8",
      role: "assistant",
      content: [{ type: "text", text: "." }],
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 1_000_000,
        cache_creation_input_tokens: 0,
      },
    },
  });
}

describe("impact: resumed session crossing the install pivot", () => {
  it("counts copied history once in before; only new requests land in after", async () => {
    const fs = new InMemoryFs();
    fs.writeFile(`${DIR}/orig.jsonl`, req("1", "2026-05-01T10:00:00.000Z"), new Date("2026-05-01T10:05:00Z").getTime());
    fs.writeFile(
      `${DIR}/resumed.jsonl`,
      [req("1", "2026-05-01T10:00:00.000Z"), req("2", "2026-05-12T10:00:00.000Z")].join("\n"),
      new Date("2026-05-12T10:05:00Z").getTime(),
    );
    const out: string[] = [];
    const r = await runImpactCommand(
      { json: true, since: "2026-05-10", cwd: "/nonexistent-project" },
      {
        fs,
        env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
        clock: new FakeClock(NOW),
        stdout: (s) => out.push(s),
        stderr: () => {},
      },
    );
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(out.join("\n"));
    expect(j.before.sessionCount).toBe(1);
    expect(j.before.totalTokens).toBe(1_000_000);
    expect(j.after.sessionCount).toBe(1);
    expect(j.after.totalTokens).toBe(1_000_000);
  });
});
