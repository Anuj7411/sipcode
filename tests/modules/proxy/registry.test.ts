import { describe, it, expect } from "vitest";
import { resolveRewriter } from "../../../src/modules/proxy/registry.js";

describe("resolveRewriter", () => {
  it("Bash + git status → git-status rewriter", () => {
    const fn = resolveRewriter("Bash");
    expect(fn?.({ command: "git status" })?.rewriterName).toBe("git-status");
  });
  it("Bash + git log → git-log rewriter", () => {
    const fn = resolveRewriter("Bash");
    expect(fn?.({ command: "git log" })?.rewriterName).toBe("git-log");
  });
  it("Bash + npm ls → npm-ls rewriter", () => {
    const fn = resolveRewriter("Bash");
    expect(fn?.({ command: "npm ls" })?.rewriterName).toBe("npm-ls");
  });
  it("Bash + cargo check → cargo rewriter", () => {
    const fn = resolveRewriter("Bash");
    expect(fn?.({ command: "cargo check" })?.rewriterName).toBe("cargo");
  });
  it("Bash + ls /tmp → ls rewriter", () => {
    const fn = resolveRewriter("Bash");
    expect(fn?.({ command: "ls /tmp" })?.rewriterName).toBe("ls");
  });
  it("Bash + unmatched command → null (no rewrite)", () => {
    const fn = resolveRewriter("Bash");
    expect(fn?.({ command: "echo hello" })).toBeNull();
  });
  it("Read tool → no rewriter (Claude Code already caps reads at 2000 lines)", () => {
    expect(resolveRewriter("Read")).toBeNull();
  });
  it("Grep tool → native-grep rewriter", () => {
    const fn = resolveRewriter("Grep");
    expect(fn?.({ pattern: "foo" })?.rewriterName).toBe("native-grep");
  });
  it("Glob tool → native-glob rewriter", () => {
    const fn = resolveRewriter("Glob");
    expect(fn?.({ pattern: "**/*.ts" })?.rewriterName).toBe("native-glob");
  });
  it("Unknown tool → null (no rewriter)", () => {
    expect(resolveRewriter("WebFetch")).toBeNull();
  });
});
