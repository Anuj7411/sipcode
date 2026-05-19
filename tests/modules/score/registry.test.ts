import { describe, expect, it } from "vitest";
import "../../../src/modules/score/checks/index.js";
import {
  getAllChecks,
  getCheck,
  getChecksByCategory,
} from "../../../src/modules/score/registry.js";
import { checkId } from "../../../src/modules/score/types.js";

describe("score registry", () => {
  const all = getAllChecks();

  it("registers exactly 24 checks (A:5 + B:5 + C:4 + D:5 + E:5)", () => {
    expect(all.length).toBe(24);
  });

  it("registers every expected SC id", () => {
    const ids = new Set(all.map((c) => c.id as string));
    const expected = [
      "SC001", "SC002", "SC003", "SC004", "SC005",
      "SC010", "SC011", "SC012", "SC013", "SC014",
      "SC020", "SC021", "SC022", "SC023",
      "SC030", "SC031", "SC032", "SC033", "SC034",
      "SC040", "SC041", "SC042", "SC043", "SC044",
    ];
    for (const id of expected) expect(ids.has(id), id).toBe(true);
  });

  it("has unique check IDs", () => {
    const ids = new Set(all.map((c) => c.id));
    expect(ids.size).toBe(all.length);
  });

  it("sums maxPoints across all checks to exactly 100", () => {
    const total = all.reduce((s, c) => s + c.maxPoints, 0);
    expect(total).toBe(100);
  });

  it("each category sums to 20 points", () => {
    for (const cat of ["A", "B", "C", "D", "E"] as const) {
      const sub = getChecksByCategory(cat);
      const sum = sub.reduce((s, c) => s + c.maxPoints, 0);
      expect(sum, `category ${cat}`).toBe(20);
    }
  });

  it("each category contains the expected number of checks", () => {
    const counts: Record<string, number> = { A: 5, B: 5, C: 4, D: 5, E: 5 };
    for (const cat of ["A", "B", "C", "D", "E"] as const) {
      expect(getChecksByCategory(cat).length, `category ${cat}`).toBe(counts[cat]);
    }
  });

  it("returns checks sorted by category then id", () => {
    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1]!;
      const b = all[i]!;
      if (a.category !== b.category) {
        expect(a.category < b.category).toBe(true);
      } else {
        expect(a.id < b.id).toBe(true);
      }
    }
  });

  it("getCheck returns undefined for unknown id", () => {
    expect(getCheck(checkId("SC999"))).toBeUndefined();
  });

  it("getCheck returns the registered check for SC001", () => {
    const c = getCheck(checkId("SC001"));
    expect(c).toBeDefined();
    expect(c!.label).toContain("CLAUDE.md");
  });

  it("all SC###-shaped ids exist", () => {
    for (const c of all) {
      expect(/^SC\d{3}$/.test(c.id)).toBe(true);
    }
  });
});
