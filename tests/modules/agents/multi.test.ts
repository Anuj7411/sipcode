import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../../src/lib/fs.js";
import { FakeClock } from "../../../src/lib/clock.js";
import { FakeProcessEnv } from "../../../src/lib/process.js";
import { ok } from "../../../src/lib/result.js";
import { issue } from "../../../src/lib/errors.js";
import { claudeCodeAgent } from "../../../src/modules/agents/claude-code/adapter.js";
import { discoverAgentSessions } from "../../../src/modules/agents/loadSessions.js";
import {
  combinedLine,
  resolveDisplayAgents,
  sectionHeader,
} from "../../../src/modules/agents/multi.js";
import type { Agent } from "../../../src/modules/agents/types.js";

function setup(o: { claude?: boolean; codex?: boolean; cursorGlobal?: boolean; cwdClaudeMd?: boolean; cwdCursor?: boolean }) {
  const fs = new InMemoryFs();
  if (o.claude) fs.writeFile("/h/.claude/projects/p/a.jsonl", "", 1);
  if (o.codex) fs.writeFile("/h/.codex/sessions/2026/10/01/rollout-a.jsonl", "", 1);
  if (o.cursorGlobal) fs.mkdir("/h/.cursor");
  if (o.cwdClaudeMd) fs.writeFile("/w/CLAUDE.md", "x", 1);
  if (o.cwdCursor) fs.mkdir("/w/.cursor");
  return {
    fs,
    env: new FakeProcessEnv({ homeDir: "/h" }),
    clock: new FakeClock(new Date("2026-10-08")),
  };
}

async function ids(
  o: Parameters<typeof setup>[0],
  agent?: string,
  json = false,
  err: string[] = [],
): Promise<string[] | false> {
  const r = await resolveDisplayAgents({
    agent,
    ...setup(o),
    cwd: "/w",
    json,
    stderr: (s) => err.push(s),
  });
  return r.ok && r.agents.map((a) => a.id);
}

describe("resolveDisplayAgents", () => {
  it("shows both when Claude Code has transcripts and Codex is installed", async () => {
    expect(await ids({ claude: true, codex: true })).toEqual(["claude-code", "codex"]);
  });

  it("shows Claude Code alone when Codex is not installed (unchanged)", async () => {
    expect(await ids({ claude: true })).toEqual(["claude-code"]);
  });

  it("falls back to Claude Code when nothing is installed (unchanged)", async () => {
    expect(await ids({})).toEqual(["claude-code"]);
  });

  it("uses Codex alone when only Codex is installed", async () => {
    expect(await ids({ codex: true })).toEqual(["codex"]);
  });

  it("uses Codex alone when CLAUDE.md is here but Claude Code has no transcripts", async () => {
    expect(await ids({ codex: true, cwdClaudeMd: true })).toEqual(["codex"]);
  });

  it("keeps a cursor pick and adds a Codex section", async () => {
    expect(await ids({ cwdCursor: true, codex: true })).toEqual(["cursor", "codex"]);
    expect(await ids({ cursorGlobal: true, codex: true })).toEqual(["cursor", "codex"]);
    expect(await ids({ cursorGlobal: true })).toEqual(["cursor"]);
  });

  it("JSON stays one agent (the first) and notes Codex on stderr", async () => {
    const err: string[] = [];
    expect(await ids({ claude: true, codex: true }, undefined, true, err)).toEqual(["claude-code"]);
    expect(err.join("\n")).toMatch(/--agent codex/);
    expect(err.join("\n")).toMatch(/Claude Code/);
  });

  it("JSON with only one agent available prints no note", async () => {
    const err: string[] = [];
    expect(await ids({ codex: true }, undefined, true, err)).toEqual(["codex"]);
    expect(await ids({ claude: true }, undefined, true, err)).toEqual(["claude-code"]);
    expect(err).toEqual([]);
  });

  it("honours an explicit --agent", async () => {
    expect(await ids({ claude: true, codex: true }, "codex")).toEqual(["codex"]);
    expect(await ids({ claude: true, codex: true }, "claude-code")).toEqual(["claude-code"]);
    expect(await ids({}, "codex")).toEqual(["codex"]);
  });

  it("treats --agent auto like no flag", async () => {
    expect(await ids({ claude: true, codex: true }, "auto")).toEqual(["claude-code", "codex"]);
  });

  it("rejects an unknown --agent", async () => {
    const err: string[] = [];
    expect(await ids({ claude: true }, "nope", false, err)).toBe(false);
    expect(err.join("\n")).toMatch(/nope/);
  });

  it("returns the detection result for the single-agent banner", async () => {
    const r = await resolveDisplayAgents({ agent: undefined, ...setup({ claude: true }), cwd: "/w", json: false, stderr: () => {} });
    expect(r.ok && r.detect.explicit).toBe(false);
  });
});

describe("combined line and header", () => {
  it("formats both tools' totals with the shared formatters", () => {
    expect(
      combinedLine([
        { tokens: 13_100_000_000, usd: 10888 },
        { tokens: 25_500_000, usd: 41.2 },
      ]),
    ).toBe("Both tools: 13.1B tokens · ~$10,888 + ~$41");
  });

  it("prints only the dollar parts when there are no tokens (forecast)", () => {
    expect(combinedLine([{ tokens: 0, usd: 120.4 }, { tokens: 0, usd: 0.42 }])).toBe(
      "Both tools: ~$120 + ~$0.42",
    );
  });

  it("marks a part that has unpriced tokens", () => {
    expect(
      combinedLine([
        { tokens: 1_000, usd: 2 },
        { tokens: 2_000, usd: 3, unpriced: true },
      ]),
    ).toBe("Both tools: 3.0k tokens · ~$2 + ~$3 (+ unpriced)");
  });

  it("names the agent in the section header", () => {
    expect(sectionHeader("Codex")).toBe("── Codex ──");
  });
});

describe("discoverAgentSessions", () => {
  const deps = setup({});
  const meta = { sessionId: "s", filePath: "/x.jsonl", projectHash: "p", mtimeMs: 1, size: 1 };

  function fake(result: Awaited<ReturnType<Agent["discoverSessions"]>>): Agent {
    return { ...claudeCodeAgent, discoverSessions: async () => result };
  }

  it("normalises a bare SessionMeta[]", async () => {
    const r = await discoverAgentSessions(fake(ok([meta])), deps);
    expect(r.ok && r.value).toEqual({
      sessions: [meta],
      unreadable: 0,
      unreadableFolders: 0,
      skippedCompressed: 0,
      issues: [],
    });
  });

  it("passes a full discovery through", async () => {
    const i = issue("E009", "x");
    const r = await discoverAgentSessions(
      fake(ok({ sessions: [meta], unreadable: 2, skippedCompressed: 3, issues: [i] })),
      deps,
    );
    expect(r.ok && r.value).toEqual({
      sessions: [meta],
      unreadable: 2,
      unreadableFolders: 0,
      skippedCompressed: 3,
      issues: [i],
    });
  });

  it("passes an error through", async () => {
    const r = await discoverAgentSessions(fake({ ok: false, error: [issue("E009", "no")] }), deps);
    expect(r.ok).toBe(false);
  });
});
