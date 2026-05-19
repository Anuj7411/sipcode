import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../../../src/lib/fs.js";
import { FakeClock } from "../../../../src/lib/clock.js";
import { FakeProcessEnv } from "../../../../src/lib/process.js";
import { claudeCodeAgent } from "../../../../src/modules/agents/claude-code/adapter.js";

function deps(fs = new InMemoryFs()) {
  return {
    fs,
    env: new FakeProcessEnv({ homeDir: "/home/test" }),
    clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
  };
}

describe("claudeCodeAgent", () => {
  it("identifies as claude-code", () => {
    expect(claudeCodeAgent.id).toBe("claude-code");
    expect(claudeCodeAgent.transcriptParsingSupported).toBe(true);
  });

  it("rules path candidate is <cwd>/CLAUDE.md", () => {
    const paths = claudeCodeAgent.rulesPathCandidates("/proj");
    expect(paths.length).toBe(1);
    expect(paths[0]!.replace(/\\/g, "/")).toBe("/proj/CLAUDE.md");
  });

  it("readRulesFile returns null when CLAUDE.md is absent", async () => {
    const fs = new InMemoryFs();
    const r = await claudeCodeAgent.readRulesFile(deps(fs), "/proj");
    expect(r).toBeNull();
  });

  it("readRulesFile returns content + path when CLAUDE.md exists", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/proj/CLAUDE.md", "hello");
    const r = await claudeCodeAgent.readRulesFile(deps(fs), "/proj");
    expect(r?.content).toBe("hello");
    expect(r?.path.replace(/\\/g, "/")).toBe("/proj/CLAUDE.md");
  });

  it("writeRulesBlock writes a markered block and is idempotent", async () => {
    const fs = new InMemoryFs();
    const writes = new Map<string, string>();
    const w = async (p: string, c: string) => {
      writes.set(p.replace(/\\/g, "/"), c);
    };
    const r1 = await claudeCodeAgent.writeRulesBlock(
      deps(fs),
      "/proj",
      { name: "manifest", body: "\n## Sipcode\nhello\n" },
      w,
    );
    expect(r1.ok).toBe(true);
    const first = writes.get("/proj/CLAUDE.md")!;
    expect(first).toContain("<!-- sipcode:start v=2 -->");
    expect(first).toContain('name="manifest"');

    // Re-run with same input + previous content → identical bytes.
    const r2 = await claudeCodeAgent.writeRulesBlock(
      deps(fs),
      "/proj",
      { name: "manifest", body: "\n## Sipcode\nhello\n" },
      w,
      first,
    );
    expect(r2.ok).toBe(true);
    expect(writes.get("/proj/CLAUDE.md")).toBe(first);
  });

  it("removeRulesBlock returns null when file does not exist", async () => {
    const fs = new InMemoryFs();
    const r = await claudeCodeAgent.removeRulesBlock(
      deps(fs),
      "/proj",
      "manifest",
      async () => {},
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  it("isInstalled is true when CLAUDE.md exists in cwd", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/proj/CLAUDE.md", "x");
    expect(await claudeCodeAgent.isInstalled(deps(fs), "/proj")).toBe(true);
  });

  it("isInstalled is true when ~/.claude/projects exists", async () => {
    const fs = new InMemoryFs();
    fs.mkdir("/home/test/.claude/projects");
    expect(await claudeCodeAgent.isInstalled(deps(fs), "/elsewhere")).toBe(true);
  });

  it("isInstalled is false when nothing exists", async () => {
    const fs = new InMemoryFs();
    expect(await claudeCodeAgent.isInstalled(deps(fs), "/proj")).toBe(false);
  });

  it("discoverSessions returns ok with empty array when projectsDir is missing", async () => {
    const fs = new InMemoryFs();
    const r = await claudeCodeAgent.discoverSessions(deps(fs));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([]);
  });

  it("parseTranscript returns ok for empty content", () => {
    const r = claudeCodeAgent.parseTranscript("");
    expect(r.ok).toBe(true);
  });
});
