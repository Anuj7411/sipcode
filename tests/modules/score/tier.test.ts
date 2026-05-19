import { describe, expect, it } from "vitest";
import {
  tierFor,
  tierStars,
  tierColor,
} from "../../../src/modules/score/tier.js";

describe("tierFor", () => {
  it.each([
    [0, "needs-work"],
    [39, "needs-work"],
    [40, "bronze"],
    [59, "bronze"],
    [60, "silver"],
    [74, "silver"],
    [75, "gold"],
    [89, "gold"],
    [90, "platinum"],
    [100, "platinum"],
  ] as const)("%d -> %s", (score, expected) => {
    expect(tierFor(score)).toBe(expected);
  });
});

describe("tierStars", () => {
  it("returns 5 stars for platinum, fewer downward", () => {
    expect(tierStars("platinum")).toBe("*****");
    expect(tierStars("gold")).toBe("****");
    expect(tierStars("silver")).toBe("***");
    expect(tierStars("bronze")).toBe("**");
    expect(tierStars("needs-work")).toBe("*");
  });
});

describe("tierColor", () => {
  it("returns a 7-char hex value for every tier", () => {
    for (const t of ["platinum", "gold", "silver", "bronze", "needs-work"] as const) {
      const c = tierColor(t);
      expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
