import { describe, expect, it } from "vitest";
import "../../../../src/modules/score/checks/index.js";
import { getCheck } from "../../../../src/modules/score/registry.js";
import { checkId } from "../../../../src/modules/score/types.js";
import { buildSyntheticSnapshot } from "../_snapshotBuilder.js";

const sc = (id: string) => getCheck(checkId(id))!;

describe("SC010 — directory depth cap", () => {
  it("passes when nothing exceeds depth 6", () => {
    const r = sc("SC010").run(
      buildSyntheticSnapshot({
        files: [
          { path: "src/a/b/c/d/e/f.ts" }, // depth 6
        ],
      }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails when something is depth 7", () => {
    const r = sc("SC010").run(
      buildSyntheticSnapshot({
        files: [{ path: "src/a/b/c/d/e/f/g.ts" }],
      }),
    );
    expect(r.passed).toBe(false);
    expect(r.details).toContain("depth = 7");
  });
});

describe("SC011 — conventional source dir names", () => {
  it("passes when src/ is present", () => {
    const r = sc("SC011").run(
      buildSyntheticSnapshot({ files: [{ path: "src/main.ts" }] }),
    );
    expect(r.passed).toBe(true);
  });
  it("passes when source lives at root (flat)", () => {
    const r = sc("SC011").run(
      buildSyntheticSnapshot({ files: [{ path: "main.ts" }] }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails for oddball top-level dirs", () => {
    const r = sc("SC011").run(
      buildSyntheticSnapshot({
        files: [{ path: "weird/a.ts" }, { path: "wat/b.ts" }],
      }),
    );
    expect(r.passed).toBe(false);
  });
  it("passes when framework dictates structure (next-app)", () => {
    const r = sc("SC011").run(
      buildSyntheticSnapshot({
        files: [{ path: "app/page.tsx" }],
        framework: { framework: "next-app" },
      }),
    );
    expect(r.passed).toBe(true);
  });
});

describe("SC012 — no file over 1000 LOC", () => {
  it("passes when no file exceeds the cap", () => {
    const r = sc("SC012").run(
      buildSyntheticSnapshot({
        files: [{ path: "src/a.ts", lineCount: 500 }],
      }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails when a file exceeds 1000 LOC", () => {
    const r = sc("SC012").run(
      buildSyntheticSnapshot({
        files: [{ path: "src/huge.ts", lineCount: 1500 }],
      }),
    );
    expect(r.passed).toBe(false);
    expect(r.details).toContain("1500 LOC");
  });
});

describe("SC013 — test layout consistency", () => {
  it("passes when no tests exist", () => {
    const r = sc("SC013").run(
      buildSyntheticSnapshot({ files: [{ path: "src/a.ts" }] }),
    );
    expect(r.passed).toBe(true);
  });
  it("passes when tests are dominantly centralized", () => {
    const r = sc("SC013").run(
      buildSyntheticSnapshot({
        files: [
          { path: "tests/a.test.ts" },
          { path: "tests/b.test.ts" },
          { path: "tests/c.test.ts" },
          { path: "tests/d.test.ts" },
        ],
      }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails on a near-50/50 mix", () => {
    const r = sc("SC013").run(
      buildSyntheticSnapshot({
        files: [
          { path: "tests/a.test.ts" },
          { path: "tests/b.test.ts" },
          { path: "src/c.test.ts" },
          { path: "src/d.test.ts" },
        ],
      }),
    );
    expect(r.passed).toBe(false);
  });
});

describe("SC014 — no dead top-level dirs", () => {
  it("passes when every top-level dir has multiple files", () => {
    const r = sc("SC014").run(
      buildSyntheticSnapshot({
        files: [
          { path: "src/a.ts" },
          { path: "src/b.ts" },
        ],
      }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails when a top-level dir has only one file", () => {
    const r = sc("SC014").run(
      buildSyntheticSnapshot({
        files: [
          { path: "src/a.ts" },
          { path: "src/b.ts" },
          { path: "weird/lonely.ts" },
        ],
      }),
    );
    expect(r.passed).toBe(false);
    expect(r.details).toContain("weird");
  });
  it("ignores expected-singleton dirs like docs/", () => {
    const r = sc("SC014").run(
      buildSyntheticSnapshot({
        files: [
          { path: "src/a.ts" },
          { path: "src/b.ts" },
          { path: "docs/one.md" },
        ],
      }),
    );
    expect(r.passed).toBe(true);
  });
});
