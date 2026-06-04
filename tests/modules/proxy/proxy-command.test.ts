import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProxy, type ProxyDeps } from "../../../src/commands/proxy.js";
import { writeStats } from "../../../src/modules/proxy/stats-store.js";

/** In-memory FS-backed deps for install/uninstall/diff flows. */
function memDeps(homeDir = "/home/u") {
  const files = new Map<string, string>();
  const out: string[] = [];
  const deps: ProxyDeps = {
    homeDir,
    stdout: (s) => out.push(s),
    readFile: async (p) => files.get(p),
    writeFile: async (p, c) => void files.set(p, c),
    removeFile: async (p) => void files.delete(p),
  };
  return { deps, files, out };
}

describe("runProxy", () => {
  it("--install writes the hook script and registers the PreToolUse hook", async () => {
    const { deps, files, out } = memDeps();
    const r = await runProxy({ install: true }, deps);
    expect(r.exitCode).toBe(0);
    const scriptPath = [...files.keys()].find((k) => k.endsWith("sipcode-proxy.mjs"));
    const settingsPath = [...files.keys()].find((k) => k.endsWith("settings.json"));
    expect(scriptPath).toBeDefined();
    expect(settingsPath).toBeDefined();
    expect(files.get(scriptPath!)).toContain("SIPCODE_PROXY_HOOK_SIGNATURE");
    expect(files.get(settingsPath!)).toContain("PreToolUse");
    expect(files.get(settingsPath!)).toContain("sipcode-proxy");
    expect(out.join("\n")).toContain("installed");
  });

  it("--install is idempotent (second run reports no changes)", async () => {
    const { deps, out } = memDeps();
    await runProxy({ install: true }, deps);
    out.length = 0;
    await runProxy({ install: true }, deps);
    expect(out.join("\n")).toContain("already installed");
  });

  it("--uninstall removes the hook entry and deletes the script", async () => {
    const { deps, files, out } = memDeps();
    await runProxy({ install: true }, deps);
    out.length = 0;
    await runProxy({ uninstall: true }, deps);
    expect([...files.keys()].some((k) => k.endsWith("sipcode-proxy.mjs"))).toBe(false);
    const settingsPath = [...files.keys()].find((k) => k.endsWith("settings.json"))!;
    expect(files.get(settingsPath)).not.toContain("sipcode-proxy");
    expect(out.join("\n")).toContain("uninstalled");
  });

  it("--diff shows planned changes without writing", async () => {
    const { deps, files, out } = memDeps();
    const r = await runProxy({ diff: true }, deps);
    expect(r.exitCode).toBe(0);
    expect(files.size).toBe(0);
    expect(out.join("\n")).toContain("would install");
  });

  it("no flags reports not-installed on a clean home", async () => {
    const { deps, out } = memDeps();
    await runProxy({}, deps);
    expect(out.join("\n")).toContain("not installed");
  });

  describe("--stats", () => {
    let home: string;
    beforeEach(async () => {
      home = await mkdtemp(join(tmpdir(), "sipcode-proxy-home-"));
    });
    afterEach(async () => {
      await rm(home, { recursive: true, force: true });
    });

    it("renders accumulated stats from the per-PID files", async () => {
      const dir = join(home, ".sipcode", "proxy-stats");
      await writeStats(dir, {
        timestamp: "t",
        toolName: "Bash",
        rewriterName: "git-status",
        savedTokensEstimate: 800,
      });
      const out: string[] = [];
      await runProxy({ stats: true }, { homeDir: home, stdout: (s) => out.push(s) });
      const text = out.join("\n");
      expect(text).toContain("rewrite stats");
      expect(text).toContain("git-status");
      expect(text).toContain("800");
    });

    it("--stats --json emits machine-readable report", async () => {
      const out: string[] = [];
      await runProxy(
        { stats: true, json: true },
        { homeDir: home, stdout: (s) => out.push(s) },
      );
      const report = JSON.parse(out.join("\n"));
      expect(report.schemaVersion).toBe("sipcode-proxy/2");
      expect(report.totalInvocations).toBe(0);
    });
  });
});
