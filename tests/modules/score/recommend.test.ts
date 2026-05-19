import { describe, expect, it } from "vitest";
import { buildRecommendations } from "../../../src/modules/score/recommend.js";
import type { CheckResult } from "../../../src/modules/score/types.js";
import { checkId } from "../../../src/modules/score/types.js";

function r(over: Partial<CheckResult>): CheckResult {
  return {
    id: checkId("SC001"),
    category: "A",
    label: "label",
    passed: false,
    points: 0,
    maxPoints: 5,
    ...over,
  };
}

describe("buildRecommendations", () => {
  it("returns empty when nothing is failing", () => {
    expect(
      buildRecommendations([r({ passed: true, points: 5 })]),
    ).toEqual([]);
  });

  it("ignores passes even when intermixed", () => {
    const out = buildRecommendations([
      r({ id: checkId("SC001"), passed: true, points: 5 }),
      r({ id: checkId("SC002"), passed: false, maxPoints: 4 }),
    ]);
    expect(out.length).toBe(1);
    expect(out[0]).toContain("SC002");
  });

  it("orders by point loss desc, then id asc", () => {
    const out = buildRecommendations([
      r({ id: checkId("SC010"), maxPoints: 3 }),
      r({ id: checkId("SC011"), maxPoints: 5 }),
      r({ id: checkId("SC003"), maxPoints: 5 }),
      r({ id: checkId("SC020"), maxPoints: 4 }),
    ]);
    expect(out.map((s) => s.split(" ")[0])).toEqual([
      "SC003",
      "SC011",
      "SC020",
      "SC010",
    ]);
  });

  it("uses the details string when present, falls back to label otherwise", () => {
    const out = buildRecommendations([
      r({ id: checkId("SC001"), maxPoints: 5, details: "specific reason" }),
      r({ id: checkId("SC002"), maxPoints: 5, label: "generic label" }),
    ]);
    expect(out[0]).toContain("specific reason");
    expect(out[1]).toContain("generic label");
  });

  it("formats each line as 'ID (-Npts): detail'", () => {
    const out = buildRecommendations([
      r({ id: checkId("SC001"), maxPoints: 5, details: "ouch" }),
    ]);
    expect(out[0]).toBe("SC001 (-5pts): ouch");
  });
});
