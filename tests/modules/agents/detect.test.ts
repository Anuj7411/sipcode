import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../../src/lib/fs.js";
import { FakeProcessEnv } from "../../../src/lib/process.js";
import { detectAgent } from "../../../src/modules/agents/detect.js";

function envWithHome(home = "/home/test"): FakeProcessEnv {
  return new FakeProcessEnv({ homeDir: home });
}

describe("detectAgent", () => {
  it("explicit --agent <id> short-circuits detection", async () => {
    const fs = new InMemoryFs();
    const r = await detectAgent({
      selector: "cursor",
      fs,
      env: envWithHome(),
      cwd: "/proj",
    });
    expect(r.agent).toBe("cursor");
    expect(r.reason).toBe("explicit");
    expect(r.explicit).toBe(true);
    expect(r.ambiguous).toBe(false);
  });

  it("CLAUDE.md alone in cwd → claude-code", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/proj/CLAUDE.md", "# hi");
    const r = await detectAgent({
      selector: "auto",
      fs,
      env: envWithHome(),
      cwd: "/proj",
    });
    expect(r.agent).toBe("claude-code");
    expect(r.reason).toBe("cwd-claude-md");
    expect(r.ambiguous).toBe(false);
  });

  it(".cursor/ alone in cwd → cursor", async () => {
    const fs = new InMemoryFs();
    fs.mkdir("/proj/.cursor");
    const r = await detectAgent({
      selector: "auto",
      fs,
      env: envWithHome(),
      cwd: "/proj",
    });
    expect(r.agent).toBe("cursor");
    expect(r.reason).toBe("cwd-cursor");
  });

  it(".cursorrules alone → cursor", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/proj/.cursorrules", "be terse");
    const r = await detectAgent({
      selector: "auto",
      fs,
      env: envWithHome(),
      cwd: "/proj",
    });
    expect(r.agent).toBe("cursor");
    expect(r.reason).toBe("cwd-cursor");
  });

  it("both CLAUDE.md and .cursor/ in cwd → ambiguous, defaults claude-code", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/proj/CLAUDE.md", "# hi");
    fs.mkdir("/proj/.cursor");
    const r = await detectAgent({
      selector: "auto",
      fs,
      env: envWithHome(),
      cwd: "/proj",
    });
    expect(r.agent).toBe("claude-code");
    expect(r.ambiguous).toBe(true);
  });

  it("nothing in cwd, ~/.claude/projects exists → claude-code (global)", async () => {
    const fs = new InMemoryFs();
    fs.mkdir("/home/test/.claude/projects");
    const r = await detectAgent({
      selector: "auto",
      fs,
      env: envWithHome(),
      cwd: "/proj",
    });
    expect(r.agent).toBe("claude-code");
    expect(r.reason).toBe("global-claude-code");
  });

  it("nothing in cwd, ~/.cursor/ exists → cursor (global)", async () => {
    const fs = new InMemoryFs();
    fs.mkdir("/home/test/.cursor");
    const r = await detectAgent({
      selector: "auto",
      fs,
      env: envWithHome(),
      cwd: "/proj",
    });
    expect(r.agent).toBe("cursor");
    expect(r.reason).toBe("global-cursor");
  });

  it("both global → ambiguous, defaults claude-code", async () => {
    const fs = new InMemoryFs();
    fs.mkdir("/home/test/.claude/projects");
    fs.mkdir("/home/test/.cursor");
    const r = await detectAgent({
      selector: "auto",
      fs,
      env: envWithHome(),
      cwd: "/proj",
    });
    expect(r.agent).toBe("claude-code");
    expect(r.ambiguous).toBe(true);
  });

  it("nothing anywhere → default-fallback to claude-code", async () => {
    const fs = new InMemoryFs();
    const r = await detectAgent({
      selector: "auto",
      fs,
      env: envWithHome(),
      cwd: "/proj",
    });
    expect(r.agent).toBe("claude-code");
    expect(r.reason).toBe("default-fallback");
  });

  it("SIPCODE_PROJECTS_DIR override still drives global-claude-code detection", async () => {
    const fs = new InMemoryFs();
    fs.mkdir("/elsewhere/.cc");
    const env = new FakeProcessEnv({
      vars: { SIPCODE_PROJECTS_DIR: "/elsewhere/.cc" },
      homeDir: "/home/test",
    });
    const r = await detectAgent({ selector: "auto", fs, env, cwd: "/proj" });
    expect(r.agent).toBe("claude-code");
    expect(r.reason).toBe("global-claude-code");
  });
});
