import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../../../src/lib/fs.js";
import { FakeProcessEnv } from "../../../../src/lib/process.js";
import {
  cursorLooksInstalled,
  detectCursor,
} from "../../../../src/modules/agents/cursor/detect.js";

describe("detectCursor", () => {
  it("returns all false when nothing is configured", async () => {
    const fs = new InMemoryFs();
    const env = new FakeProcessEnv({ homeDir: "/home/test" });
    const p = await detectCursor(fs, env, "/proj");
    expect(p).toEqual({
      cwdConfigDir: false,
      cwdLegacyRules: false,
      globalConfigDir: false,
    });
    expect(cursorLooksInstalled(p)).toBe(false);
  });

  it("detects .cursor/ in cwd", async () => {
    const fs = new InMemoryFs();
    fs.mkdir("/proj/.cursor");
    const env = new FakeProcessEnv({ homeDir: "/home/test" });
    const p = await detectCursor(fs, env, "/proj");
    expect(p.cwdConfigDir).toBe(true);
    expect(cursorLooksInstalled(p)).toBe(true);
  });

  it("detects .cursorrules in cwd", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/proj/.cursorrules", "be terse");
    const env = new FakeProcessEnv({ homeDir: "/home/test" });
    const p = await detectCursor(fs, env, "/proj");
    expect(p.cwdLegacyRules).toBe(true);
    expect(cursorLooksInstalled(p)).toBe(true);
  });

  it("detects ~/.cursor/ as global install", async () => {
    const fs = new InMemoryFs();
    fs.mkdir("/home/test/.cursor");
    const env = new FakeProcessEnv({ homeDir: "/home/test" });
    const p = await detectCursor(fs, env, "/proj");
    expect(p.globalConfigDir).toBe(true);
    expect(cursorLooksInstalled(p)).toBe(true);
  });
});
