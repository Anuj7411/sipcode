import { describe, expect, it } from "vitest";
import { runScore } from "../../../src/modules/score/run.js";
import { loadFixtureSnapshot } from "./_helpers.js";

const META = { version: "0.2.0-test", asOf: "2026-05-19T12:00:00.000Z" };

describe("runScore", () => {
  it("scores the excellent fixture at >= 95 (platinum)", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    const r = runScore(snap, META);
    expect(r.tier).toBe("platinum");
    expect(r.score).toBeGreaterThanOrEqual(95);
  });

  it("scores the average fixture in the silver-or-gold band", async () => {
    const snap = await loadFixtureSnapshot("average");
    const r = runScore(snap, META);
    expect(["silver", "gold"]).toContain(r.tier);
  });

  it("scores the poor fixture in the bronze-or-needs-work band", async () => {
    const snap = await loadFixtureSnapshot("poor");
    const r = runScore(snap, META);
    expect(["bronze", "needs-work"]).toContain(r.tier);
  });

  it("returns categories A-E each with score <= max", async () => {
    const snap = await loadFixtureSnapshot("average");
    const r = runScore(snap, META);
    expect(r.categories.map((c) => c.id)).toEqual(["A", "B", "C", "D", "E"]);
    for (const c of r.categories) expect(c.score).toBeLessThanOrEqual(c.max);
  });

  it("metaGenerator passes through version + asOf verbatim", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    const r = runScore(snap, META);
    expect(r.metaGenerator).toEqual(META);
  });

  it("is deterministic — running twice produces identical reports", async () => {
    const snap = await loadFixtureSnapshot("average");
    const a = runScore(snap, META);
    const b = runScore(snap, META);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("uses the schemaVersion 'sipcode-score/1'", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    const r = runScore(snap, META);
    expect(r.schemaVersion).toBe("sipcode-score/1");
  });

  it("sum of category scores equals report.score", async () => {
    const snap = await loadFixtureSnapshot("average");
    const r = runScore(snap, META);
    const sum = r.categories.reduce((s, c) => s + c.score, 0);
    expect(sum).toBe(r.score);
  });

  it("recommendations only reference failing checks", async () => {
    const snap = await loadFixtureSnapshot("poor");
    const r = runScore(snap, META);
    const failingIds = new Set(r.checks.filter((c) => !c.passed).map((c) => c.id));
    for (const rec of r.recommendations) {
      const id = rec.split(" ")[0];
      expect(failingIds.has(id as any)).toBe(true);
    }
  });
});
