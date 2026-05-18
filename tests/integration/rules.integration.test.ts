import { describe, expect, it } from "vitest";
import { runRules } from "../../src/commands/rules.js";
import { inspectRules } from "../../src/modules/rules/inspect.js";

interface World {
  files: Map<string, string>;
  stdout: string[];
  stderr: string[];
  deps: {
    cwd: string;
    stdout: (s: string) => void;
    stderr: (s: string) => void;
    readFile: (p: string) => Promise<string | undefined>;
    writeFile: (p: string, c: string) => Promise<void>;
  };
}

function newWorld(initial?: string): World {
  const files = new Map<string, string>();
  if (initial !== undefined) files.set("/proj/CLAUDE.md", initial);
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    files,
    stdout,
    stderr,
    deps: {
      cwd: "/proj",
      stdout: (s) => stdout.push(s),
      stderr: (s) => stderr.push(s),
      readFile: async (p) => files.get(p.replace(/\\/g, "/")),
      writeFile: async (p, c) => {
        files.set(p.replace(/\\/g, "/"), c);
      },
    },
  };
}

describe("rules — integration", () => {
  it("install -> mode strict -> uninstall, byte-identical idempotence at each step", async () => {
    const w = newWorld();

    // 1. install default.
    let r = await runRules({ install: true }, w.deps);
    expect(r.exitCode).toBe(0);
    const afterInstall = w.files.get("/proj/CLAUDE.md")!;
    expect(inspectRules(afterInstall)).toEqual({
      installed: true,
      mode: "default",
    });

    // Re-run install default — should be byte-identical no-op.
    r = await runRules({ install: true }, w.deps);
    expect(r.exitCode).toBe(0);
    expect(w.files.get("/proj/CLAUDE.md")).toBe(afterInstall);

    // 2. switch to strict.
    r = await runRules({ mode: "strict" }, w.deps);
    expect(r.exitCode).toBe(0);
    const afterStrict = w.files.get("/proj/CLAUDE.md")!;
    expect(inspectRules(afterStrict)).toEqual({
      installed: true,
      mode: "strict",
    });
    expect(afterStrict).not.toBe(afterInstall);

    // Re-run strict — byte-identical no-op.
    r = await runRules({ mode: "strict" }, w.deps);
    expect(w.files.get("/proj/CLAUDE.md")).toBe(afterStrict);

    // 3. uninstall.
    r = await runRules({ uninstall: true }, w.deps);
    expect(r.exitCode).toBe(0);
    const afterUninstall = w.files.get("/proj/CLAUDE.md") ?? "";
    expect(inspectRules(afterUninstall).installed).toBe(false);
  });

  it("preserves a coexisting manifest sub-block across mode switches", async () => {
    // Seed CLAUDE.md with both a manifest sub-block AND user notes above.
    const seeded =
      `# project notes\nuse tabs.\n\n` +
      `<!-- sipcode:start v=2 -->\n` +
      `<!-- sipcode:block name="manifest" -->\n## Sipcode\nmanifest @ .sipcode/manifest.md\n<!-- /sipcode:block -->\n\n` +
      `<!-- sipcode:end -->\n`;
    const w = newWorld(seeded);

    let r = await runRules({ install: true }, w.deps);
    expect(r.exitCode).toBe(0);
    const v1 = w.files.get("/proj/CLAUDE.md")!;
    expect(v1).toContain("# project notes");
    expect(v1).toContain("use tabs.");
    expect(v1).toContain(`name="manifest"`);
    expect(v1).toContain(`name="output-compression"`);

    r = await runRules({ mode: "verbose" }, w.deps);
    expect(r.exitCode).toBe(0);
    const v2 = w.files.get("/proj/CLAUDE.md")!;
    expect(v2).toContain(`name="manifest"`);
    expect(v2).toContain(`mode="verbose"`);

    r = await runRules({ uninstall: true }, w.deps);
    expect(r.exitCode).toBe(0);
    const v3 = w.files.get("/proj/CLAUDE.md")!;
    expect(v3).toContain(`name="manifest"`);
    expect(v3).not.toContain(`name="output-compression"`);
    expect(v3).toContain("# project notes");
  });

  it("migrates a v=1 wrapper to v=2 when installing rules", async () => {
    const v1Seed =
      `# header\n<!-- sipcode:start v=1 -->\n## Sipcode\nlegacy manifest body\n<!-- sipcode:end -->\n# footer\n`;
    const w = newWorld(v1Seed);
    const r = await runRules({ install: true }, w.deps);
    expect(r.exitCode).toBe(0);
    const after = w.files.get("/proj/CLAUDE.md")!;
    expect(after).toContain("<!-- sipcode:start v=2 -->");
    expect(after).not.toContain("<!-- sipcode:start v=1 -->");
    expect(after).toContain(`name="manifest"`);
    expect(after).toContain("legacy manifest body");
    expect(after).toContain(`name="output-compression"`);
    expect(after).toContain("# header");
    expect(after).toContain("# footer");
  });
});
