import { describe, expect, it } from "vitest";
import { formatJson } from "../../../src/modules/score/format-json.js";
import { runScore } from "../../../src/modules/score/run.js";
import { loadFixtureSnapshot } from "./_helpers.js";

const META = { version: "0.2.0-test", asOf: "2026-05-19T12:00:00.000Z" };

describe("formatJson", () => {
  it("produces valid JSON parseable by JSON.parse", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    const json = formatJson(runScore(snap, META));
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe("sipcode-score/1");
  });

  it("matches a stable shape snapshot for the excellent fixture", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    const json = JSON.parse(formatJson(runScore(snap, META)));
    // Shape — values are real (not snapshotted byte-for-byte to avoid
    // brittle file-count coupling), but the shape is locked.
    expect(Object.keys(json).sort()).toEqual([
      "categories",
      "checks",
      "metaGenerator",
      "project",
      "recommendations",
      "schemaVersion",
      "score",
      "tier",
    ]);
    expect(Object.keys(json.project).sort()).toEqual([
      "filesScanned",
      "name",
    ]);
    expect(json.categories.length).toBe(5);
    expect(json.checks.length).toBe(24);
  });

  it("is byte-identical when run twice on the same snapshot", async () => {
    const snap = await loadFixtureSnapshot("average");
    const a = formatJson(runScore(snap, META));
    const b = formatJson(runScore(snap, META));
    expect(a).toBe(b);
  });

  it("uses 2-space indentation", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    const json = formatJson(runScore(snap, META));
    expect(json.split("\n")[1]!.startsWith("  ")).toBe(true);
  });

  it("includes only failing details (passing checks have no `details` key)", async () => {
    const snap = await loadFixtureSnapshot("average");
    const json = JSON.parse(formatJson(runScore(snap, META)));
    for (const c of json.checks) {
      if (c.passed) expect("details" in c).toBe(false);
    }
  });
});
