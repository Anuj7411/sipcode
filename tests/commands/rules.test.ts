import { describe, expect, it } from "vitest";
import { runRules } from "../../src/commands/rules.js";

function setupFs(initial?: string) {
  const files = new Map<string, string>();
  if (initial !== undefined) files.set("/proj/CLAUDE.md", initial);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const deps = {
    cwd: "/proj",
    stdout: (s: string) => stdout.push(s),
    stderr: (s: string) => stderr.push(s),
    readFile: async (p: string) => files.get(p.replace(/\\/g, "/")),
    writeFile: async (p: string, c: string) => {
      files.set(p.replace(/\\/g, "/"), c);
    },
  };
  return { files, stdout, stderr, deps };
}

describe("runRules", () => {
  it("(no flags) reports not installed for a missing CLAUDE.md", async () => {
    const { stdout, deps } = setupFs();
    const r = await runRules({}, deps);
    expect(r.exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("not installed");
  });

  it("--install creates CLAUDE.md with default-mode rules", async () => {
    const { files, stdout, deps } = setupFs();
    const r = await runRules({ install: true }, deps);
    expect(r.exitCode).toBe(0);
    const claude = files.get("/proj/CLAUDE.md")!;
    expect(claude).toContain(`mode="default"`);
    expect(claude).toContain("Sipcode Output Compression");
    expect(stdout.join("\n")).toContain("installed");
  });

  it("--install is idempotent on second call", async () => {
    const { files, stdout, deps } = setupFs();
    await runRules({ install: true }, deps);
    const after1 = files.get("/proj/CLAUDE.md")!;
    await runRules({ install: true }, deps);
    const after2 = files.get("/proj/CLAUDE.md")!;
    expect(after2).toBe(after1);
    expect(stdout.join("\n")).toContain("already installed");
  });

  it("--mode strict switches mode in place", async () => {
    const { files, stdout, deps } = setupFs();
    await runRules({ install: true }, deps);
    stdout.length = 0;
    const r = await runRules({ mode: "strict" }, deps);
    expect(r.exitCode).toBe(0);
    const claude = files.get("/proj/CLAUDE.md")!;
    expect(claude).toContain(`mode="strict"`);
    expect(claude).not.toContain(`mode="default"`);
    expect(stdout.join("\n")).toContain("default -> strict");
  });

  it("--uninstall removes the block and reports success", async () => {
    const { files, stdout, deps } = setupFs();
    await runRules({ install: true }, deps);
    stdout.length = 0;
    const r = await runRules({ uninstall: true }, deps);
    expect(r.exitCode).toBe(0);
    const claude = files.get("/proj/CLAUDE.md") ?? "";
    expect(claude).not.toContain(`name="output-compression"`);
    expect(stdout.join("\n")).toContain("removed");
  });

  it("--uninstall on never-installed file reports not-installed", async () => {
    const { stdout, deps } = setupFs("# notes\n");
    const r = await runRules({ uninstall: true }, deps);
    expect(r.exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("not installed");
  });

  it("--diff with no flags shows the install diff vs default", async () => {
    const { stdout, deps } = setupFs("# old\n");
    const r = await runRules({ diff: true }, deps);
    expect(r.exitCode).toBe(0);
    const out = stdout.join("\n");
    expect(out).toContain("would install default mode");
    expect(out).toContain("+ ");
  });

  it("--diff after install reports identical", async () => {
    const { stdout, deps } = setupFs();
    await runRules({ install: true }, deps);
    stdout.length = 0;
    const r = await runRules({ diff: true, mode: "default" }, deps);
    expect(r.exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("already in the requested state");
  });

  it("rejects an unknown --mode value", async () => {
    const { stderr, deps } = setupFs();
    const r = await runRules({ mode: "telegraphic" }, deps);
    expect(r.exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("unknown mode");
  });

  it("E005 when CLAUDE.md output-compression body is hand-edited", async () => {
    const tampered =
      `<!-- sipcode:start v=2 -->\n` +
      `<!-- sipcode:block name="output-compression" mode="default" -->\nUSER PROSE\n<!-- /sipcode:block -->\n\n` +
      `<!-- sipcode:end -->\n`;
    const { stderr, deps } = setupFs(tampered);
    const r = await runRules({ install: true }, deps);
    expect(r.exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("[E005]");
  });

  it("(no flags) on installed CLAUDE.md reports active mode", async () => {
    const { stdout, deps } = setupFs();
    await runRules({ install: true, mode: "verbose" }, deps);
    stdout.length = 0;
    const r = await runRules({}, deps);
    expect(r.exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("mode = verbose");
  });
});
