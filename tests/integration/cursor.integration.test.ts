/**
 * Integration test: end-to-end cursor adapter via `sipcode init` + `why`.
 *
 * Covers S043 acceptance criteria:
 *   - init --agent cursor writes .cursor/rules/sipcode.mdc + .sipcode/manifest.md
 *   - the mdc file carries canonical frontmatter and the sipcode marker block
 *   - rerunning init is idempotent on the .mdc file
 *   - why --agent cursor exits 1 with E009 brand-voice message (no crash)
 */
import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import { FakeGit } from "../../src/lib/git.js";
import { runInit } from "../../src/commands/init.js";
import { runWhy } from "../../src/commands/why.js";

function tinyRepo(root: string): InMemoryFs {
  const fs = new InMemoryFs();
  fs.writeFile(
    `${root}/package.json`,
    JSON.stringify({ name: "demo" }),
  );
  fs.writeFile(`${root}/src/a.ts`, "export const a = 1;");
  fs.writeFile(`${root}/src/b.ts`, "import { a } from './a';\nexport const b = a + 1;");
  return fs;
}

describe("cursor integration", () => {
  it("init --agent cursor writes .cursor/rules/sipcode.mdc", async () => {
    const root = "/proj";
    const fs = tinyRepo(root);
    const writes = new Map<string, string>();
    const r = await runInit(
      { yes: true, agent: "cursor" },
      {
        fs,
        clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
        env: new FakeProcessEnv({ homeDir: "/home/test" }),
        git: new FakeGit({ available: true, headShort: "abc1234" }),
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

    const mdcKey = [...writes.keys()].find((k) =>
      k.endsWith(".cursor/rules/sipcode.mdc"),
    );
    expect(mdcKey).toBeDefined();

    const manifestKey = [...writes.keys()].find((k) =>
      k.endsWith(".sipcode/manifest.md"),
    );
    expect(manifestKey).toBeDefined();

    const content = writes.get(mdcKey!)!;
    // Canonical cursor frontmatter
    expect(content).toMatch(/^---\ndescription:/);
    expect(content).toContain("alwaysApply: true");
    // Sipcode markers + named sub-blocks
    expect(content).toContain("<!-- sipcode:start v=2 -->");
    expect(content).toContain('name="manifest"');
    expect(content).toContain('name="output-compression"');
    expect(content).toContain('mode="default"');

    // We never write CLAUDE.md when --agent cursor.
    expect([...writes.keys()].find((k) => k.endsWith("/CLAUDE.md"))).toBeUndefined();
  });

  it("rerunning init --agent cursor is idempotent on the .mdc file", async () => {
    const root = "/proj";
    const fs = tinyRepo(root);
    const writes = new Map<string, string>();

    // First run: capture and mirror writes back into fs so the second run sees them.
    const writeFile = async (p: string, c: string) => {
      writes.set(p.replace(/\\/g, "/"), c);
      fs.writeFile(p, c);
    };
    const sharedDeps = {
      fs,
      clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
      env: new FakeProcessEnv({ homeDir: "/home/test" }),
      git: new FakeGit({ available: true, headShort: "abc1234" }),
      cwd: root,
      stdout: () => {},
      stderr: () => {},
      writeFile,
      readFile: async (p: string) => {
        try {
          return await fs.readFile(p);
        } catch {
          return undefined;
        }
      },
    };

    const r1 = await runInit({ yes: true, agent: "cursor" }, sharedDeps);
    expect(r1.exitCode).toBe(0);
    const firstMdc = writes.get("/proj/.cursor/rules/sipcode.mdc")!;
    expect(firstMdc).toBeDefined();

    const r2 = await runInit({ yes: true, agent: "cursor" }, sharedDeps);
    expect(r2.exitCode).toBe(0);
    const secondMdc = writes.get("/proj/.cursor/rules/sipcode.mdc")!;
    expect(secondMdc).toBe(firstMdc);
  });

  it("why --agent cursor exits 1 with E009 brand-voice message", async () => {
    const errs: string[] = [];
    const r = await runWhy(
      { agent: "cursor" },
      {
        env: new FakeProcessEnv({ homeDir: "/home/test" }),
        fs: new InMemoryFs(),
        clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
        stdout: () => {},
        stderr: (s) => errs.push(s),
      },
    );
    expect(r.exitCode).toBe(1);
    const joined = errs.join("\n");
    expect(joined).toContain("[E009]");
    expect(joined).toContain("cursor transcript parsing");
    expect(joined).toContain("--agent claude-code");
  });

  it("init --agent claude-code with no CLAUDE.md still writes CLAUDE.md (legacy behavior)", async () => {
    const root = "/proj";
    const fs = tinyRepo(root);
    const writes = new Map<string, string>();
    const r = await runInit(
      { yes: true, agent: "claude-code" },
      {
        fs,
        clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
        env: new FakeProcessEnv({ homeDir: "/home/test" }),
        git: new FakeGit({ available: true, headShort: "abc1234" }),
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
    expect([...writes.keys()].find((k) => k.endsWith("/CLAUDE.md"))).toBeDefined();
    expect(
      [...writes.keys()].find((k) => k.endsWith(".cursor/rules/sipcode.mdc")),
    ).toBeUndefined();
  });

  it("unknown --agent value exits 1 with brand-voice", async () => {
    const root = "/proj";
    const fs = tinyRepo(root);
    const errs: string[] = [];
    const r = await runInit(
      { yes: true, agent: "nonsense-cli" },
      {
        fs,
        clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
        env: new FakeProcessEnv({ homeDir: "/home/test" }),
        git: new FakeGit({ available: true }),
        cwd: root,
        stdout: () => {},
        stderr: (s) => errs.push(s),
        writeFile: async () => {},
        readFile: async () => undefined,
      },
    );
    expect(r.exitCode).toBe(1);
    expect(errs.join("\n")).toContain(`unknown agent "nonsense-cli"`);
  });

  it("auto-detect prefers cursor when .cursor/ is present but CLAUDE.md is not", async () => {
    const root = "/proj";
    const fs = tinyRepo(root);
    fs.mkdir(`${root}/.cursor`);
    const writes = new Map<string, string>();
    const r = await runInit(
      { yes: true }, // no --agent
      {
        fs,
        clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
        env: new FakeProcessEnv({ homeDir: "/home/test" }),
        git: new FakeGit({ available: true, headShort: "abc1234" }),
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
    expect(
      [...writes.keys()].find((k) => k.endsWith(".cursor/rules/sipcode.mdc")),
    ).toBeDefined();
    expect([...writes.keys()].find((k) => k.endsWith("/CLAUDE.md"))).toBeUndefined();
  });
});
