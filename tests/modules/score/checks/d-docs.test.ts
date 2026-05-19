import { describe, expect, it } from "vitest";
import "../../../../src/modules/score/checks/index.js";
import { getCheck } from "../../../../src/modules/score/registry.js";
import { checkId } from "../../../../src/modules/score/types.js";
import { buildSyntheticSnapshot } from "../_snapshotBuilder.js";

const sc = (id: string) => getCheck(checkId(id))!;

describe("SC030 — README exists with >200 chars", () => {
  it("passes when README is sufficiently long", () => {
    const r = sc("SC030").run(
      buildSyntheticSnapshot({ readme: "x".repeat(300) }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails when README is too short", () => {
    const r = sc("SC030").run(
      buildSyntheticSnapshot({ readme: "tiny" }),
    );
    expect(r.passed).toBe(false);
  });
  it("fails when README is missing", () => {
    const r = sc("SC030").run(buildSyntheticSnapshot({}));
    expect(r.passed).toBe(false);
  });
});

describe("SC031 — README has a Quick start / Usage section", () => {
  it("passes when ## Quick start is present", () => {
    const r = sc("SC031").run(
      buildSyntheticSnapshot({
        readme: "# Title\n\n## Quick start\n\ndo this",
      }),
    );
    expect(r.passed).toBe(true);
  });
  it("passes for '## Getting started'", () => {
    const r = sc("SC031").run(
      buildSyntheticSnapshot({ readme: "## Getting started\nyo" }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails when no Usage/Quick start heading exists", () => {
    const r = sc("SC031").run(
      buildSyntheticSnapshot({ readme: "# Title\n\n## Background\n\nstuff" }),
    );
    expect(r.passed).toBe(false);
  });
});

describe("SC032 — top-of-file comments on source", () => {
  it("passes when most files have a top comment", () => {
    const r = sc("SC032").run(
      buildSyntheticSnapshot({
        files: [
          { path: "src/a.ts", firstLineComment: "/** a */" },
          { path: "src/b.ts", firstLineComment: "/** b */" },
          { path: "src/c.ts" },
        ],
      }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails when < 60% are commented", () => {
    const r = sc("SC032").run(
      buildSyntheticSnapshot({
        files: [
          { path: "src/a.ts" },
          { path: "src/b.ts" },
          { path: "src/c.ts", firstLineComment: "/** c */" },
        ],
      }),
    );
    expect(r.passed).toBe(false);
  });
  it("passes vacuously when there are no source files", () => {
    const r = sc("SC032").run(buildSyntheticSnapshot({}));
    expect(r.passed).toBe(true);
  });
});

describe("SC033 — public surface has JSDoc / docstrings", () => {
  it("passes when index.ts opens with /**", () => {
    const r = sc("SC033").run(
      buildSyntheticSnapshot({
        files: [{ path: "src/index.ts", firstLineComment: "/** public */" }],
      }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails when index.ts opens with a single-slash comment", () => {
    const r = sc("SC033").run(
      buildSyntheticSnapshot({
        files: [{ path: "src/index.ts", firstLineComment: "// hi" }],
      }),
    );
    expect(r.passed).toBe(false);
  });
  it("passes vacuously when there is no public surface file", () => {
    const r = sc("SC033").run(
      buildSyntheticSnapshot({
        files: [{ path: "src/internal/thing.ts", firstLineComment: "// hi" }],
      }),
    );
    expect(r.passed).toBe(true);
  });
});

describe("SC034 — architecture docs exist", () => {
  it("passes with ARCHITECTURE.md at root", () => {
    const r = sc("SC034").run(
      buildSyntheticSnapshot({ files: [{ path: "ARCHITECTURE.md" }] }),
    );
    expect(r.passed).toBe(true);
  });
  it("passes with any markdown in docs/", () => {
    const r = sc("SC034").run(
      buildSyntheticSnapshot({ files: [{ path: "docs/overview.md" }] }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails when neither exists", () => {
    const r = sc("SC034").run(
      buildSyntheticSnapshot({ files: [{ path: "src/a.ts" }] }),
    );
    expect(r.passed).toBe(false);
  });
});
