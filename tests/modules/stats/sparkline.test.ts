import { describe, expect, it } from "vitest";
import { downsample, sparkline, sparklineStats } from "../../../src/modules/stats/sparkline.js";

describe("sparkline", () => {
  it("returns empty string on empty input", () => {
    expect(sparkline([])).toBe("");
  });

  it("renders one block per value when within width budget", () => {
    const s = sparkline([1, 2, 3, 4, 5, 6, 7, 8], 30);
    expect(s.length).toBe(8);
  });

  it("uses the highest block at max value", () => {
    const s = sparkline([0, 10], 30);
    expect(s).toMatch(/.█$/);
  });

  it("renders all-lowest-block when input is all zeros", () => {
    expect(sparkline([0, 0, 0, 0], 30)).toBe("▁▁▁▁");
  });

  it("downsamples wide input to width", () => {
    const values = new Array(100).fill(0).map((_, i) => i);
    const s = sparkline(values, 10);
    expect(s.length).toBe(10);
  });

  it("is deterministic — same input → same output", () => {
    const v = [3, 7, 1, 9, 2, 4, 8];
    expect(sparkline(v, 30)).toBe(sparkline(v, 30));
  });
});

describe("downsample", () => {
  it("is identity when input fits", () => {
    expect(downsample([1, 2, 3], 30)).toEqual([1, 2, 3]);
  });

  it("buckets larger input by summing", () => {
    const out = downsample([1, 1, 1, 1, 1, 1], 3);
    expect(out.length).toBe(3);
    expect(out.reduce((a, b) => a + b, 0)).toBe(6);
  });
});

describe("sparklineStats", () => {
  it("returns zeros on empty input", () => {
    expect(sparklineStats([])).toEqual({ min: 0, max: 0, median: 0 });
  });

  it("computes min/max/median for odd-length input", () => {
    expect(sparklineStats([3, 1, 4, 1, 5])).toEqual({ min: 1, max: 5, median: 3 });
  });

  it("median of even-length input is mean of middle two", () => {
    expect(sparklineStats([1, 2, 3, 4])).toEqual({ min: 1, max: 4, median: 2.5 });
  });
});
