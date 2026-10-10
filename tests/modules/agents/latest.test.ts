import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../../src/lib/fs.js";
import { FakeClock } from "../../../src/lib/clock.js";
import { FakeProcessEnv } from "../../../src/lib/process.js";
import { claudeCodeAgent } from "../../../src/modules/agents/claude-code/adapter.js";
import { codexAgent } from "../../../src/modules/agents/codex/adapter.js";
import {
  listAgentSessions,
  otherAgentHint,
  pickFrom,
  type PickOptions,
} from "../../../src/modules/agents/latest.js";
import type { Agent, AgentDeps } from "../../../src/modules/agents/types.js";

/** What why / receipt / drift do: list each tool's sessions, then pick. */
async function pickLatestSession(i: { agents: Agent[]; deps: AgentDeps; cwd: string; here?: boolean } & PickOptions) {
  return pickFrom(await listAgentSessions(i), i.deps, i);
}

const claudeReq = (sessionId: string, requestId = "q1", tokens = 5) =>
  JSON.stringify({ type: "assistant", requestId, timestamp: "2026-10-01T10:00:00Z", sessionId,
    message: { id: `m-${requestId}`, model: "claude-opus-5", role: "assistant", content: [{ type: "text", text: "." }], usage: { input_tokens: tokens, output_tokens: tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
const codexRollout = (id: string, day: string, extra: Record<string, unknown> = {}, tokens = 10) => [
  JSON.stringify({ timestamp: `${day}T10:00:00Z`, type: "session_meta", payload: { id, session_id: id, cwd: "C:\\p", ...extra } }),
  JSON.stringify({ timestamp: `${day}T10:00:01Z`, type: "turn_context", payload: { turn_id: `${id}-u1`, model: "gpt-6.1-sol" } }),
  JSON.stringify({ timestamp: `${day}T10:00:02Z`, type: "token_usage_record", payload: { turn_id: `${id}-u1`, response_id: `${id}-r1`, usage: { input_tokens: tokens, output_tokens: tokens ? 1 : 0, total_tokens: tokens ? tokens + 1 : 0 } } }),
].join("\n");

function deps() {
  const fs = new InMemoryFs();
  fs.writeFile("/h/.claude/projects/C--p/cl1.jsonl", claudeReq("cl1"), Date.parse("2026-10-01T10:01:00Z"));
  fs.writeFile("/h/.codex/sessions/2026/10/02/rollout-cx1.jsonl", codexRollout("cx1", "2026-10-02"), Date.parse("2026-10-02T10:01:00Z"));
  return { fs, env: new FakeProcessEnv({ homeDir: "/h" }), clock: new FakeClock(new Date("2026-10-08")) };
}

const both = [claudeCodeAgent, codexAgent];

describe("pickLatestSession", () => {
  it("picks the most recent non-empty session across agents and hints the other", async () => {
    const r = await pickLatestSession({ agents: both, deps: deps(), cwd: "/" });
    expect(r?.chosen.agent.id).toBe("codex");
    expect(r?.ambiguous).toBe(false);
    expect(r?.others.map((o) => [o.agent.id, o.meta.sessionId])).toEqual([["claude-code", "cl1"]]);
  });

  it("never picks a Codex subagent thread as the latest session", async () => {
    const d = deps();
    d.fs.writeFile("/h/.codex/sessions/2026/10/03/rollout-sub1.jsonl", codexRollout("sub1", "2026-10-03", { parent_thread_id: "cx1" }), Date.parse("2026-10-03T10:01:00Z"));
    const r = await pickLatestSession({ agents: both, deps: d, cwd: "/" });
    expect(r?.chosen.meta.sessionId).toBe("cx1");
  });

  it("a subagent thread is still selectable by an explicit --session", async () => {
    const d = deps();
    d.fs.writeFile("/h/.codex/sessions/2026/10/03/rollout-sub1.jsonl", codexRollout("sub1", "2026-10-03", { parent_thread_id: "cx1" }), Date.parse("2026-10-03T10:01:00Z"));
    const r = await pickLatestSession({ agents: both, deps: d, cwd: "/", sessionIdPrefix: "sub" });
    expect(r?.chosen.meta.sessionId).toBe("sub1");
    expect(r?.chosen.parsed.isSubagent).toBe(true);
  });

  it("finds a session by id prefix in any agent", async () => {
    const r = await pickLatestSession({ agents: both, deps: deps(), cwd: "/", sessionIdPrefix: "cl1" });
    expect(r?.chosen.agent.id).toBe("claude-code");
    expect(r?.ambiguous).toBe(false);
    expect(r?.others).toEqual([]);
  });

  it("flags a prefix that matches sessions in more than one agent", async () => {
    const d = deps();
    d.fs.writeFile("/h/.claude/projects/C--p/c-shared.jsonl", claudeReq("c-shared"), Date.parse("2026-10-01T11:00:00Z"));
    d.fs.writeFile("/h/.codex/sessions/2026/10/02/rollout-cx2.jsonl", codexRollout("c-other", "2026-10-02"), Date.parse("2026-10-02T11:00:00Z"));
    const r = await pickLatestSession({ agents: both, deps: d, cwd: "/", sessionIdPrefix: "c" });
    expect(r?.ambiguous).toBe(true);
    expect([r!.chosen, ...r!.others].map((p) => [p.agent.id, p.meta.sessionId])).toEqual([
      ["codex", "c-other"],
      ["claude-code", "c-shared"],
    ]);
  });

  it("several matches inside one agent keep today's rule: the newest match", async () => {
    const d = deps();
    d.fs.writeFile("/h/.claude/projects/C--p/cl1b.jsonl", claudeReq("cl1b"), Date.parse("2026-10-01T12:00:00Z"));
    const r = await pickLatestSession({ agents: both, deps: d, cwd: "/", sessionIdPrefix: "cl1" });
    expect(r?.ambiguous).toBe(false);
    expect(r?.chosen.meta.sessionId).toBe("cl1b");
  });

  it("skips empty sessions when auto-picking, but an explicit id may name one", async () => {
    const d = deps();
    d.fs.writeFile("/h/.codex/sessions/2026/10/04/rollout-empty.jsonl", codexRollout("empty", "2026-10-04", {}, 0), Date.parse("2026-10-04T10:01:00Z"));
    expect((await pickLatestSession({ agents: both, deps: d, cwd: "/" }))?.chosen.meta.sessionId).toBe("cx1");
    expect((await pickLatestSession({ agents: both, deps: d, cwd: "/", sessionIdPrefix: "emp" }))?.chosen.meta.sessionId).toBe("empty");
  });

  it("skipEmpty: false takes the newest session even when it is empty (receipt)", async () => {
    const d = deps();
    d.fs.writeFile("/h/.codex/sessions/2026/10/04/rollout-empty.jsonl", codexRollout("empty", "2026-10-04", {}, 0), Date.parse("2026-10-04T10:01:00Z"));
    const r = await pickLatestSession({ agents: both, deps: d, cwd: "/", skipEmpty: false });
    expect(r?.chosen.meta.sessionId).toBe("empty");
  });

  it("falls back to the newest session when every session is empty", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/h/.claude/projects/C--p/a.jsonl", claudeReq("a", "q1", 0), 1_000);
    fs.writeFile("/h/.claude/projects/C--p/b.jsonl", claudeReq("b", "q2", 0), 2_000);
    const d = { fs, env: new FakeProcessEnv({ homeDir: "/h" }), clock: new FakeClock(new Date("2026-10-08")) };
    const r = await pickLatestSession({ agents: both, deps: d, cwd: "/" });
    expect(r?.chosen.meta.sessionId).toBe("b");
    expect(r?.others).toEqual([]);
  });

  it("an agent with no non-empty session gets no hint", async () => {
    const d = deps();
    d.fs.writeFile("/h/.claude/projects/C--p/cl1.jsonl", claudeReq("cl1", "q1", 0), Date.parse("2026-10-01T10:01:00Z"));
    const r = await pickLatestSession({ agents: both, deps: d, cwd: "/" });
    expect(r?.chosen.agent.id).toBe("codex");
    expect(r?.others).toEqual([]);
  });

  it("--here scopes the auto-pick, while an explicit id is found anywhere (as today)", async () => {
    const d = deps();
    // Codex session cx1 ran in C:\p; the cwd is elsewhere.
    const here = await pickLatestSession({ agents: both, deps: d, cwd: "C:\\elsewhere", here: true });
    expect(here).toBeUndefined();
    const byId = await pickLatestSession({ agents: both, deps: d, cwd: "C:\\elsewhere", here: true, sessionIdPrefix: "cx1" });
    expect(byId?.chosen.meta.sessionId).toBe("cx1");
    const inP = await pickLatestSession({ agents: [codexAgent], deps: d, cwd: "C:\\p", here: true });
    expect(inP?.chosen.meta.sessionId).toBe("cx1");
  });

  it("returns undefined when nothing matches", async () => {
    expect(await pickLatestSession({ agents: both, deps: deps(), cwd: "/", sessionIdPrefix: "zzz" })).toBeUndefined();
  });
});

describe("listAgentSessions + pickFrom", () => {
  it("lists every agent's sessions, all and --here scoped, newest first", async () => {
    const lists = await listAgentSessions({ agents: both, deps: deps(), cwd: "C:\\p", here: true });
    expect(lists.map((l) => [l.agent.id, l.all.length, l.scoped.length])).toEqual([
      ["claude-code", 1, 1],
      ["codex", 1, 1],
    ]);
    const r = await pickFrom(lists, deps(), {});
    expect(r?.chosen.meta.sessionId).toBe("cx1");
  });
});

describe("otherAgentHint", () => {
  it("names the tool, the short id and the flag", async () => {
    const r = await pickLatestSession({ agents: both, deps: deps(), cwd: "/" });
    expect(otherAgentHint(r!.others[0]!)).toBe(
      "Claude Code also has a recent session (cl1): run with --agent claude-code.",
    );
  });
});
