import { describe, expect, it } from "vitest";
import "../../../../src/modules/score/checks/index.js";
import { getCheck } from "../../../../src/modules/score/registry.js";
import { checkId } from "../../../../src/modules/score/types.js";
import { buildSyntheticSnapshot } from "../_snapshotBuilder.js";

const sc = (id: string) => getCheck(checkId(id))!;

describe("SC040 — single test framework", () => {
  it("passes when only vitest is declared", () => {
    const r = sc("SC040").run(
      buildSyntheticSnapshot({
        packageJson: { devDependencies: { vitest: "1.0.0" } },
        patterns: { testFramework: "vitest" },
      }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails when vitest and jest are both declared", () => {
    const r = sc("SC040").run(
      buildSyntheticSnapshot({
        packageJson: {
          devDependencies: { vitest: "1.0.0", jest: "29.0.0" },
        },
        patterns: { testFramework: "vitest" },
      }),
    );
    expect(r.passed).toBe(false);
    expect(r.details).toContain("vitest");
    expect(r.details).toContain("jest");
  });
  it("passes when there are no tests at all", () => {
    const r = sc("SC040").run(
      buildSyntheticSnapshot({ patterns: { testFramework: "none" } }),
    );
    expect(r.passed).toBe(true);
  });
});

describe("SC041 — single lockfile", () => {
  it("passes with one lockfile", () => {
    const r = sc("SC041").run(
      buildSyntheticSnapshot({
        files: [{ path: "package-lock.json" }],
      }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails with two lockfiles", () => {
    const r = sc("SC041").run(
      buildSyntheticSnapshot({
        files: [{ path: "package-lock.json" }, { path: "yarn.lock" }],
      }),
    );
    expect(r.passed).toBe(false);
  });
});

describe("SC042 — build scripts declared", () => {
  it("passes when package.json has scripts", () => {
    const r = sc("SC042").run(
      buildSyntheticSnapshot({
        packageJson: { scripts: { build: "tsc" } },
      }),
    );
    expect(r.passed).toBe(true);
  });
  it("passes when go.mod is present", () => {
    const r = sc("SC042").run(buildSyntheticSnapshot({ goMod: "module foo" }));
    expect(r.passed).toBe(true);
  });
  it("passes when pyproject declares scripts", () => {
    const r = sc("SC042").run(
      buildSyntheticSnapshot({
        pyprojectToml: `[project.scripts]\nfoo = "foo:main"`,
      }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails when no build entry is declared anywhere", () => {
    const r = sc("SC042").run(buildSyntheticSnapshot({}));
    expect(r.passed).toBe(false);
  });
});

describe("SC043 — .gitignore exists", () => {
  it("passes when .gitignore is in the scan", () => {
    const r = sc("SC043").run(
      buildSyntheticSnapshot({ files: [{ path: ".gitignore" }] }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails when .gitignore is missing", () => {
    const r = sc("SC043").run(buildSyntheticSnapshot({}));
    expect(r.passed).toBe(false);
  });
});

describe("SC044 — lockfile committed", () => {
  it("passes when package.json + lockfile present", () => {
    const r = sc("SC044").run(
      buildSyntheticSnapshot({
        packageJson: { name: "p" },
        files: [{ path: "package-lock.json" }],
      }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails when package.json present but no lockfile", () => {
    const r = sc("SC044").run(
      buildSyntheticSnapshot({ packageJson: { name: "p" } }),
    );
    expect(r.passed).toBe(false);
  });
  it("passes when no manifest exists at all (nothing to lock)", () => {
    const r = sc("SC044").run(buildSyntheticSnapshot({}));
    expect(r.passed).toBe(true);
  });
  it("passes for go.mod + go.sum", () => {
    const r = sc("SC044").run(
      buildSyntheticSnapshot({
        goMod: "module x",
        files: [{ path: "go.sum" }],
      }),
    );
    expect(r.passed).toBe(true);
  });
});
