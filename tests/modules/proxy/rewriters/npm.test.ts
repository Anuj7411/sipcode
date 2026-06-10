import { describe, it, expect } from "vitest";
import {
  rewriteNpmLs,
  rewriteNpmInstall,
  rewriteNpmView,
} from "../../../../src/modules/proxy/rewriters/npm.js";

describe("rewriteNpmInstall", () => {
  it("adds --no-audit --no-fund --loglevel=error to bare `npm install`", () => {
    const r = rewriteNpmInstall({ command: "npm install" });
    expect(r).not.toBeNull();
    expect(r!.updatedInput.command).toContain("--no-audit");
    expect(r!.updatedInput.command).toContain("--no-fund");
    expect(r!.updatedInput.command).toContain("--loglevel=error");
    expect(r!.rewriterName).toBe("npm-install");
  });

  it("works on the `npm i` and `npm add` aliases", () => {
    expect(rewriteNpmInstall({ command: "npm i react" })).not.toBeNull();
    expect(rewriteNpmInstall({ command: "npm add zod" })).not.toBeNull();
  });

  it("preserves caller-set flags and only adds what's missing", () => {
    const r = rewriteNpmInstall({ command: "npm install --no-fund" });
    expect(r!.updatedInput.command).toContain("--no-audit");
    expect(r!.updatedInput.command).toContain("--loglevel=error");
    expect((r!.updatedInput.command as string).match(/--no-fund/g)!.length).toBe(1);
  });

  it("returns null when all three flags are already set", () => {
    expect(
      rewriteNpmInstall({
        command: "npm install --no-audit --no-fund --silent",
      }),
    ).toBeNull();
  });

  it("respects caller's --verbose (does not force silent)", () => {
    const r = rewriteNpmInstall({ command: "npm install --verbose" });
    expect(r!.updatedInput.command).not.toContain("--loglevel=error");
  });

  it("returns null on non-install commands", () => {
    expect(rewriteNpmInstall({ command: "npm ls" })).toBeNull();
    expect(rewriteNpmInstall({ command: "git install" })).toBeNull();
  });
});

describe("rewriteNpmView", () => {
  it("appends head -80 to `npm view <pkg>` with no field arg", () => {
    const r = rewriteNpmView({ command: "npm view react" });
    expect(r).not.toBeNull();
    expect(r!.updatedInput.command).toContain("| head -80");
    expect(r!.rewriterName).toBe("npm-view");
  });

  it("works on `npm info <pkg>` alias", () => {
    expect(rewriteNpmView({ command: "npm info zod" })).not.toBeNull();
  });

  it("skips when a field is specified", () => {
    expect(rewriteNpmView({ command: "npm view react version" })).toBeNull();
  });

  it("skips when no package is specified", () => {
    expect(rewriteNpmView({ command: "npm view" })).toBeNull();
  });

  it("skips --json, piped, or redirected forms", () => {
    expect(rewriteNpmView({ command: "npm view react --json" })).toBeNull();
    expect(rewriteNpmView({ command: "npm view react > out" })).toBeNull();
    expect(rewriteNpmView({ command: "npm view react | head -5" })).toBeNull();
  });

  it("returns null on non-view commands", () => {
    expect(rewriteNpmView({ command: "npm install" })).toBeNull();
  });
});

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
