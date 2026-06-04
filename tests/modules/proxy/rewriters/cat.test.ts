import { describe, it, expect } from "vitest";
import { rewriteCat } from "../../../../src/modules/proxy/rewriters/cat.js";

describe("rewriteCat", () => {
  it("wraps `cat file.txt` as head + tail", () => {
    const r = rewriteCat({ command: "cat file.txt" });
    expect(r?.updatedInput.command).toContain("head -200 file.txt");
    expect(r?.updatedInput.command).toContain("tail -100 file.txt");
    expect(r?.rewriterName).toBe("cat");
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
});
