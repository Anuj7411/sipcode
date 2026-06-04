import { describe, it, expect } from "vitest";
import { rewriteGitStatus, rewriteGitLog } from "../../../../src/modules/proxy/rewriters/git.js";

describe("rewriteGitStatus", () => {
  it("rewrites `git status` to `git status -s`", () => {
    const result = rewriteGitStatus({ command: "git status" });
    expect(result).not.toBeNull();
    expect(result?.updatedInput.command).toBe("git status -s");
    expect(result?.rewriterName).toBe("git-status");
    expect(result?.savedTokensEstimate).toBeGreaterThan(0);
  });

  it("does NOT rewrite when -s is already present", () => {
    expect(rewriteGitStatus({ command: "git status -s" })).toBeNull();
  });

  it("does NOT rewrite when --short is already present", () => {
    expect(rewriteGitStatus({ command: "git status --short" })).toBeNull();
  });

  it("does NOT rewrite when --porcelain is already present", () => {
    expect(rewriteGitStatus({ command: "git status --porcelain" })).toBeNull();
  });

  it("does NOT match `git statusbar` (word-boundary check)", () => {
    expect(rewriteGitStatus({ command: "git statusbar" })).toBeNull();
  });

  it("does NOT match non-git commands", () => {
    expect(rewriteGitStatus({ command: "echo git status" })).toBeNull();
    expect(rewriteGitStatus({ command: "ls" })).toBeNull();
  });

  it("preserves other input fields", () => {
    const result = rewriteGitStatus({ command: "git status", cwd: "/tmp" });
    expect(result?.updatedInput.cwd).toBe("/tmp");
  });
});

describe("rewriteGitLog", () => {
  it("rewrites `git log` to `git log --oneline -n 20`", () => {
    const result = rewriteGitLog({ command: "git log" });
    expect(result?.updatedInput.command).toBe("git log --oneline -n 20");
    expect(result?.rewriterName).toBe("git-log");
  });

  it("does NOT rewrite when --oneline is already present", () => {
    expect(rewriteGitLog({ command: "git log --oneline" })).toBeNull();
  });

  it("does NOT rewrite when -n is already present", () => {
    expect(rewriteGitLog({ command: "git log -n 5" })).toBeNull();
  });

  it("does NOT rewrite when --max-count is already present", () => {
    expect(rewriteGitLog({ command: "git log --max-count=10" })).toBeNull();
  });

  it("does NOT rewrite when --pretty is already present", () => {
    expect(rewriteGitLog({ command: "git log --pretty=short" })).toBeNull();
  });

  it("does NOT match `git logout` (word-boundary check)", () => {
    expect(rewriteGitLog({ command: "git logout" })).toBeNull();
  });
});
