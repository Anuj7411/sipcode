import { describe, it, expect } from "vitest";
import { rewriteCat } from "../../../../src/modules/proxy/rewriters/cat.js";

describe("rewriteCat", () => {
  it("rewrites `cat file.txt` to a size-aware awk over the file", () => {
    const r = rewriteCat({ command: "cat file.txt" });
    const cmd = r?.updatedInput.command as string;
    expect(cmd).toContain("awk '");
    expect(cmd.endsWith(" file.txt")).toBe(true);
    expect(r?.rewriterName).toBe("cat");
  });
  it("preserves small files unchanged (no head/tail duplication)", () => {
    // The else-branch prints every line for files at or below the threshold —
    // a small file is never doubled the way head -200 && tail -100 would.
    const r = rewriteCat({ command: "cat file.txt" });
    const cmd = r?.updatedInput.command as string;
    expect(cmd).toContain("else {for(i=1;i<=n;i++)print a[i]}");
    expect(cmd).toContain("n>300"); // only elide when genuinely large
  });
  it("does NOT rewrite when piped", () => {
    expect(rewriteCat({ command: "cat file.txt | grep foo" })).toBeNull();
  });
  it("does NOT rewrite when chained with &&", () => {
    expect(rewriteCat({ command: "cat foo && echo done" })).toBeNull();
  });
  it("does NOT rewrite multi-file cats (v1 simplicity)", () => {
    expect(rewriteCat({ command: "cat a.txt b.txt" })).toBeNull();
  });
  it("does NOT match `category` substring", () => {
    expect(rewriteCat({ command: "category foo" })).toBeNull();
  });
  it("does NOT rewrite `type` (bash builtin, not a file reader)", () => {
    expect(rewriteCat({ command: "type foo.txt" })).toBeNull();
    expect(rewriteCat({ command: "type ls" })).toBeNull();
  });
});
