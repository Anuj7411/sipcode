import { describe, it, expect } from "vitest";
import { rewriteTsc } from "../../../../src/modules/proxy/rewriters/tsc.js";

describe("rewriteTsc", () => {
  it("appends 2>&1 | head -100 to a bare tsc call", () => {
    const r = rewriteTsc({ command: "tsc" });
    // pipefail must be present so a failing tsc propagates its exit code
    // through head instead of head masking it as success.
    expect(r!.updatedInput.command).toContain("set -o pipefail;");
    expect(r).not.toBeNull();
    expect(r!.updatedInput.command).toContain("| head -100");
    expect(r!.updatedInput.command).toContain("2>&1");
    expect(r!.rewriterName).toBe("tsc");
  });

  it("works on tsc --noEmit", () => {
    const r = rewriteTsc({ command: "tsc --noEmit" });
    expect(r).not.toBeNull();
    expect(r!.updatedInput.command).toContain("tsc --noEmit");
    expect(r!.updatedInput.command).toContain("| head -100");
  });

  it("works on npx tsc", () => {
    const r = rewriteTsc({ command: "npx tsc --noEmit" });
    expect(r).not.toBeNull();
  });

  it("skips when output is already piped to head/tail/less", () => {
    expect(rewriteTsc({ command: "tsc | head -20" })).toBeNull();
    expect(rewriteTsc({ command: "tsc --noEmit | less" })).toBeNull();
  });

  it("skips when output is redirected (>) or further piped to another command", () => {
    expect(rewriteTsc({ command: "tsc > out.log" })).toBeNull();
    expect(rewriteTsc({ command: "tsc | grep error" })).toBeNull();
  });

  it("skips --listFiles / --listEmittedFiles (caller wants the full list)", () => {
    expect(rewriteTsc({ command: "tsc --listFiles" })).toBeNull();
    expect(rewriteTsc({ command: "tsc --listEmittedFiles" })).toBeNull();
  });

  it("skips tsc --version and tsc -v (already terse)", () => {
    expect(rewriteTsc({ command: "tsc --version" })).toBeNull();
    expect(rewriteTsc({ command: "tsc -v" })).toBeNull();
  });

  it("returns null on non-tsc commands", () => {
    expect(rewriteTsc({ command: "git status" })).toBeNull();
    expect(rewriteTsc({ command: "tscompile foo.ts" })).toBeNull(); // word-boundary
  });
});
