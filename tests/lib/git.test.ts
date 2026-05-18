import { describe, expect, it } from "vitest";
import { FakeGit, RealGit, parseGitLog } from "../../src/lib/git.js";

describe("FakeGit", () => {
  it("reports availability", async () => {
    const g = new FakeGit({ available: true });
    expect(await g.available("/x")).toBe(true);
    const g2 = new FakeGit({ available: false });
    expect(await g2.available("/x")).toBe(false);
  });

  it("returns head and files", async () => {
    const g = new FakeGit({ headShort: "abc1234", files: ["a.ts", "b/c.ts"] });
    expect(await g.headShort("/x")).toBe("abc1234");
    expect(await g.lsFiles("/x")).toEqual(["a.ts", "b/c.ts"]);
  });

  it("returns scripted log", async () => {
    const g = new FakeGit({
      log: [
        { sha: "aa", timestampUnix: 100, files: ["a.ts"] },
        { sha: "bb", timestampUnix: 200, files: ["a.ts", "b.ts"] },
      ],
    });
    const log = await g.logSince("/x", 90);
    expect(log.length).toBe(2);
    expect(log[0]?.files).toEqual(["a.ts"]);
  });
});

describe("RealGit — runs against this repo if git is available", () => {
  const cwd = process.cwd();
  const g = new RealGit();

  it("available() returns true inside this repo", async () => {
    expect(await g.available(cwd)).toBe(true);
  });

  it("headShort() returns a short sha", async () => {
    const sha = await g.headShort(cwd);
    expect(typeof sha).toBe("string");
    expect(sha?.length ?? 0).toBeGreaterThan(0);
  });

  it("lsFiles() returns at least one TS source file", async () => {
    const files = await g.lsFiles(cwd);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.endsWith(".ts"))).toBe(true);
  });

  it("logSince(90) returns at least one commit", async () => {
    const log = await g.logSince(cwd, 90);
    expect(log.length).toBeGreaterThan(0);
    expect(typeof log[0]?.sha).toBe("string");
  });

  it("available() returns false outside any repo", async () => {
    // The OS temp root is not in a repo.
    const root = process.platform === "win32" ? "C:\\" : "/";
    expect(await g.available(root)).toBe(false);
  });

  it("headShort() returns undefined outside any repo", async () => {
    const root = process.platform === "win32" ? "C:\\" : "/";
    expect(await g.headShort(root)).toBeUndefined();
  });

  it("lsFiles() returns empty outside any repo", async () => {
    const root = process.platform === "win32" ? "C:\\" : "/";
    expect((await g.lsFiles(root)).length).toBe(0);
  });

  it("logSince() returns empty outside any repo", async () => {
    const root = process.platform === "win32" ? "C:\\" : "/";
    expect((await g.logSince(root, 1)).length).toBe(0);
  });
});

describe("parseGitLog", () => {
  it("parses standard log output", () => {
    const stdout = [
      "COMMIT\t111aaa\t1700000000",
      "src/a.ts",
      "src/b.ts",
      "",
      "COMMIT\t222bbb\t1700000100",
      "src/a.ts",
      "",
    ].join("\n");
    const parsed = parseGitLog(stdout);
    expect(parsed.length).toBe(2);
    expect(parsed[0]?.sha).toBe("111aaa");
    expect(parsed[0]?.timestampUnix).toBe(1700000000);
    expect(parsed[0]?.files).toEqual(["src/a.ts", "src/b.ts"]);
    expect(parsed[1]?.files).toEqual(["src/a.ts"]);
  });

  it("handles empty input", () => {
    expect(parseGitLog("")).toEqual([]);
  });

  it("ignores trailing blank lines", () => {
    const stdout = "COMMIT\tabc\t1\nsrc/x.ts\n\n\n\n";
    const parsed = parseGitLog(stdout);
    expect(parsed.length).toBe(1);
    expect(parsed[0]?.files).toEqual(["src/x.ts"]);
  });

  it("tolerates malformed timestamp", () => {
    const stdout = "COMMIT\tabc\tnotanumber\nsrc/a.ts";
    const parsed = parseGitLog(stdout);
    expect(parsed[0]?.timestampUnix).toBe(0);
  });
});
