import { describe, expect, it } from "vitest";
import { enumerateDays, isInWindow, parseSince } from "../../../src/modules/stats/window.js";

const NOW = new Date("2026-05-19T12:00:00.000Z");

describe("parseSince", () => {
  it("defaults to 30d when undefined", () => {
    const r = parseSince(undefined, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.days).toBe(30);
    expect(r.value.raw).toBe("30d");
  });

  it("parses 7d into a 7-day window ending today (UTC)", () => {
    const r = parseSince("7d", NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.days).toBe(7);
    expect(r.value.sinceIso).toBe("2026-05-13T00:00:00.000Z");
    expect(r.value.untilIso).toBe("2026-05-20T00:00:00.000Z");
  });

  it("parses 90d", () => {
    const r = parseSince("90d", NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.days).toBe(90);
  });

  it("parses 'all' as full epoch", () => {
    const r = parseSince("all", NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sinceIso).toBe(new Date(0).toISOString());
    expect(r.value.raw).toBe("all");
  });

  it("parses ISO date", () => {
    const r = parseSince("2026-04-01", NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sinceIso).toBe("2026-04-01T00:00:00.000Z");
    expect(r.value.days).toBeGreaterThan(40);
    expect(r.value.days).toBeLessThan(55);
  });

  it("rejects garbage", () => {
    const r = parseSince("zzz", NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("E010");
    expect(r.error.message).toContain("[E010]");
  });

  it("rejects 0d", () => {
    const r = parseSince("0d", NOW);
    expect(r.ok).toBe(false);
  });

  it("rejects future ISO date", () => {
    const r = parseSince("2099-01-01", NOW);
    expect(r.ok).toBe(false);
  });

  it("rejects empty string", () => {
    const r = parseSince("", NOW);
    expect(r.ok).toBe(false);
  });

  it("rejects malformed ISO date", () => {
    const r = parseSince("2026-13-99", NOW);
    expect(r.ok).toBe(false);
  });

  it("trims surrounding whitespace", () => {
    const r = parseSince("  7d  ", NOW);
    expect(r.ok).toBe(true);
  });
});

describe("isInWindow", () => {
  it("includes the lower bound, excludes the upper bound", () => {
    const r = parseSince("7d", NOW);
    if (!r.ok) throw new Error("setup failed");
    expect(isInWindow(r.value, "2026-05-13T00:00:00.000Z")).toBe(true);
    expect(isInWindow(r.value, "2026-05-19T23:59:59.000Z")).toBe(true);
    expect(isInWindow(r.value, "2026-05-20T00:00:00.000Z")).toBe(false);
    expect(isInWindow(r.value, "2026-05-12T23:59:59.000Z")).toBe(false);
  });
});

describe("enumerateDays", () => {
  it("returns N day strings for an N-day window", () => {
    const r = parseSince("7d", NOW);
    if (!r.ok) throw new Error("setup failed");
    const days = enumerateDays(r.value);
    expect(days.length).toBe(7);
    expect(days[0]).toBe("2026-05-13");
    expect(days[6]).toBe("2026-05-19");
  });

  it("caps 'all' at 366 days anchored to the recent past", () => {
    const r = parseSince("all", NOW);
    if (!r.ok) throw new Error("setup failed");
    const days = enumerateDays(r.value);
    expect(days.length).toBe(366);
    expect(days[days.length - 1]).toBe("2026-05-19");
  });
});
