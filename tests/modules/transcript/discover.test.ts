import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../../src/lib/fs.js";
import { FakeProcessEnv } from "../../../src/lib/process.js";
import { FakeClock } from "../../../src/lib/clock.js";
import { claudeCodeAgent } from "../../../src/modules/agents/claude-code/adapter.js";
import { listAgentSessions, pickFrom } from "../../../src/modules/agents/latest.js";
import { listAllSessions, resolveProjectsDir } from "../../../src/modules/transcript/discover.js";

/** The --session lookup why / receipt / drift use. */
async function lookup(fs: InMemoryFs, prefix: string) {
  const deps = { fs, env: new FakeProcessEnv({ homeDir: "/home/u" }), clock: new FakeClock(new Date("2026-10-08")) };
  const lists = await listAgentSessions({ agents: [claudeCodeAgent], deps, cwd: "/" });
  return (await pickFrom(lists, deps, { sessionIdPrefix: prefix }))?.chosen.meta;
}

function makeFs(): InMemoryFs {
  const fs = new InMemoryFs();
  fs.writeFile("/home/u/.claude/projects/proj-a/abc12345.jsonl", "{}", 100);
  fs.writeFile("/home/u/.claude/projects/proj-a/def67890.jsonl", "{}", 200);
  fs.writeFile("/home/u/.claude/projects/proj-b/9876xyz0.jsonl", "{}", 300);
  return fs;
}

describe("discover", () => {
  it("resolveProjectsDir uses SIPCODE_PROJECTS_DIR if set", () => {
    const env = new FakeProcessEnv({
      vars: { SIPCODE_PROJECTS_DIR: "/custom/path" },
      homeDir: "/home/u",
    });
    expect(resolveProjectsDir(env)).toBe("/custom/path");
  });

  it("resolveProjectsDir defaults to ~/.claude/projects", () => {
    const env = new FakeProcessEnv({ homeDir: "/home/u" });
    expect(resolveProjectsDir(env)).toMatch(/\.claude.*projects/);
  });

  it("listAllSessions returns sessions sorted by recency", async () => {
    const fs = makeFs();
    const sessions = await listAllSessions(fs, "/home/u/.claude/projects");
    expect(sessions.map((s) => s.sessionId)).toEqual([
      "9876xyz0",
      "def67890",
      "abc12345",
    ]);
  });

  it("--session finds a session by id prefix", async () => {
    expect((await lookup(makeFs(), "abc"))?.sessionId).toBe("abc12345");
  });

  it("returns [] when projectsDir is missing", async () => {
    const fs = new InMemoryFs();
    expect(await listAllSessions(fs, "/nope")).toEqual([]);
  });

  it("skips non-.jsonl files inside project dirs", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/p/a/x.jsonl", "{}", 100);
    fs.writeFile("/p/a/readme.txt", "noise", 100);
    const sessions = await listAllSessions(fs, "/p");
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.sessionId).toBe("x");
  });

  it("--session finds nothing for an unknown prefix", async () => {
    expect(await lookup(makeFs(), "zzzzz")).toBeUndefined();
  });
});
