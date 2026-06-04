import { describe, it, expect } from "vitest";
import { rewriteNpmLs } from "../../../../src/modules/proxy/rewriters/npm.js";

describe("rewriteNpmLs", () => {
  it("rewrites `npm ls` to `npm ls --depth=0`", () => {
    const result = rewriteNpmLs({ command: "npm ls" });
    expect(result?.updatedInput.command).toBe("npm ls --depth=0");
    expect(result?.rewriterName).toBe("npm-ls");
    expect(result?.savedTokensEstimate).toBeGreaterThan(0);
  });

  it("rewrites `npm list` (alias) the same way", () => {
    const result = rewriteNpmLs({ command: "npm list" });
    expect(result?.updatedInput.command).toBe("npm list --depth=0");
  });

  it("does NOT rewrite when --depth already set", () => {
    expect(rewriteNpmLs({ command: "npm ls --depth=1" })).toBeNull();
  });

  it("does NOT rewrite when -a is set (user wants full tree)", () => {
    expect(rewriteNpmLs({ command: "npm ls -a" })).toBeNull();
  });

  it("does NOT rewrite when --all is set", () => {
    expect(rewriteNpmLs({ command: "npm ls --all" })).toBeNull();
  });

  it("does NOT rewrite when --json is set (machine-readable)", () => {
    expect(rewriteNpmLs({ command: "npm ls --json" })).toBeNull();
  });

  it("does NOT rewrite `npm install`", () => {
    expect(rewriteNpmLs({ command: "npm install foo" })).toBeNull();
  });

  it("does NOT match `npm lsof` (word-boundary check)", () => {
    expect(rewriteNpmLs({ command: "npm lsof" })).toBeNull();
  });
});
