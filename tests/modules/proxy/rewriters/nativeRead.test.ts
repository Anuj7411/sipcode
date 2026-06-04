import { describe, it, expect } from "vitest";
import { rewriteNativeRead } from "../../../../src/modules/proxy/rewriters/nativeRead.js";

describe("rewriteNativeRead", () => {
  it("injects limit=2000 when absent for non-image files", () => {
    const r = rewriteNativeRead({ file_path: "/x.ts" });
    expect(r?.updatedInput).toEqual({ file_path: "/x.ts", limit: 2000 });
    expect(r?.rewriterName).toBe("native-read");
  });
  it("does NOT inject when limit already set", () => {
    expect(rewriteNativeRead({ file_path: "/x.ts", limit: 100 })).toBeNull();
  });
  it("does NOT inject for image files (let Claude Code handle natively)", () => {
    expect(rewriteNativeRead({ file_path: "/x.png" })).toBeNull();
    expect(rewriteNativeRead({ file_path: "/photo.JPEG" })).toBeNull();
  });
  it("does NOT inject for PDFs (page-based reads)", () => {
    expect(rewriteNativeRead({ file_path: "/doc.pdf" })).toBeNull();
  });
  it("returns null when no file_path", () => {
    expect(rewriteNativeRead({})).toBeNull();
  });
});
