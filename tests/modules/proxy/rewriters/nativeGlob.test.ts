import { describe, it, expect } from "vitest";
import { rewriteNativeGlob } from "../../../../src/modules/proxy/rewriters/nativeGlob.js";

describe("rewriteNativeGlob", () => {
  it("injects head_limit=100 when absent", () => {
    const r = rewriteNativeGlob({ pattern: "**/*.ts" });
    expect(r?.updatedInput).toEqual({ pattern: "**/*.ts", head_limit: 100 });
    expect(r?.rewriterName).toBe("native-glob");
  });
  it("does NOT inject when head_limit already set", () => {
    expect(rewriteNativeGlob({ pattern: "**/*.ts", head_limit: 20 })).toBeNull();
  });
  it("returns null when no pattern", () => {
    expect(rewriteNativeGlob({})).toBeNull();
  });
});
