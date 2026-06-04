import { describe, it, expect } from "vitest";
import { rewriteGrep } from "../../../../src/modules/proxy/rewriters/grep.js";

describe("rewriteGrep", () => {
  it("adds -c to recursive grep without count mode", () => {
    const r = rewriteGrep({ command: "grep -r foo ." });
    expect(r?.updatedInput.command).toBe("grep -c -r foo .");
    expect(r?.rewriterName).toBe("grep");
  });
  it("does NOT add -c when already in count mode", () => {
    expect(rewriteGrep({ command: "grep -rc foo ." })).toBeNull();
  });
  it("does NOT add -c when in -l (file-list) mode", () => {
    expect(rewriteGrep({ command: "grep -rl foo ." })).toBeNull();
  });
  it("works for rg (ripgrep) too", () => {
    expect(rewriteGrep({ command: "rg -r foo ." })?.rewriterName).toBe("grep");
  });
  it("pipes non-recursive grep to head when no output limit", () => {
    const r = rewriteGrep({ command: "grep foo file.txt" });
    expect(r?.updatedInput.command).toBe("grep foo file.txt | head -50");
  });
  it("does NOT rewrite non-recursive grep already piped to head", () => {
    expect(rewriteGrep({ command: "grep foo file.txt | head -10" })).toBeNull();
  });
});
