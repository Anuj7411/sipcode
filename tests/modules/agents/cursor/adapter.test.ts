import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../../../src/lib/fs.js";
import { FakeClock } from "../../../../src/lib/clock.js";
import { FakeProcessEnv } from "../../../../src/lib/process.js";
import { cursorAgent } from "../../../../src/modules/agents/cursor/adapter.js";

function deps(fs = new InMemoryFs()) {
  return {
    fs,
    env: new FakeProcessEnv({ homeDir: "/home/test" }),
    clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
  };
}

describe("cursorAgent", () => {
  it("identifies as cursor with transcript parsing OFF", () => {
    expect(cursorAgent.id).toBe("cursor");
    expect(cursorAgent.transcriptParsingSupported).toBe(false);
  });

  it("rules path candidates list .mdc first, then .cursorrules", () => {
    const paths = cursorAgent
      .rulesPathCandidates("/proj")
      .map((p) => p.replace(/\\/g, "/"));
    expect(paths[0]).toBe("/proj/.cursor/rules/sipcode.mdc");
    expect(paths[1]).toBe("/proj/.cursorrules");
  });

  it("parseTranscript returns E009 (not yet supported)", () => {
    const r = cursorAgent.parseTranscript("anything");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]!.code).toBe("E009");
  });

  it("discoverSessions returns E009", async () => {
    const r = await cursorAgent.discoverSessions(deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]!.code).toBe("E009");
  });

  it("writeRulesBlock creates .cursor/rules/sipcode.mdc by default", async () => {
    const fs = new InMemoryFs();
    const writes = new Map<string, string>();
    const r = await cursorAgent.writeRulesBlock(
      deps(fs),
      "/proj",
      { name: "manifest", body: "\n## Sipcode\nhello\n" },
      async (p, c) => {
        writes.set(p.replace(/\\/g, "/"), c);
      },
    );
    expect(r.ok).toBe(true);
    const key = [...writes.keys()][0]!;
    expect(key).toBe("/proj/.cursor/rules/sipcode.mdc");
    const content = writes.get(key)!;
    expect(content).toContain("---\ndescription:");
    expect(content).toContain('name="manifest"');
  });

  it("writeRulesBlock targets .cursorrules when only legacy file exists", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/proj/.cursorrules", "");
    const writes = new Map<string, string>();
    const r = await cursorAgent.writeRulesBlock(
      deps(fs),
      "/proj",
      { name: "manifest", body: "\n## Sipcode\nhello\n" },
      async (p, c) => {
        writes.set(p.replace(/\\/g, "/"), c);
      },
    );
    expect(r.ok).toBe(true);
    const key = [...writes.keys()][0]!;
    expect(key).toBe("/proj/.cursorrules");
    const content = writes.get(key)!;
    expect(content).not.toMatch(/^---\n/);
    expect(content).toContain('name="manifest"');
  });

  it("writeRulesBlock is idempotent on cwd with existing .mdc", async () => {
    const fs = new InMemoryFs();
    const writes = new Map<string, string>();
    const writer = async (p: string, c: string) => {
      // Mirror the write into the in-memory fs so a second call reads the new content.
      fs.writeFile(p, c);
      writes.set(p.replace(/\\/g, "/"), c);
    };

    const block = { name: "manifest", body: "\n## Sipcode\nhello\n" };
    const r1 = await cursorAgent.writeRulesBlock(deps(fs), "/proj", block, writer);
    expect(r1.ok).toBe(true);
    const first = writes.get("/proj/.cursor/rules/sipcode.mdc")!;
    const r2 = await cursorAgent.writeRulesBlock(deps(fs), "/proj", block, writer);
    expect(r2.ok).toBe(true);
    expect(writes.get("/proj/.cursor/rules/sipcode.mdc")).toBe(first);
  });

  it("readRulesFile returns null when neither file exists", async () => {
    const fs = new InMemoryFs();
    const r = await cursorAgent.readRulesFile(deps(fs), "/proj");
    expect(r).toBeNull();
  });

  it("readRulesFile finds existing .mdc content", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/proj/.cursor/rules/sipcode.mdc", "hello");
    const r = await cursorAgent.readRulesFile(deps(fs), "/proj");
    expect(r?.content).toBe("hello");
    expect(r?.path.replace(/\\/g, "/")).toBe("/proj/.cursor/rules/sipcode.mdc");
  });

  it("removeRulesBlock no-ops when no rules file exists", async () => {
    const fs = new InMemoryFs();
    const r = await cursorAgent.removeRulesBlock(
      deps(fs),
      "/proj",
      "manifest",
      async () => {},
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  it("isInstalled true when .cursor/ exists in cwd", async () => {
    const fs = new InMemoryFs();
    fs.mkdir("/proj/.cursor");
    expect(await cursorAgent.isInstalled(deps(fs), "/proj")).toBe(true);
  });

  it("isInstalled false when nothing exists", async () => {
    const fs = new InMemoryFs();
    expect(await cursorAgent.isInstalled(deps(fs), "/proj")).toBe(false);
  });
});
