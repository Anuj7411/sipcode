import { describe, expect, it } from "vitest";
import "../../../../src/modules/score/checks/index.js";
import { getCheck } from "../../../../src/modules/score/registry.js";
import { checkId } from "../../../../src/modules/score/types.js";
import { buildSyntheticSnapshot } from "../_snapshotBuilder.js";

const sc = (id: string) => getCheck(checkId(id))!;

describe("SC020 — descriptive filenames", () => {
  it("passes when filenames are descriptive", () => {
    const r = sc("SC020").run(
      buildSyntheticSnapshot({
        files: [{ path: "src/render-tree.ts" }, { path: "src/parse-args.ts" }],
      }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails on common throwaway names like foo.ts", () => {
    const r = sc("SC020").run(
      buildSyntheticSnapshot({
        files: [{ path: "src/foo.ts" }, { path: "src/bar.ts" }],
      }),
    );
    expect(r.passed).toBe(false);
  });
  it("fails on single-letter filenames", () => {
    const r = sc("SC020").run(
      buildSyntheticSnapshot({ files: [{ path: "src/a.ts" }] }),
    );
    expect(r.passed).toBe(false);
  });
});

describe("SC021 — consistent naming convention", () => {
  it("passes when all files in a dir use the same casing", () => {
    const r = sc("SC021").run(
      buildSyntheticSnapshot({
        files: [
          { path: "src/render-tree.ts" },
          { path: "src/parse-args.ts" },
          { path: "src/check-thing.ts" },
        ],
      }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails on heavy mixing within one dir", () => {
    const r = sc("SC021").run(
      buildSyntheticSnapshot({
        files: [
          { path: "src/render-tree.ts" },
          { path: "src/ParseArgs.ts" },
          { path: "src/check_thing.ts" },
        ],
      }),
    );
    expect(r.passed).toBe(false);
  });
});

describe("SC022 — no god utils file", () => {
  it("passes when utils.ts is small", () => {
    const r = sc("SC022").run(
      buildSyntheticSnapshot({
        files: [{ path: "src/utils.ts", lineCount: 50 }],
      }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails when utils.ts is over 200 LOC", () => {
    const r = sc("SC022").run(
      buildSyntheticSnapshot({
        files: [{ path: "src/utils.ts", lineCount: 250 }],
      }),
    );
    expect(r.passed).toBe(false);
    expect(r.details).toContain("god-module");
  });
  it("fails for helpers.ts as well", () => {
    const r = sc("SC022").run(
      buildSyntheticSnapshot({
        files: [{ path: "src/helpers.ts", lineCount: 220 }],
      }),
    );
    expect(r.passed).toBe(false);
  });
});

describe("SC023 — test files use a test suffix", () => {
  it("passes when files in tests/ end with .test.ts", () => {
    const r = sc("SC023").run(
      buildSyntheticSnapshot({
        files: [{ path: "tests/foo.test.ts" }, { path: "tests/bar.test.ts" }],
      }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails on a stray test-dir file without a test suffix", () => {
    const r = sc("SC023").run(
      buildSyntheticSnapshot({
        files: [{ path: "tests/foo.test.ts" }, { path: "tests/strayfile.ts" }],
      }),
    );
    expect(r.passed).toBe(false);
  });
  it("ignores fixtures/ subdir", () => {
    const r = sc("SC023").run(
      buildSyntheticSnapshot({
        files: [
          { path: "tests/foo.test.ts" },
          { path: "tests/fixtures/anything.ts" },
        ],
      }),
    );
    expect(r.passed).toBe(true);
  });
});
