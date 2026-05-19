import { describe, expect, it } from "vitest";
import { formatTerminal } from "../../../src/modules/score/format-terminal.js";
import { runScore } from "../../../src/modules/score/run.js";
import { loadFixtureSnapshot } from "./_helpers.js";

const META = { version: "0.2.0-test", asOf: "2026-05-19T12:00:00.000Z" };

describe("formatTerminal", () => {
  it("renders without color when useColor=false", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    const report = runScore(snap, META);
    const out = formatTerminal(report, { useColor: false });
    expect(out).toContain("sipcode score");
    expect(out).toContain("excellent");
    expect(out).toContain("platinum");
    expect(out).toContain("score:");
    // No ansi escapes:
    expect(/\[/.test(out)).toBe(false);
  });

  it("includes one line per category", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    const report = runScore(snap, META);
    const out = formatTerminal(report, { useColor: false });
    expect(out).toContain("A. manifest");
    expect(out).toContain("B. directory shape");
    expect(out).toContain("C. naming clarity");
    expect(out).toContain("D. documentation density");
    expect(out).toContain("E. predictability");
  });

  it("includes recommendations on imperfect runs", async () => {
    const snap = await loadFixtureSnapshot("average");
    const report = runScore(snap, META);
    const out = formatTerminal(report, { useColor: false });
    expect(out).toContain("would push you");
  });

  it("uses a 'nothing to fix' celebratory line on a perfect run", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    const report = runScore(snap, META);
    const out = formatTerminal(report, { useColor: false });
    if (report.recommendations.length === 0) {
      expect(out).toContain("nothing to fix");
    }
  });

  it("is deterministic for the same report", async () => {
    const snap = await loadFixtureSnapshot("average");
    const report = runScore(snap, META);
    expect(formatTerminal(report, { useColor: false })).toBe(
      formatTerminal(report, { useColor: false }),
    );
  });
});
