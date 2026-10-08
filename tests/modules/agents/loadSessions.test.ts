import { describe, expect, it } from "vitest";
import { InMemoryFs, type FileSystem } from "../../../src/lib/fs.js";
import { FakeClock } from "../../../src/lib/clock.js";
import { FakeProcessEnv } from "../../../src/lib/process.js";
import { claudeCodeAgent } from "../../../src/modules/agents/claude-code/adapter.js";
import { loadSessions } from "../../../src/modules/agents/loadSessions.js";

const req = (id: string, ts: string) =>
  JSON.stringify({
    type: "assistant",
    requestId: `req_${id}`,
    timestamp: ts,
    sessionId: "s",
    message: {
      id: `msg_${id}`,
      model: "claude-opus-5",
      role: "assistant",
      content: [{ type: "text", text: "." }],
      usage: {
        input_tokens: 1,
        output_tokens: 10,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 0,
      },
    },
  });

function deps() {
  const fs = new InMemoryFs();
  // b.jsonl is a resumed session: it repeats request 1 (original timestamp) and adds request 2.
  fs.writeFile(
    "/home/u/.claude/projects/C--p/a.jsonl",
    req("1", "2026-09-01T10:00:00Z"),
    Date.parse("2026-09-01T10:01:00Z"),
  );
  fs.writeFile(
    "/home/u/.claude/projects/C--p/b.jsonl",
    [req("1", "2026-09-01T10:00:00Z"), req("2", "2026-09-02T10:00:00Z")].join("\n"),
    Date.parse("2026-09-02T10:01:00Z"),
  );
  fs.writeFile(
    "/home/u/.claude/projects/C--q/c.jsonl",
    req("3", "2026-09-03T10:00:00Z"),
    Date.parse("2026-09-03T10:01:00Z"),
  );
  return {
    fs,
    env: new FakeProcessEnv({ homeDir: "/home/u" }),
    clock: new FakeClock(new Date("2026-10-01T00:00:00Z")),
  };
}

describe("loadSessions", () => {
  it("counts a request repeated in a resumed file once", async () => {
    const r = await loadSessions({ agent: claudeCodeAgent, deps: deps(), cwd: "/" });
    if (!r.ok) throw new Error("load failed");
    const turns = r.value.sessions.reduce((n, s) => n + s.parsed.assistantTurns.length, 0);
    expect(turns).toBe(3);
    expect(r.value.droppedDuplicateRequests).toBe(1);
    expect(r.value.discovered).toBe(3);
  });

  it("applies --here through the agent", async () => {
    const r = await loadSessions({
      agent: claudeCodeAgent,
      deps: deps(),
      cwd: "C:\\q",
      here: true,
    });
    if (!r.ok) throw new Error("load failed");
    expect(r.value.sessions.map((s) => s.meta.sessionId)).toEqual(["c"]);
  });

  it("dedupes across ALL discovered sessions (no time pre-filter), so windows stay consistent", async () => {
    const r = await loadSessions({ agent: claudeCodeAgent, deps: deps(), cwd: "/" });
    if (!r.ok) throw new Error("load failed");
    const b = r.value.sessions.find((s) => s.meta.sessionId === "b")!;
    expect(b.parsed.assistantTurns.map((t) => t.requestKey)).toEqual(["msg_2|req_2"]);
    expect(b.parsed.startedAt).toBe("2026-09-02T10:00:00Z");
  });

  it("counts unreadable files instead of silently dropping them", async () => {
    const d = deps();
    const base: FileSystem = d.fs;
    const failingFs: FileSystem = {
      exists: (p) => base.exists(p),
      readDir: (p) => base.readDir(p),
      stat: (p) => base.stat(p),
      readFile: async (p) => {
        if (p.endsWith("c.jsonl")) throw new Error("EACCES");
        return base.readFile(p);
      },
    };
    const r = await loadSessions({
      agent: claudeCodeAgent,
      deps: { ...d, fs: failingFs },
      cwd: "/",
    });
    if (!r.ok) throw new Error("load failed");
    expect(r.value.unreadable).toBe(1);
    expect(r.value.sessions).toHaveLength(2);
  });
});
