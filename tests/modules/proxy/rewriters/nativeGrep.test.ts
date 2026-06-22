import { describe, it, expect } from "vitest";
import { rewriteNativeGrep } from "../../../../src/modules/proxy/rewriters/nativeGrep.js";

describe("rewriteNativeGrep", () => {
  it("injects head_limit=100 when absent (v1.6.16: raised from 50)", () => {
    const r = rewriteNativeGrep({ pattern: "foo" });
    expect(r?.updatedInput).toEqual({ pattern: "foo", head_limit: 100 });
    expect(r?.rewriterName).toBe("native-grep");
  });
  it("does NOT inject when head_limit already set", () => {
    expect(rewriteNativeGrep({ pattern: "foo", head_limit: 10 })).toBeNull();
  });
  it("does NOT inject for count output mode (already compact)", () => {
    expect(rewriteNativeGrep({ pattern: "foo", output_mode: "count" })).toBeNull();
  });
  it("returns null when no pattern", () => {
    expect(rewriteNativeGrep({})).toBeNull();
  });
  it("declares integrity 0.78 (v1.6.16: raised from 0.65)", () => {
    const r = rewriteNativeGrep({ pattern: "foo" });
    expect(r?.integrityScore).toBe(0.78);
  });
  it("integrity note reflects the 100-match cap", () => {
    const r = rewriteNativeGrep({ pattern: "foo" });
    expect(r?.integrityNote).toContain("100");
  });
  it("preserves other input fields when injecting head_limit", () => {
    const r = rewriteNativeGrep({
      pattern: "foo",
      glob: "**/*.ts",
      output_mode: "content",
      "-n": true,
    });
    expect(r?.updatedInput).toEqual({
      pattern: "foo",
      glob: "**/*.ts",
      output_mode: "content",
      "-n": true,
      head_limit: 100,
    });
  });
});
