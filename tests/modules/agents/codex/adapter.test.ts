import { describe, expect, it } from "vitest";
import { InMemoryFs, type FileSystem } from "../../../../src/lib/fs.js";
import { FakeClock } from "../../../../src/lib/clock.js";
import { FakeProcessEnv } from "../../../../src/lib/process.js";
import { codexAgent } from "../../../../src/modules/agents/codex/adapter.js";
import { getAgentById } from "../../../../src/modules/agents/registry.js";
import { parseAgentFlag } from "../../../../src/modules/agents/cli.js";
import { detectAgent } from "../../../../src/modules/agents/detect.js";
import { loadSessions } from "../../../../src/modules/agents/loadSessions.js";
import { analyzeTokens, isEmptySession } from "../../../../src/modules/transcript/analyzers/tokens.js";
import { loadPricingForDate } from "../../../../src/lib/pricing/load.js";
import type { SessionMeta } from "../../../../src/modules/agents/shared.js";

const deps = (fs: FileSystem) => ({ fs, env: new FakeProcessEnv({ homeDir: "/h", vars: { CODEX_HOME: "/c" } }), clock: new FakeClock(new Date("2026-10-08")) });

const meta = (id: string, cwd: string) =>
  JSON.stringify({ timestamp: "2026-10-01T10:00:00Z", type: "session_meta", payload: { id, session_id: id, cwd, cli_version: "0.160.0" } });
const ctx = JSON.stringify({ timestamp: "2026-10-01T10:00:00Z", type: "turn_context", payload: { turn_id: "t1", model: "gpt-5.5" } });
const record = (rid: string, input: number, output: number) =>
  JSON.stringify({
    timestamp: "2026-10-01T10:00:05Z",
    type: "token_usage_record",
    payload: { turn_id: "t1", response_id: rid, usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: output, total_tokens: input + output } },
  });
const rollout = (id: string, cwd: string, ...lines: string[]) => [meta(id, cwd), ctx, ...lines].join("\n");

const sessionAt = (cwd: string | undefined): SessionMeta => ({ sessionId: "s", filePath: "/f", projectHash: "x", mtimeMs: 0, size: 0, cwd });

describe("codex agent", () => {
  it("is registered and selectable with --agent codex", () => {
    expect(getAgentById("codex")).toBe(codexAgent);
    expect(parseAgentFlag("codex")).toEqual({ ok: true, selector: "codex" });
  });

  it("--agent auto keeps picking Claude Code when Codex is also installed", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/h/.claude/projects/p/a.jsonl", "", 1);
    fs.writeFile("/h/.codex/sessions/2026/10/01/rollout-a.jsonl", meta("a", "/p"), 1);
    const r = await detectAgent({ selector: "auto", fs, env: new FakeProcessEnv({ homeDir: "/h" }), cwd: "/p" });
    expect(r.agent).toBe("claude-code");
  });

  describe("isInstalled", () => {
    it("is false when CODEX_HOME/sessions does not exist", async () => {
      expect(await codexAgent.isInstalled(deps(new InMemoryFs()), "/")).toBe(false);
    });
    it("is false for an empty sessions folder", async () => {
      const fs = new InMemoryFs();
      fs.mkdir("/c/sessions/2026/10/01");
      expect(await codexAgent.isInstalled(deps(fs), "/")).toBe(false);
    });
    it("is false when sessions holds no rollout-*.jsonl", async () => {
      const fs = new InMemoryFs();
      fs.writeFile("/c/sessions/2026/10/01/notes.txt", "x", 1);
      fs.writeFile("/c/sessions/2026/10/01/rollout-a.jsonl.zst", "z", 1);
      expect(await codexAgent.isInstalled(deps(fs), "/")).toBe(false);
    });
    it("is true when a rollout exists anywhere under sessions", async () => {
      const fs = new InMemoryFs();
      fs.writeFile("/c/sessions/2026/10/01/rollout-x.jsonl", "", 1);
      expect(await codexAgent.isInstalled(deps(fs), "/")).toBe(true);
    });
    it("ignores archived_sessions (installed means a live sessions folder)", async () => {
      const fs = new InMemoryFs();
      fs.writeFile("/c/archived_sessions/rollout-x.jsonl", "", 1);
      expect(await codexAgent.isInstalled(deps(fs), "/")).toBe(false);
    });
  });

  describe("--here (matchesCwd)", () => {
    const m = (sessionCwd: string | undefined, cwd: string) => codexAgent.matchesCwd(sessionAt(sessionCwd), cwd);

    it("matches the same folder", () => {
      expect(m("C:\\Projects\\Sipcode", "C:\\Projects\\Sipcode")).toBe(true);
      expect(m("/home/u/app", "/home/u/app")).toBe(true);
    });
    it("matches a folder inside it", () => {
      expect(m("C:\\Projects\\Sipcode\\src", "C:\\Projects\\Sipcode")).toBe(true);
      expect(m("/home/u/app/src", "/home/u/app")).toBe(true);
    });
    it("does not match a sibling that shares a name prefix", () => {
      expect(m("C:\\Projects\\Sipcode2", "C:\\Projects\\Sipcode")).toBe(false);
      expect(m("C:\\Projects\\my-app", "C:\\Projects\\app")).toBe(false);
      expect(m("/home/u/app2", "/home/u/app")).toBe(false);
    });
    it("does not match a parent or an unrelated folder", () => {
      expect(m("C:\\Projects", "C:\\Projects\\Sipcode")).toBe(false);
      expect(m("C:\\Projects\\Other", "C:\\Projects\\Sipcode")).toBe(false);
    });
    it("ignores trailing separators", () => {
      expect(m("C:\\Projects\\Sipcode\\", "C:\\Projects\\Sipcode")).toBe(true);
      expect(m("C:\\Projects\\Sipcode", "C:\\Projects\\Sipcode\\")).toBe(true);
      expect(m("/home/u/app/", "/home/u/app")).toBe(true);
    });
    it("treats forward and back slashes alike on Windows paths", () => {
      expect(m("C:/Projects/Sipcode/src", "C:\\Projects\\Sipcode")).toBe(true);
      expect(m("C:\\Projects\\Sipcode", "C:/Projects/Sipcode/")).toBe(true);
    });
    it("is case-insensitive on Windows paths and case-sensitive on POSIX paths", () => {
      expect(m("c:\\projects\\SIPCODE\\src", "C:\\Projects\\Sipcode")).toBe(true);
      expect(m("/home/u/App", "/home/u/app")).toBe(false);
    });
    it("handles UNC paths", () => {
      expect(m("\\\\server\\share\\proj\\src", "\\\\server\\share\\proj")).toBe(true);
      expect(m("\\\\server\\share\\proj2", "\\\\server\\share\\proj")).toBe(false);
    });
    it("never matches across path flavours or without a recorded cwd", () => {
      expect(m("/home/u/app", "C:\\home\\u\\app")).toBe(false);
      expect(m(undefined, "C:\\Projects\\Sipcode")).toBe(false);
    });
    it("matches everything under a root folder", () => {
      expect(m("C:\\Projects\\Sipcode", "C:\\")).toBe(true);
      expect(m("/home/u", "/")).toBe(true);
    });
  });

  it("does not write or remove AGENTS.md blocks yet (arrives with Codex setup)", async () => {
    const w = await codexAgent.writeRulesBlock(deps(new InMemoryFs()), "/p", { name: "x", body: "y" }, async () => {});
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.error[0]?.code).toBe("E009");
    const r = await codexAgent.removeRulesBlock(deps(new InMemoryFs()), "/p", "x", async () => {});
    expect(r.ok).toBe(false);
  });

  it("reads AGENTS.md when present", async () => {
    const fs = new InMemoryFs();
    expect(await codexAgent.readRulesFile(deps(fs), "/p")).toBeNull();
    fs.writeFile("/p/AGENTS.md", "# rules", 1);
    const r = await codexAgent.readRulesFile(deps(fs), "/p");
    expect(r?.content).toBe("# rules");
  });

  it("parseTranscript yields a codex session", () => {
    const r = codexAgent.parseTranscript(rollout("a", "/p", record("r1", 100, 10)));
    expect(r.ok && r.value.agent).toBe("codex");
  });

  it("discoverSessions reports skipped compressed rollouts and unreadable folders", async () => {
    const mem = new InMemoryFs();
    mem.writeFile("/c/sessions/2026/10/01/rollout-a.jsonl", rollout("a", "/p", record("r1", 100, 10)), 2);
    mem.writeFile("/c/sessions/2026/10/01/rollout-z.jsonl.zst", "z", 1);
    mem.writeFile("/c/sessions/2026/10/02/rollout-b.jsonl", rollout("b", "/p", record("r2", 100, 10)), 3);
    const fs: FileSystem = {
      exists: (p) => mem.exists(p),
      readFile: (p) => mem.readFile(p),
      readHead: (p, n) => mem.readHead(p, n),
      stat: (p) => mem.stat(p),
      readDir: async (p) => {
        if (p.replace(/\\/g, "/").endsWith("/10/02")) throw new Error("EACCES");
        return mem.readDir(p);
      },
    };
    const r = await loadSessions({ agent: codexAgent, deps: deps(fs), cwd: "/" });
    if (!r.ok) throw new Error("load failed");
    expect(r.value.sessions.map((s) => s.meta.sessionId)).toEqual(["a"]);
    // A folder is not a file: counted apart. Compressed logs are one count, not one issue each.
    expect(r.value.unreadable).toBe(0);
    expect(r.value.unreadableFolders).toBe(1);
    expect(r.value.skippedCompressed).toBe(1);
    expect(r.value.issues).toEqual([]);
  });

  it("a missing archived_sessions folder is not reported", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/c/sessions/2026/10/01/rollout-a.jsonl", rollout("a", "/p", record("r1", 100, 10)), 1);
    const r = await loadSessions({ agent: codexAgent, deps: deps(fs), cwd: "/" });
    if (!r.ok) throw new Error("load failed");
    expect(r.value.unreadable).toBe(0);
    expect(r.value.unreadableFolders).toBe(0);
    expect(r.value.skippedCompressed).toBe(0);
    expect(r.value.issues).toEqual([]);
  });

  it("loads through loadSessions: --here, tokens, and empty sessions excluded like Claude's", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/c/sessions/2026/10/01/rollout-a.jsonl", rollout("a", "C:\\Projects\\Sipcode", record("r1", 100, 10)), 3);
    fs.writeFile("/c/sessions/2026/10/01/rollout-b.jsonl", rollout("b", "C:\\Projects\\Sipcode2", record("r2", 50, 5)), 2);
    fs.writeFile("/c/sessions/2026/10/01/rollout-e.jsonl", rollout("e", "C:\\Projects\\Sipcode"), 1);

    const all = await loadSessions({ agent: codexAgent, deps: deps(fs), cwd: "/" });
    if (!all.ok) throw new Error("load failed");
    expect(all.value.discovered).toBe(3);
    const pricing = loadPricingForDate(new Date("2026-10-08"));
    const nonEmpty = all.value.sessions.filter((s) => !isEmptySession(analyzeTokens(s.parsed, pricing)));
    expect(nonEmpty.map((s) => s.meta.sessionId)).toEqual(["a", "b"]);
    const totals = analyzeTokens(nonEmpty[0]!.parsed, pricing);
    expect(totals.inputTokens + totals.outputTokens).toBe(110);

    const here = await loadSessions({ agent: codexAgent, deps: deps(fs), cwd: "C:\\Projects\\Sipcode", here: true });
    if (!here.ok) throw new Error("load failed");
    expect(here.value.sessions.map((s) => s.meta.sessionId)).toEqual(["a", "e"]);
  });
});
