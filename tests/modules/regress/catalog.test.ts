import { describe, expect, it } from "vitest";
import { KNOWN, inRange, knownWindowsCovered, matchKnown, releaseOf, vcmp } from "../../../src/modules/regress/catalog.js";

describe("regress catalog", () => {
  it("vcmp compares numerically, three parts", () => {
    expect(vcmp("2.1.9", "2.1.10")).toBeLessThan(0);
    expect(vcmp("2.1.100", "2.1.99")).toBeGreaterThan(0);
    expect(vcmp("0.142.0", "0.142.0-alpha.3")).toBe(0);
    expect(vcmp("1.0", "1.0.0")).toBe(0);
  });

  it("inRange is inclusive", () => {
    expect(inRange("2.1.69", "2.1.69", "2.1.89")).toBe(true);
    expect(inRange("2.1.89", "2.1.69", "2.1.89")).toBe(true);
    expect(inRange("2.1.90", "2.1.69", "2.1.89")).toBe(false);
  });

  it("releaseOf drops a pre-release suffix", () => {
    expect(releaseOf("0.142.0-alpha.3")).toBe("0.142.0");
    expect(releaseOf("0.142.5")).toBe("0.142.5");
  });

  it("holds R1 to R5 with their windows", () => {
    expect(KNOWN.map((k) => [k.id, k.from, k.to, k.fixed])).toEqual([
      ["R1", "2.1.257", "2.1.259", "2.1.260"],
      ["R2", "2.1.69", "2.1.89", "2.1.90"],
      ["R3", "2.1.85", "2.1.100", "2.1.101"],
      ["R4", "2.1.0", "2.1.128", "2.1.129"],
      ["R5", "2.1.0", "2.1.247", "2.1.248"],
    ]);
  });

  it("matchKnown needs the check and an overlapping range", () => {
    expect(matchKnown("warm-cache-miss", "2.1.76", "2.1.76").map((k) => k.id)).toEqual(["R2"]);
    expect(matchKnown("warm-cache-miss", "2.1.76", "2.1.90").map((k) => k.id)).toEqual(["R2", "R3"]);
    expect(matchKnown("ttl-5m", "2.1.129", "2.1.140")).toEqual([]);
    expect(matchKnown("uncached-input", "2.1.76", "2.1.76")).toEqual([]);
    expect(matchKnown("codex-limit-burn", "0.142.0", "0.142.0")).toEqual([]);
  });

  it("knownWindowsCovered lists the entries any version falls in", () => {
    expect(knownWindowsCovered(["2.1.60"])).toEqual(["R4", "R5"]);
    expect(knownWindowsCovered(["2.1.258", "2.1.300"])).toEqual(["R1"]);
    expect(knownWindowsCovered([])).toEqual([]);
  });
});
