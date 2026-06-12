import { describe, it, expect } from "vitest";
import {
  resolveBaseline,
  MIN_DAYS_FOR_BASELINE,
} from "../../src/lib/baseline-window.js";

const now = new Date("2026-06-15T12:00:00.000Z");

function daysAgo(n: number): string {
  return new Date(now.getTime() - n * 86_400_000).toISOString();
}

describe("resolveBaseline — cascade", () => {
  it("picks 30 when ≥30 days of history", () => {
    const r = resolveBaseline([daysAgo(31), daysAgo(2)], now);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.window.windowDays).toBe(30);
    expect(r.window.isPartial).toBe(false);
  });

  it("picks 14 (partial) when 14 ≤ days < 30", () => {
    const r = resolveBaseline([daysAgo(20), daysAgo(2)], now);
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.window.windowDays).toBe(14);
    expect(r.window.isPartial).toBe(true);
    expect(r.window.label).toContain("all you have so far");
  });

  it("picks 7 (partial) when 7 ≤ days < 14", () => {
    const r = resolveBaseline([daysAgo(10), daysAgo(2)], now);
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.window.windowDays).toBe(7);
    expect(r.window.isPartial).toBe(true);
  });

  it("picks 3 (partial) when 3 ≤ days < 7", () => {
    const r = resolveBaseline([daysAgo(5), daysAgo(1)], now);
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.window.windowDays).toBe(3);
    expect(r.window.isPartial).toBe(true);
  });

  it("returns insufficient when days < MIN_DAYS_FOR_BASELINE", () => {
    const r = resolveBaseline([daysAgo(2)], now);
    expect(r.kind).toBe("insufficient");
    if (r.kind !== "insufficient") return;
    expect(r.daysAvailable).toBe(2);
  });

  it("returns insufficient for empty input", () => {
    const r = resolveBaseline([], now);
    expect(r.kind).toBe("insufficient");
  });

  it("ignores invalid ISO strings", () => {
    const r = resolveBaseline(["not-iso", daysAgo(31)], now);
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.window.windowDays).toBe(30);
  });

  it(`MIN_DAYS_FOR_BASELINE = 3 (documented minimum)`, () => {
    expect(MIN_DAYS_FOR_BASELINE).toBe(3);
  });
});
