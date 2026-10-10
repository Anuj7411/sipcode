/**
 * MCP session tools take an optional `agent` ("claude-code" | "codex").
 * Without it they answer like the CLI's --json: Claude Code when installed,
 * else Codex. The CLI's stderr note never leaks into a tool's text; when the
 * other tool has logs, a separate text item after the result says so.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import type { StoreIO } from "../../src/modules/drift/store.js";
import { callTool, listToolDefinitions, type McpToolDeps } from "../../src/mcp/server.js";
import { addCodexRollout, CODEX_SESSIONS, codexRollout, solTurn } from "../integration/codex-fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, "../fixtures/transcripts");
const loadFixture = (n: string) => readFileSync(path.join(fixtures, n), "utf-8");

const NOW = new Date("2026-05-15T00:00:00Z");
const SESSION_TOOLS = [
  "verify_sipcode_impact",
  "list_recent_sessions",
  "audit_latest_session",
  "get_session_stats",
  "get_today_summary",
  "forecast_monthly_spend",
  "get_drift_report",
];

function claudeFs(): InMemoryFs {
  const fs = new InMemoryFs();
  fs.writeFile(
    "/home/u/.claude/projects/test-proj/readheavy1.jsonl",
    loadFixture("read-heavy.jsonl"),
    new Date("2026-05-02T09:00:30Z").getTime(),
  );
  fs.writeFile(
    "/home/u/.claude/projects/test-proj/minimal01.jsonl",
    loadFixture("minimal-2turn.jsonl"),
    new Date("2026-05-01T10:00:45Z").getTime(),
  );
  return fs;
}

/** A Codex subagent thread of cx1, newer than everything else. */
function addSubagent(fs: InMemoryFs): void {
  const lines = codexRollout("sub1", "C:\\p", [solTurn("2026-05-12T10:00:00Z")]).split("\n");
  const meta = JSON.parse(lines[0]!) as { payload: Record<string, unknown> };
  meta.payload.parent_thread_id = "cx1";
  lines[0] = JSON.stringify(meta);
  fs.writeFile(`${CODEX_SESSIONS}/2026/05/12/rollout-sub1.jsonl`, lines.join("\n"), Date.parse("2026-05-12T10:01:00Z"));
}

/** Claude Code logs plus newer Codex rollouts (one of them a subagent thread). */
function bothFs(): InMemoryFs {
  const fs = claudeFs();
  addCodexRollout(fs, "cx1", [solTurn("2026-05-10T10:00:00Z")]);
  addSubagent(fs);
  return fs;
}

function codexOnlyFs(): InMemoryFs {
  const fs = new InMemoryFs();
  addCodexRollout(fs, "cx1", [solTurn("2026-05-10T10:00:00Z")]);
  return fs;
}

function memStoreIO(): StoreIO {
  const files = new Map<string, string>();
  return {
    async read(p) {
      return files.get(p) ?? null;
    },
    async write(p, c) {
      files.set(p, c);
    },
    async append(p, c) {
      files.set(p, (files.get(p) ?? "") + c);
    },
  };
}

function deps(fs: InMemoryFs): McpToolDeps {
  return {
    fs,
    env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
    clock: new FakeClock(NOW),
    cwd: "/w",
    drift: { now: NOW, homeDir: "/home/u", stateDir: "/state", storeIO: memStoreIO(), configPaths: [], configReader: async () => null },
  };
}

async function call(name: string, args: Record<string, unknown>, fs: InMemoryFs) {
  const r = await callTool(name, args, deps(fs));
  const texts = r.content.map((c) => (c.type === "text" ? c.text : ""));
  return { isError: r.isError === true, texts, text: texts[0] ?? "" };
}

describe("tool definitions", () => {
  it("the seven tools that read session logs take an optional agent; the count stays 15", () => {
    const defs = listToolDefinitions();
    expect(defs).toHaveLength(15);
    for (const d of defs) {
      const props = (d.inputSchema as { properties: Record<string, { enum?: string[] }> }).properties;
      if (SESSION_TOOLS.includes(d.name)) {
        expect(props["agent"]?.enum, d.name).toEqual(["claude-code", "codex"]);
        expect(d.description, d.name).toContain("Codex");
      } else {
        expect(props["agent"], d.name).toBeUndefined();
      }
    }
  });

  it("an invalid agent value is a clear tool error, not a crash", async () => {
    for (const name of SESSION_TOOLS) {
      const r = await call(name, { agent: "cursor" }, bothFs());
      expect(r.isError, name).toBe(true);
      expect(r.text, name).toMatch(/^Invalid arguments for .*agent/);
    }
  });
});

describe("list_recent_sessions", () => {
  it("agent codex lists Codex sessions and marks subagent threads", async () => {
    const r = await call("list_recent_sessions", { agent: "codex" }, bothFs());
    expect(r.isError).toBe(false);
    expect(r.texts).toHaveLength(1);
    const lines = r.text.split("\n");
    expect(lines[0]).toBe("Found 2 session(s). Showing 2 most recent:");
    expect(lines[2]).toMatch(/^sub1 .* \(subagent\)$/);
    expect(lines[3]).toMatch(/^cx1 /);
    expect(lines[3]).not.toContain("subagent");
  });

  it("without agent: Claude Code (as before), and a separate item names the Codex option", async () => {
    const r = await call("list_recent_sessions", {}, bothFs());
    expect(r.isError).toBe(false);
    expect(r.text).toContain("readheav");
    expect(r.text).not.toContain("cx1");
    expect(r.text).not.toContain("note:");
    expect(r.texts).toHaveLength(2);
    expect(r.texts[1]).toContain('agent: "codex"');
  });

  it("Codex ids started in the same minute are listed apart (UUIDv7 ids share 8 characters)", async () => {
    const fs = new InMemoryFs();
    addCodexRollout(fs, "0199a1b2-c3d4-7a11-8000-000000000001", [solTurn("2026-05-10T10:00:00Z")]);
    addCodexRollout(fs, "0199a1b2-c3f0-7b22-8000-000000000002", [solTurn("2026-05-10T10:00:30Z")]);
    const r = await call("list_recent_sessions", { agent: "codex" }, fs);
    const ids = r.text.split("\n").slice(2).map((l) => l.split(" ")[0]);
    expect(ids.sort()).toEqual(["0199a1b2-c3d4-7a11", "0199a1b2-c3f0-7b22"]);
    const audit = await call("audit_latest_session", { session_id: ids[0]! }, fs);
    expect(audit.isError).toBe(false);
  });

  it("Codex alone: lists Codex sessions without agent", async () => {
    const r = await call("list_recent_sessions", {}, codexOnlyFs());
    expect(r.text).toContain("cx1");
    expect(r.texts).toHaveLength(1);
  });
});

describe("audit_latest_session", () => {
  it("agent codex audits the newest Codex session that is not a subagent thread", async () => {
    const r = await call("audit_latest_session", { agent: "codex" }, bothFs());
    expect(r.isError).toBe(false);
    expect(r.texts).toHaveLength(1);
    const j = JSON.parse(r.text) as { header: { sessionIdShort: string } };
    expect(j.header.sessionIdShort).toBe("cx1");
  });

  it("without agent: Claude Code JSON, then the Codex hint as its own item", async () => {
    const r = await call("audit_latest_session", {}, bothFs());
    const j = JSON.parse(r.text) as { header: { sessionIdShort: string } };
    expect(j.header.sessionIdShort).not.toBe("cx1");
    expect(r.texts).toHaveLength(2);
    expect(r.texts[1]).toContain('agent: "codex"');
    expect(r.texts.join("\n")).not.toContain("note:");
  });

  it("a session_id only Codex has is found without agent", async () => {
    const r = await call("audit_latest_session", { session_id: "cx1" }, bothFs());
    expect(r.isError).toBe(false);
    expect((JSON.parse(r.text) as { header: { sessionIdShort: string } }).header.sessionIdShort).toBe("cx1");
  });

  it("a session_id prefix both tools match is an error listing the matches", async () => {
    const fs = bothFs();
    fs.writeFile(
      "/home/u/.claude/projects/test-proj/cx1-claude.jsonl",
      loadFixture("minimal-2turn.jsonl"),
      new Date("2026-05-03T10:00:00Z").getTime(),
    );
    const r = await call("audit_latest_session", { session_id: "cx1" }, fs);
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Claude Code: cx1-clau");
    expect(r.text).toContain("Codex: cx1");
    expect(r.text).toContain('agent: "claude-code"');
  });

  it("an unknown session_id is an error", async () => {
    const r = await call("audit_latest_session", { session_id: "zzz" }, bothFs());
    expect(r.isError).toBe(true);
    expect(r.text).toContain('no session matches "zzz"');
  });
});

describe("period tools", () => {
  it("get_session_stats: agent codex returns Codex totals", async () => {
    const claude = await call("get_session_stats", {}, bothFs());
    const codex = await call("get_session_stats", { agent: "codex" }, bothFs());
    const total = (t: string) => (JSON.parse(t) as { totals: { totalTokens: number } }).totals.totalTokens;
    expect(total(codex.text)).toBe(2_200); // cx1 + its subagent thread, 1,100 each
    expect(total(claude.text)).not.toBe(2_200);
    expect(claude.texts).toHaveLength(2);
    expect(codex.texts).toHaveLength(1);
  });

  it("get_today_summary and forecast_monthly_spend: agent codex reads Codex", async () => {
    for (const name of ["get_today_summary", "forecast_monthly_spend"]) {
      const r = await call(name, { agent: "codex" }, claudeFs());
      expect(r.isError, name).toBe(false);
      const j = JSON.parse(r.text) as { status: string; headline: string };
      expect(j.status, name).toBe("no-data");
      expect(j.headline, name).toContain("Codex");
    }
  });

  it("verify_sipcode_impact: agent codex reads Codex, and the JSON is the whole first item", async () => {
    const r = await call("verify_sipcode_impact", { agent: "codex", since: "2026-05-05", cwd: "/w" }, bothFs());
    expect(r.isError).toBe(false);
    // The JSON, then the label every Codex before/after carries.
    expect(r.texts).toEqual([r.text, "Sipcode does not act inside Codex yet, so this difference is not caused by Sipcode."]);
    expect(() => JSON.parse(r.text)).not.toThrow();
    const d = await call("verify_sipcode_impact", { since: "2026-05-05", cwd: "/w" }, bothFs());
    expect(() => JSON.parse(d.text)).not.toThrow();
    expect(d.texts).toHaveLength(2);
    expect(d.texts[1]).toContain('agent: "codex"');
  });

  it("verify_sipcode_impact: the no-marker diagnostic is its own item, after the JSON", async () => {
    const r = await call("verify_sipcode_impact", { agent: "codex" }, bothFs());
    expect(r.isError).toBe(false);
    expect(() => JSON.parse(r.text)).not.toThrow();
    expect(r.texts).toHaveLength(2);
    expect(r.texts[1]).toMatch(/^Could not auto-locate \.sipcode\/install-state\.json/);
  });

  it("get_drift_report: agent codex reads Codex; no stderr note in the result", async () => {
    const r = await call("get_drift_report", { agent: "codex" }, bothFs());
    expect(r.isError).toBe(false);
    expect(r.texts).toHaveLength(1);
    expect(() => JSON.parse(r.text)).not.toThrow();
    const d = await call("get_drift_report", {}, bothFs());
    expect(() => JSON.parse(d.text)).not.toThrow();
    expect(d.texts).toHaveLength(2);
    expect(d.texts.join("\n")).not.toContain("note:");
  });
});

describe("an empty Claude Code projects folder next to Codex logs", () => {
  it("audit_latest_session answers for Codex instead of failing", async () => {
    const fs = codexOnlyFs();
    fs.mkdir("/home/u/.claude/projects/test-proj");
    const r = await call("audit_latest_session", {}, fs);
    expect(r.isError).toBe(false);
    expect(r.text).toContain("cx1");
  });
});

