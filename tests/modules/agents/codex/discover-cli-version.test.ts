/** Codex discovery keeps the Codex version line 1 records (sipcode regress groups by it). */
import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../../../src/lib/fs.js";
import { listCodexSessions } from "../../../../src/modules/agents/codex/discover.js";

const line1 = (payload: Record<string, unknown>) =>
  JSON.stringify({ timestamp: "2026-10-01T10:00:00Z", type: "session_meta", payload });

describe("Codex discovery: cliVersion", () => {
  it("copies cli_version from line 1", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/c/sessions/2026/10/01/rollout-a.jsonl", line1({ id: "a", cwd: "/p", cli_version: "0.142.5" }), 1);
    const r = await listCodexSessions(fs, "/c");
    expect(r.sessions[0]!.cliVersion).toBe("0.142.5");
  });

  it("leaves it unset when line 1 has none", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/c/sessions/2026/10/01/rollout-b.jsonl", line1({ id: "b", cwd: "/p" }), 1);
    const r = await listCodexSessions(fs, "/c");
    expect(r.sessions[0]!.cliVersion).toBeUndefined();
    expect("cliVersion" in r.sessions[0]!).toBe(false);
  });
});
