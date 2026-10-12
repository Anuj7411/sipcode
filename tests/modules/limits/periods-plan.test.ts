/** A limit period carries the plan of its newest reading (sipcode regress compares same-plan versions). */
import { describe, expect, it } from "vitest";
import type { LimitReading } from "../../../src/modules/agents/codex/rateLimits.js";
import { buildPeriods } from "../../../src/modules/limits/periods.js";

const H = 3_600_000;
const T = Date.parse("2026-10-01T00:00:00Z");

const reading = (at: number, usedPercent: number, planType: string | undefined, resetsAt = T + 168 * H): LimitReading => ({
  at,
  sessionId: "s",
  limitId: "codex",
  planType,
  windowMinutes: 10_080,
  slot: "primary",
  usedPercent,
  resetsAt,
});

describe("buildPeriods: planType", () => {
  it("is the newest reading's plan", () => {
    const [w] = buildPeriods([reading(T + H, 5, "plus"), reading(T + 2 * H, 9, "pro")]);
    expect(w!.periods[0]!.planType).toBe("pro");
  });

  it("each period keeps its own plan", () => {
    const [w] = buildPeriods([reading(T + H, 5, "plus"), reading(T + 200 * H, 3, "pro", T + 368 * H)]);
    expect(w!.periods.map((p) => p.planType)).toEqual(["plus", "pro"]);
  });

  it("is absent when the newest reading has no plan", () => {
    const [w] = buildPeriods([reading(T + H, 5, undefined)]);
    expect("planType" in w!.periods[0]!).toBe(false);
  });
});
