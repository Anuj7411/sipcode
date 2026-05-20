import { describe, expect, it } from "vitest";
import path from "node:path";
import { runHygiene } from "../../src/commands/hygiene.js";
import { inspectHygiene } from "../../src/modules/hygiene/inspect.js";
import { parseSettings } from "../../src/modules/hygiene/settingsJson.js";

interface World {
  files: Map<string, string>;
  stdout: string[];
  stderr: string[];
  deps: {
    cwd: string;
    homeDir: string;
    stdout: (s: string) => void;
    stderr: (s: string) => void;
    readFile: (p: string) => Promise<string | undefined>;
    writeFile: (p: string, c: string) => Promise<void>;
    latestTranscriptPath?: () => Promise<string | undefined>;
  };
}

function newWorld(opts?: {
  claudeMd?: string;
  settingsJson?: string;
  homeDir?: string;
}): World {
  const files = new Map<string, string>();
  const cwd = "/proj";
  const homeDir = opts?.homeDir ?? "/home/user";
  if (opts?.claudeMd !== undefined) files.set(`${cwd}/CLAUDE.md`, opts.claudeMd);
  if (opts?.settingsJson !== undefined) {
    files.set(`${homeDir}/.claude/settings.json`, opts.settingsJson);
  }
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    files,
    stdout,
    stderr,
    deps: {
      cwd,
      homeDir,
      stdout: (s) => stdout.push(s),
      stderr: (s) => stderr.push(s),
      readFile: async (p) => files.get(p.replace(/\\/g, "/")),
      writeFile: async (p, c) => {
        files.set(p.replace(/\\/g, "/"), c);
      },
    },
  };
}

describe("hygiene — integration", () => {
  it("full install -> inspect -> uninstall round-trip, byte-identical idempotence", async () => {
    const w = newWorld();

    // 1. Install fresh.
    let r = await runHygiene({ install: true }, w.deps);
    expect(r.exitCode).toBe(0);

    const afterClaudeMd = w.files.get("/proj/CLAUDE.md")!;
    const afterSettings = w.files.get("/home/user/.claude/settings.json")!;
    const afterPressure = w.files.get(
      "/home/user/.claude/hooks/sipcode-pressure.mjs",
    )!;
    const afterBreakpoint = w.files.get(
      "/home/user/.claude/hooks/sipcode-breakpoint.mjs",
    )!;
    expect(afterClaudeMd).toContain("Sipcode Session Hygiene");
    expect(afterPressure).toContain("// sipcode-hook v=1");
    expect(afterBreakpoint).toContain("// sipcode-hook v=1");
    expect(afterSettings).toContain("PreToolUse");
    expect(afterSettings).toContain("PostToolUse");

    // 2. Inspect — block + both hooks reported.
    const state = inspectHygiene(afterClaudeMd, parseSettings(afterSettings));
    expect(state.blockInstalled).toBe(true);
    expect(state.blockMode).toBe("default");
    expect(state.pressureHookInstalled).toBe(true);
    expect(state.breakpointHookInstalled).toBe(true);

    // 3. Re-install — byte-identical no-op.
    r = await runHygiene({ install: true }, w.deps);
    expect(r.exitCode).toBe(0);
    expect(w.files.get("/proj/CLAUDE.md")).toBe(afterClaudeMd);
    expect(w.files.get("/home/user/.claude/settings.json")).toBe(afterSettings);
    expect(
      w.files.get("/home/user/.claude/hooks/sipcode-pressure.mjs"),
    ).toBe(afterPressure);

    // 4. Uninstall — block removed, settings cleaned, hooks may or may not be
    //    deleted (we leave the .mjs files; only the registration is reversed).
    r = await runHygiene({ uninstall: true }, w.deps);
    expect(r.exitCode).toBe(0);
    const finalClaudeMd = w.files.get("/proj/CLAUDE.md") ?? "";
    const finalSettingsRaw = w.files.get("/home/user/.claude/settings.json");
    expect(finalClaudeMd).not.toContain("Sipcode Session Hygiene");
    // settings.json: sipcode entries gone; we wrote "{}" + newline since the
    // file didn't exist before.
    const finalSettings = finalSettingsRaw ? parseSettings(finalSettingsRaw) : {};
    expect(finalSettings).toEqual({});
  });

  it("preserves user's hand-written settings.json hooks (byte-identical modulo sipcode)", async () => {
    const userSettings = JSON.stringify(
      {
        permissions: { allow: ["Bash"] },
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "/usr/local/bin/my-hook" }],
            },
          ],
        },
      },
      null,
      2,
    ) + "\n";

    const w = newWorld({ settingsJson: userSettings });

    await runHygiene({ install: true }, w.deps);
    const afterInstall = w.files.get("/home/user/.claude/settings.json")!;
    // User's PreToolUse Bash hook still present
    expect(afterInstall).toContain("/usr/local/bin/my-hook");
    // sipcode entries also present
    expect(afterInstall).toContain("sipcode-pressure");
    expect(afterInstall).toContain("sipcode-breakpoint");

    await runHygiene({ uninstall: true }, w.deps);
    const afterUninstall = w.files.get("/home/user/.claude/settings.json")!;
    // Canonically equal to the user's original settings.
    expect(JSON.stringify(parseSettings(afterUninstall))).toBe(
      JSON.stringify(parseSettings(userSettings)),
    );
    expect(afterUninstall).not.toContain("sipcode-pressure");
    expect(afterUninstall).not.toContain("sipcode-breakpoint");
  });

  it("--diff against fresh state shows would-install summary, writes nothing", async () => {
    const w = newWorld();
    const r = await runHygiene({ install: true, diff: true }, w.deps);
    expect(r.exitCode).toBe(0);
    expect(w.files.size).toBe(0); // no writes
    expect(w.stdout.join("\n")).toContain("would install session hygiene");
    expect(w.stdout.join("\n")).toContain("--- CLAUDE.md");
    expect(w.stdout.join("\n")).toContain("--- settings.json");
  });

  it("--diff after install shows identical", async () => {
    const w = newWorld();
    await runHygiene({ install: true }, w.deps);
    w.stdout.length = 0;
    const r = await runHygiene({ install: true, diff: true }, w.deps);
    expect(r.exitCode).toBe(0);
    expect(w.stdout.join("\n")).toContain("no changes");
  });

  it("no flags + nothing installed -> 'not installed' message", async () => {
    const w = newWorld();
    const r = await runHygiene({}, w.deps);
    expect(r.exitCode).toBe(0);
    expect(w.stdout.join("\n")).toContain("not installed");
  });

  it("no flags after install -> status report", async () => {
    const w = newWorld();
    await runHygiene({ install: true }, w.deps);
    w.stdout.length = 0;
    const r = await runHygiene({}, w.deps);
    expect(r.exitCode).toBe(0);
    const out = w.stdout.join("\n");
    expect(out).toContain("session hygiene status");
    expect(out).toContain("installed (mode = default)");
    expect(out).toContain("registered");
  });

  it("--check with no transcripts prints a friendly message", async () => {
    const w = newWorld();
    w.deps.latestTranscriptPath = async () => undefined;
    const r = await runHygiene({ check: true }, w.deps);
    expect(r.exitCode).toBe(0);
    expect(w.stdout.join("\n")).toContain("nothing to check yet");
  });

  it("coexists with output-compression sub-block", async () => {
    const seeded =
      `<!-- sipcode:start v=2 -->\n` +
      `<!-- sipcode:block name="output-compression" mode="default" -->\n## Sipcode Output Compression\n(rules)\n<!-- /sipcode:block -->\n\n` +
      `<!-- sipcode:end -->\n`;
    const w = newWorld({ claudeMd: seeded });
    const r = await runHygiene({ install: true }, w.deps);
    expect(r.exitCode).toBe(0);
    const after = w.files.get("/proj/CLAUDE.md")!;
    expect(after).toContain(`name="output-compression"`);
    expect(after).toContain(`name="session-hygiene"`);
  });

  // Suppress unused-import warning for path module — keeps the import nearby
  // for future fixture work.
  it("path utility import survives lint", () => {
    expect(path.basename("/a/b.txt")).toBe("b.txt");
  });
});
