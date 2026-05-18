import { describe, expect, it } from "vitest";
import {
  loadPricingForDate,
  pricingAgeDays,
  priceForModel,
} from "../../src/lib/pricing/load.js";

describe("pricing loader", () => {
  it("loads the 2026-05-01 file for a session on that day", () => {
    const p = loadPricingForDate(new Date("2026-05-01T00:00:00Z"));
    expect(p.as_of).toBe("2026-05-01");
    expect(p.models["claude-opus-4"]?.input_per_mtok).toBe(15);
  });

  it("falls back to oldest file when session predates all", () => {
    const p = loadPricingForDate(new Date("2020-01-01T00:00:00Z"));
    expect(p.as_of).toBe("2026-05-01"); // single file in bundle
  });

  it("pricingAgeDays gives positive days when now > as_of", () => {
    const p = loadPricingForDate(new Date("2026-05-01T00:00:00Z"));
    expect(pricingAgeDays(p, new Date("2026-06-01T00:00:00Z"))).toBe(31);
  });

  it("priceForModel matches aliases", () => {
    const p = loadPricingForDate(new Date("2026-05-01T00:00:00Z"));
    expect(priceForModel(p, "claude-opus-4")).toBeDefined();
    expect(priceForModel(p, "claude-opus-4-7")).toBeDefined();
    expect(priceForModel(p, "claude-sonnet-4-5")).toBeDefined();
    expect(priceForModel(p, "claude-haiku-4")).toBeDefined();
    expect(priceForModel(p, "gpt-5")).toBeUndefined();
  });
});
