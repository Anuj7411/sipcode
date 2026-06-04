import { describe, it, expect } from "vitest";
import { rewriteNativeGrep } from "../../../../src/modules/proxy/rewriters/nativeGrep.js";

describe("rewriteNativeGrep", () => {
  it("injects head_limit=50 when absent", () => {
    const r = rewriteNativeGrep({ pattern: "foo" });
    expect(r?.updatedInput).toEqual({ pattern: "foo", head_limit: 50 });
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
});
