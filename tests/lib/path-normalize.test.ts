import { describe, it, expect } from "vitest";
import { normalizeFilePath } from "../../src/lib/path-normalize.js";

describe("normalizeFilePath", () => {
  it("converts backslashes to forward slashes (Windows -> POSIX)", () => {
    expect(normalizeFilePath("C:\\foo\\bar\\baz.ts")).toBe("c:/foo/bar/baz.ts");
  });

  it("lowercases the Windows drive letter", () => {
    expect(normalizeFilePath("C:/foo/bar.ts")).toBe("c:/foo/bar.ts");
    expect(normalizeFilePath("D:/projects/sipcode")).toBe("d:/projects/sipcode");
  });

  it("collapses ./ and ../ segments", () => {
    expect(normalizeFilePath("./src/foo.ts")).toBe("src/foo.ts");
    expect(normalizeFilePath("src/../lib/bar.ts")).toBe("lib/bar.ts");
    expect(normalizeFilePath("a/b/./c/../d.ts")).toBe("a/b/d.ts");
  });

  it("BUG-FIX (v1.6.14): C:\\foo\\bar.ts and c:/foo/bar.ts normalize equal", () => {
    expect(normalizeFilePath("C:\\foo\\bar.ts")).toBe(normalizeFilePath("c:/foo/bar.ts"));
  });

  it("BUG-FIX: ./auth.ts and auth.ts normalize equal", () => {
    expect(normalizeFilePath("./auth.ts")).toBe(normalizeFilePath("auth.ts"));
  });

  it("preserves trailing slashes (path.posix.normalize quirk); file paths never end in /, so this only matters for directories", () => {
    // We deliberately don't strip trailing slashes — Read tool calls never
    // target directories, so the case doesn't arise in dedup. Documented for
    // future readers who might be surprised by the unchanged behavior.
    expect(normalizeFilePath("src/foo/")).toBe("src/foo/");
  });

  it("BUG-FIX: mixed-case directory names DO matter (POSIX file systems are case-sensitive)", () => {
    // We do NOT lowercase the whole path — only the drive letter. macOS and
    // Linux file systems are case-sensitive; "Foo.ts" and "foo.ts" are real
    // distinct files.
    expect(normalizeFilePath("/home/user/Foo.ts")).toBe("/home/user/Foo.ts");
    expect(normalizeFilePath("/home/user/foo.ts")).not.toBe("/home/user/Foo.ts");
  });

  it("idempotent: normalizing twice = once", () => {
    for (const p of [
      "C:\\foo\\bar.ts",
      "./src/baz.ts",
      "/abs/path/x.py",
      "a/b/../c",
    ]) {
      expect(normalizeFilePath(normalizeFilePath(p))).toBe(normalizeFilePath(p));
    }
  });

  it("empty input returned unchanged (defensive — don't surprise callers)", () => {
    expect(normalizeFilePath("")).toBe("");
  });

  it("non-string input returned unchanged (defensive)", () => {
    expect(normalizeFilePath(null as unknown as string)).toBe(null as unknown as string);
    expect(normalizeFilePath(undefined as unknown as string)).toBe(
      undefined as unknown as string,
    );
  });
});
