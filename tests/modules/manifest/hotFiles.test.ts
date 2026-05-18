import { describe, expect, it } from "vitest";
import { FakeGit } from "../../../src/lib/git.js";
import { computeHotFiles } from "../../../src/modules/manifest/hotFiles.js";

describe("computeHotFiles", () => {
  it("returns E006 when git not available", async () => {
    const git = new FakeGit({ available: false });
    const r = await computeHotFiles({
      git,
      projectRoot: "/x",
      knownFiles: new Set(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]?.code).toBe("E006");
  });

  it("ranks by change count then alphabetically", async () => {
    const git = new FakeGit({
      log: [
        { sha: "1", timestampUnix: 1, files: ["a.ts", "b.ts"] },
        { sha: "2", timestampUnix: 2, files: ["b.ts"] },
        { sha: "3", timestampUnix: 3, files: ["b.ts", "c.ts"] },
      ],
    });
    const r = await computeHotFiles({
      git,
      projectRoot: "/x",
      knownFiles: new Set(["a.ts", "b.ts", "c.ts"]),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([
      { path: "b.ts", changes: 3 },
      { path: "a.ts", changes: 1 },
      { path: "c.ts", changes: 1 },
    ]);
  });

  it("ignores files not in knownFiles set", async () => {
    const git = new FakeGit({
      log: [
        { sha: "1", timestampUnix: 1, files: ["a.ts", "deleted.ts"] },
      ],
    });
    const r = await computeHotFiles({
      git,
      projectRoot: "/x",
      knownFiles: new Set(["a.ts"]),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual([{ path: "a.ts", changes: 1 }]);
    }
  });

  it("caps at topN", async () => {
    const files = Array.from({ length: 30 }, (_, i) => `f${i}.ts`);
    const git = new FakeGit({
      log: files.map((f, i) => ({
        sha: `${i}`,
        timestampUnix: i,
        files: [f],
      })),
    });
    const r = await computeHotFiles({
      git,
      projectRoot: "/x",
      knownFiles: new Set(files),
      topN: 5,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.length).toBe(5);
  });
});
