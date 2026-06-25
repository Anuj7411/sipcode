import { describe, expect, it, vi } from "vitest";
import { runUpdate } from "../../src/commands/update.js";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (s: string) => out.push(s),
    stderr: (s: string) => err.push(s),
  };
}

describe("runUpdate", () => {
  it("default: prints version + npm command + changelog, never spawns npm", async () => {
    const c = capture();
    const runNpm = vi.fn();
    const r = await runUpdate(
      {},
      { stdout: c.stdout, stderr: c.stderr, version: "1.6.16", runNpm },
    );
    const text = c.out.join("\n");
    expect(r.exitCode).toBe(0);
    expect(text).toContain("v1.6.16");
    expect(text).toContain("npm i -g sipcode@latest");
    expect(text).toContain("CHANGELOG.md");
    expect(text).toContain("zero network calls");
    expect(runNpm).not.toHaveBeenCalled();
  });

  it("--run success: invokes npm with the right args and reports done", async () => {
    const c = capture();
    const runNpm = vi.fn(() => ({ status: 0 }));
    const r = await runUpdate(
      { run: true },
      { stdout: c.stdout, stderr: c.stderr, version: "1.6.16", runNpm },
    );
    expect(runNpm).toHaveBeenCalledWith(["i", "-g", "sipcode@latest"]);
    expect(r.exitCode).toBe(0);
    expect(c.out.join("\n")).toContain("done");
  });

  it("--run failure: non-zero status returns exit 1 with manual fallback", async () => {
    const c = capture();
    const runNpm = vi.fn(() => ({ status: 1 }));
    const r = await runUpdate(
      { run: true },
      { stdout: c.stdout, stderr: c.stderr, version: "1.6.16", runNpm },
    );
    expect(r.exitCode).toBe(1);
    expect(c.err.join("\n")).toContain("npm i -g sipcode@latest");
  });
});
