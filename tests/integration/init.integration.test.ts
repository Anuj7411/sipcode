import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import { FakeGit } from "../../src/lib/git.js";
import { runInit } from "../../src/commands/init.js";
import { MARKER_END, MARKER_START } from "../../src/lib/claudeMd.js";

function tinyRepo(root: string): InMemoryFs {
  const fs = new InMemoryFs();
  fs.writeFile(
    `${root}/package.json`,
    JSON.stringify({ name: "demo", bin: { demo: "./cli.js" } }),
  );
  fs.writeFile(`${root}/src/a.ts`, "/** alpha. */\nexport const a = 1;");
  fs.writeFile(`${root}/src/b.ts`, "/** beta. */\nimport { a } from './a';\nexport const b = a + 1;");
  return fs;
}

describe("runInit — integration", () => {
  it("end-to-end: writes manifest + injects CLAUDE.md (with --yes)", async () => {
    const root = "/proj";
    const fs = tinyRepo(root);
    const writes = new Map<string, string>();
    const r = await runInit(
      { yes: true },
      {
        fs,
        clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
        env: new FakeProcessEnv(),
        git: new FakeGit({ available: true, headShort: "abc1234" }),
        cwd: root,
        stdout: () => {},
        stderr: () => {},
        writeFile: async (p, c) => {
          writes.set(p.replace(/\\/g, "/"), c);
        },
        readFile: async () => undefined, // no existing CLAUDE.md
      },
    );
    expect(r.exitCode).toBe(0);
    const manifestKey = [...writes.keys()].find((k) =>
      k.endsWith(".sipcode/manifest.md"),
    );
    const claudeKey = [...writes.keys()].find((k) => k.endsWith("CLAUDE.md"));
    expect(manifestKey).toBeDefined();
    expect(claudeKey).toBeDefined();
    const claudeContent = writes.get(claudeKey!)!;
    expect(claudeContent).toContain(MARKER_START);
    expect(claudeContent).toContain(MARKER_END);
    expect(claudeContent).toContain("## Sipcode");
  });

  it("preserves existing CLAUDE.md content outside markers", async () => {
    const root = "/proj";
    const fs = tinyRepo(root);
    const writes = new Map<string, string>();
    const r = await runInit(
      { yes: true },
      {
        fs,
        clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
        env: new FakeProcessEnv(),
        git: new FakeGit({ available: true, headShort: "abc1234" }),
        cwd: root,
        stdout: () => {},
        stderr: () => {},
        writeFile: async (p, c) => {
          writes.set(p.replace(/\\/g, "/"), c);
        },
        readFile: async (p) =>
          p.endsWith("CLAUDE.md") ? "# my project notes\n\nuse tabs not spaces.\n" : undefined,
      },
    );
    expect(r.exitCode).toBe(0);
    const claudeKey = [...writes.keys()].find((k) => k.endsWith("CLAUDE.md"));
    const claudeContent = writes.get(claudeKey!)!;
    expect(claudeContent).toContain("# my project notes");
    expect(claudeContent).toContain("use tabs not spaces.");
    expect(claudeContent).toContain(MARKER_START);
  });

  it("refuses to overwrite hand-edited markers (E005)", async () => {
    const root = "/proj";
    const fs = tinyRepo(root);
    const stderr: string[] = [];
    const r = await runInit(
      { yes: true },
      {
        fs,
        clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
        env: new FakeProcessEnv(),
        git: new FakeGit({ available: true }),
        cwd: root,
        stdout: () => {},
        stderr: (s) => stderr.push(s),
        writeFile: async () => {},
        readFile: async (p) =>
          p.endsWith("CLAUDE.md")
            ? `${MARKER_START}\nUSER WROTE THEIR OWN PROSE HERE\n${MARKER_END}`
            : undefined,
      },
    );
    expect(r.exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("[E005]");
  });

  it("--no-claude-md skips CLAUDE.md injection", async () => {
    const root = "/proj";
    const fs = tinyRepo(root);
    const writes = new Map<string, string>();
    const r = await runInit(
      { yes: true, noClaudeMd: true },
      {
        fs,
        clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
        env: new FakeProcessEnv(),
        git: new FakeGit({ available: true }),
        cwd: root,
        stdout: () => {},
        stderr: () => {},
        writeFile: async (p, c) => {
          writes.set(p.replace(/\\/g, "/"), c);
        },
        readFile: async () => undefined,
      },
    );
    expect(r.exitCode).toBe(0);
    expect([...writes.keys()].find((k) => k.endsWith("CLAUDE.md"))).toBeUndefined();
    expect([...writes.keys()].find((k) => k.endsWith(".sipcode/manifest.md"))).toBeDefined();
  });

  it("uses a scripted prompter when not --yes", async () => {
    const root = "/proj";
    const fs = tinyRepo(root);
    const writes = new Map<string, string>();
    const r = await runInit(
      {},
      {
        fs,
        clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
        env: new FakeProcessEnv(),
        git: new FakeGit({ available: true }),
        cwd: root,
        stdout: () => {},
        stderr: () => {},
        writeFile: async (p, c) => {
          writes.set(p.replace(/\\/g, "/"), c);
        },
        readFile: async () => undefined,
        prompt: async () => ({
          root,
          injectClaudeMd: false,
          budgetMode: "strict",
          rulesMode: "default",
        }),
      },
    );
    expect(r.exitCode).toBe(0);
    expect([...writes.keys()].find((k) => k.endsWith("CLAUDE.md"))).toBeUndefined();
  });

  it("--yes installs output-compression rules at default mode", async () => {
    const root = "/proj";
    const fs = tinyRepo(root);
    const writes = new Map<string, string>();
    const r = await runInit(
      { yes: true },
      {
        fs,
        clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
        env: new FakeProcessEnv(),
        git: new FakeGit({ available: true }),
        cwd: root,
        stdout: () => {},
        stderr: () => {},
        writeFile: async (p, c) => {
          writes.set(p.replace(/\\/g, "/"), c);
        },
        readFile: async () => undefined,
      },
    );
    expect(r.exitCode).toBe(0);
    expect(r.rulesMode).toBe("default");
    const claudeKey = [...writes.keys()].find((k) => k.endsWith("CLAUDE.md"));
    const claudeContent = writes.get(claudeKey!)!;
    expect(claudeContent).toContain(`name="output-compression"`);
    expect(claudeContent).toContain(`mode="default"`);
    expect(claudeContent).toContain(`name="manifest"`);
  });

  it("--rules-mode=strict installs strict rules", async () => {
    const root = "/proj";
    const fs = tinyRepo(root);
    const writes = new Map<string, string>();
    const r = await runInit(
      { yes: true, rulesMode: "strict" },
      {
        fs,
        clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
        env: new FakeProcessEnv(),
        git: new FakeGit({ available: true }),
        cwd: root,
        stdout: () => {},
        stderr: () => {},
        writeFile: async (p, c) => {
          writes.set(p.replace(/\\/g, "/"), c);
        },
        readFile: async () => undefined,
      },
    );
    expect(r.exitCode).toBe(0);
    const claudeKey = [...writes.keys()].find((k) => k.endsWith("CLAUDE.md"));
    const claudeContent = writes.get(claudeKey!)!;
    expect(claudeContent).toContain(`mode="strict"`);
  });

  it("--rules-mode=skip skips rules installation but keeps the manifest", async () => {
    const root = "/proj";
    const fs = tinyRepo(root);
    const writes = new Map<string, string>();
    const r = await runInit(
      { yes: true, rulesMode: "skip" },
      {
        fs,
        clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
        env: new FakeProcessEnv(),
        git: new FakeGit({ available: true }),
        cwd: root,
        stdout: () => {},
        stderr: () => {},
        writeFile: async (p, c) => {
          writes.set(p.replace(/\\/g, "/"), c);
        },
        readFile: async () => undefined,
      },
    );
    expect(r.exitCode).toBe(0);
    expect(r.rulesMode).toBe("skip");
    const claudeKey = [...writes.keys()].find((k) => k.endsWith("CLAUDE.md"));
    const claudeContent = writes.get(claudeKey!)!;
    expect(claudeContent).toContain(`name="manifest"`);
    expect(claudeContent).not.toContain(`name="output-compression"`);
  });
});
