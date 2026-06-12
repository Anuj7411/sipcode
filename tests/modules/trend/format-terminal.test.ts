import { describe, it, expect } from "vitest";
import { formatTrendTerminal } from "../../../src/modules/trend/format-terminal.js";
import type { TrendResult } from "../../../src/modules/trend/compute.js";

const base: TrendResult = {
  metric: "output-ratio",
  window: { since: "2026-06-01", until: "2026-06-07" },
  days: [
    { date: "2026-06-01", sessions: 1, value: 0.2, numerator: 200, denominator: 1000 },
    { date: "2026-06-02", sessions: 1, value: 0.25, numerator: 250, denominator: 1000 },
    { date: "2026-06-03", sessions: 1, value: 0.3, numerator: 300, denominator: 1000 },
    { date: "2026-06-04", sessions: 1, value: 0.35, numerator: 350, denominator: 1000 },
    { date: "2026-06-05", sessions: 1, value: 0.4, numerator: 400, denominator: 1000 },
    { date: "2026-06-06", sessions: 1, value: 0.45, numerator: 450, denominator: 1000 },
    { date: "2026-06-07", sessions: 1, value: 0.5, numerator: 500, denominator: 1000 },
  ],
  median: 0.35,
  slopePerDay: 0.05,
  verdict: "improving",
};

describe("formatTrendTerminal", () => {
  it("renders title, verdict, window, sparkline, footer", () => {
    const out = formatTrendTerminal(base);
    expect(out).toContain("sipcode trend");
    expect(out).toContain("output ratio");
    expect(out).toContain("improving");
    expect(out).toContain("2026-06-01");
    expect(out).toContain("2026-06-07");
    expect(out).toContain("min ");
    expect(out).toContain("median ");
    expect(out).toContain("max ");
    expect(out).toContain("total sessions across window: 7");
  });

  it("formats output-ratio as a percentage", () => {
    const out = formatTrendTerminal(base);
    expect(out).toMatch(/\d+\.\d%/);
  });

  it("for cost metric, uses $ formatting and 'lower is better' framing", () => {
    const costResult: TrendResult = {
      ...base,
      metric: "cost-per-session",
      verdict: "regressing",
      slopePerDay: 0.01,
    };
    const out = formatTrendTerminal(costResult);
    expect(out).toContain("cost per session");
    expect(out).toContain("regressing");
    expect(out).toContain("$");
  });

  it("for recoverable-tokens metric, uses raw token formatting", () => {
    const recResult: TrendResult = {
      ...base,
      metric: "recoverable-tokens-per-session",
      days: base.days.map((d) => ({ ...d, value: d.value * 10000 })),
      median: 3500,
      verdict: "stable",
      slopePerDay: 0,
    };
    const out = formatTrendTerminal(recResult);
    expect(out).toContain("recoverable tokens");
    expect(out).toContain("stable");
  });

  it("shows 'insufficient-data' verdict friendly text", () => {
    const insuff: TrendResult = {
      ...base,
      verdict: "insufficient-data",
      slopePerDay: 0,
    };
    const out = formatTrendTerminal(insuff);
    expect(out).toContain("insufficient data");
    expect(out).toContain("at least 5 days");
  });
});
