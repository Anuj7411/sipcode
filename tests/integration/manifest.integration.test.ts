import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import { FakeGit } from "../../src/lib/git.js";
import { runManifest } from "../../src/commands/manifest.js";

function tinyNextRepo(root: string): InMemoryFs {
  const fs = new InMemoryFs();
  fs.writeFile(
    `${root}/package.json`,
    JSON.stringify({
      name: "demo-next",
      dependencies: { next: "^14.0.0", react: "^18.0.0" },
      devDependencies: { vitest: "^2.0.0", typescript: "^5.5.0" },
      packageManager: "pnpm@9.0.0",
    }),
  );
  fs.writeFile(
    `${root}/app/layout.tsx`,
    "/** Root layout. */\nexport default function L({ children }: any) { return children; }",
  );
  fs.writeFile(
    `${root}/app/page.tsx`,
    "/** Home page. */\nimport { Button } from '../components/Button';\nexport default function P() { return <Button>x</Button>; }",
  );
  fs.writeFile(
    `${root}/components/Button.tsx`,
    "/** Reusable button. */\nexport function Button({ children }: any) { return <button>{children}</button>; }",
  );
  fs.writeFile(`${root}/tsconfig.json`, "{}");
  fs.writeFile(`${root}/pnpm-lock.yaml`, "");
  return fs;
}

describe("runManifest — integration", () => {
  it("end-to-end against a tiny Next.js app fixture", async () => {
    const root = "/demo";
    const fs = tinyNextRepo(root);
    const writes = new Map<string, string>();
    const out: string[] = [];
    const r = await runManifest(
      {},
      {
        fs,
        clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
        env: new FakeProcessEnv(),
        git: new FakeGit({
          available: true,
          headShort: "abc1234",
          log: [
            { sha: "1", timestampUnix: 1, files: ["app/page.tsx"] },
            { sha: "2", timestampUnix: 2, files: ["app/page.tsx", "components/Button.tsx"] },
          ],
        }),
        cwd: root,
        stdout: (s) => out.push(s),
        stderr: () => {},
        writeFile: async (p, c) => {
          writes.set(p.replace(/\\/g, "/"), c);
        },
      },
    );

    expect(r.exitCode).toBe(0);
    const manifestKey = [...writes.keys()].find((k) =>
      k.endsWith(".sipcode/manifest.md"),
    );
    expect(manifestKey).toBeDefined();
    const content = writes.get(manifestKey!)!;
    expect(content).toContain("# Project manifest — demo-next");
    expect(content).toContain("## Framework");
    expect(content).toContain("next-app");
    expect(content).toContain("pnpm");
    expect(content).toContain("## Hot files");
    expect(content).toContain("app/page.tsx");
    expect(content).toContain("HEAD@abc1234");
    expect(content).not.toMatch(/\\/);
  });

  it("idempotence — two runs on same inputs produce byte-identical output", async () => {
    const root = "/demo";
    const fs = tinyNextRepo(root);
    const captures: string[] = [];
    for (let i = 0; i < 2; i++) {
      const writes = new Map<string, string>();
      await runManifest(
        {},
        {
          fs,
          clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
          env: new FakeProcessEnv(),
          git: new FakeGit({
            available: true,
            headShort: "abc1234",
            log: [{ sha: "1", timestampUnix: 1, files: ["app/page.tsx"] }],
          }),
          cwd: root,
          stdout: () => {},
          stderr: () => {},
          writeFile: async (p, c) => {
            writes.set(p.replace(/\\/g, "/"), c);
          },
        },
      );
      const key = [...writes.keys()].find((k) =>
        k.endsWith(".sipcode/manifest.md"),
      );
      captures.push(writes.get(key!)!);
    }
    expect(captures[0]).toBe(captures[1]);
  });

  it("E001 when over budget without --tighten, succeeds with it", async () => {
    const root = "/big";
    const fs = new InMemoryFs();
    fs.writeFile(`${root}/package.json`, '{"name":"big"}');
    // Bloat: 300 files, each with imports to push past 2000-token budget.
    for (let i = 0; i < 300; i++) {
      fs.writeFile(
        `${root}/src/m${i}/file-with-a-fairly-long-name-${i}.ts`,
        `/** purpose number ${i} doing some specific thing inside the module */\nimport { x } from '../m${(i + 1) % 300}/file-with-a-fairly-long-name-${(i + 1) % 300}';\nexport const v${i} = ${i};`,
      );
    }
    const stderr: string[] = [];
    const r1 = await runManifest(
      { budget: true, tighten: false },
      {
        fs,
        clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
        env: new FakeProcessEnv(),
        git: new FakeGit({ available: false }),
        cwd: root,
        stdout: () => {},
        stderr: (s) => stderr.push(s),
        writeFile: async () => {},
      },
    );
    expect(r1.exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("[E001]");

    const writes = new Map<string, string>();
    const r2 = await runManifest(
      { budget: true, tighten: true },
      {
        fs,
        clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
        env: new FakeProcessEnv(),
        git: new FakeGit({ available: false }),
        cwd: root,
        stdout: () => {},
        stderr: () => {},
        writeFile: async (p, c) => {
          writes.set(p.replace(/\\/g, "/"), c);
        },
      },
    );
    expect(r2.exitCode).toBe(0);
    expect(r2.tokenCount ?? 0).toBeLessThanOrEqual(2000);
  });

  it("works when git is unavailable (E006 surfaced, manifest still ships)", async () => {
    const root = "/nogit";
    const fs = new InMemoryFs();
    fs.writeFile(`${root}/package.json`, '{"name":"nogit"}');
    fs.writeFile(`${root}/src/a.ts`, "/** alpha. */\nexport const a = 1;");
    const writes = new Map<string, string>();
    const stderr: string[] = [];
    const r = await runManifest(
      {},
      {
        fs,
        clock: new FakeClock(new Date("2026-05-19T00:00:00Z")),
        env: new FakeProcessEnv(),
        git: new FakeGit({ available: false }),
        cwd: root,
        stdout: () => {},
        stderr: (s) => stderr.push(s),
        writeFile: async (p, c) => {
          writes.set(p.replace(/\\/g, "/"), c);
        },
      },
    );
    expect(r.exitCode).toBe(0);
    expect(stderr.join("\n")).toContain("[E006]");
    const k = [...writes.keys()].find((x) => x.endsWith(".sipcode/manifest.md"));
    const content = writes.get(k!)!;
    expect(content).not.toContain("## Hot files");
  });

  it("--delta is stubbed (prints v1.1+ message)", async () => {
    const out: string[] = [];
    const r = await runManifest(
      { delta: true },
      {
        fs: new InMemoryFs(),
        clock: new FakeClock(new Date()),
        env: new FakeProcessEnv(),
        git: new FakeGit({}),
        cwd: "/x",
        stdout: (s) => out.push(s),
        stderr: () => {},
        writeFile: async () => {},
      },
    );
    expect(r.exitCode).toBe(0);
    expect(out.join("\n")).toContain("v1.1+");
  });
});
