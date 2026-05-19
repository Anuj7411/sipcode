import { describe, expect, it } from "vitest";
import { formatTerminal } from "../../../src/modules/stats/format-terminal.js";
import { renderStats } from "../../../src/modules/stats/render.js";
import { parseSince } from "../../../src/modules/stats/window.js";
import type { AggregatedSession } from "../../../src/modules/stats/types.js";
import { loadPricingForDate } from "../../../src/lib/pricing/load.js";

const NOW = new Date("2026-05-19T12:00:00.000Z");

function fixtureSession(over: Partial<AggregatedSession> = {}): AggregatedSession {
  return {
    sessionId: "abc12345xyz",
    sessionIdShort: "abc12345",
    projectHash: "p",
    projectName: "sipcode",
    startedAt: "2026-05-18T10:00:00.000Z",
    endedAt: "2026-05-18T11:00:00.000Z",
    durationSec: 3600,
    durationHuman: "1h 00m",
    primaryModel: "claude-opus-4",
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 5000,
    cacheCreationTokens: 2000,
    totalTokens: 8200,
    outputRatioPct: 2.4,
    estCostUSD: 0.5,
    toolCallCount: 8,
    duplicateReadTokens: 300,
    idleContextTokens: 500,
    label: "",
    ...over,
  };
}

describe("formatTerminal", () => {
  it("renders banner with window + session count + model", () => {
    const w = parseSince("30d", NOW);
    if (!w.ok) throw new Error("setup");
    const pricing = loadPricingForDate(NOW);
    const report = renderStats({
      window: w.value,
      agent: "claude-code",
      sessions: [fixtureSession()],
      topN: 5,
      groupBy: "none",
      pricing,
      pricingAgeDays: 18,
      warnings: [],
    });
    const out = formatTerminal(report, { useColor: false });
    expect(out).toContain("sipcode stats");
    expect(out).toContain("last 30 days");
    expect(out).toContain("1 sessions");
    expect(out).toContain("claude-opus-4");
    expect(out).toContain("trend: token spend per day");
    expect(out).toContain("top 1 most expensive");
    expect(out).toContain("est. total cost:");
  });

  it("does not include ANSI codes when useColor=false", () => {
    const w = parseSince("7d", NOW);
    if (!w.ok) throw new Error("setup");
    const pricing = loadPricingForDate(NOW);
    const report = renderStats({
      window: w.value,
      agent: "claude-code",
      sessions: [fixtureSession()],
      topN: 5,
      groupBy: "none",
      pricing,
      pricingAgeDays: 0,
      warnings: [],
    });
    const out = formatTerminal(report, { useColor: false });
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/\x1b\[/);
  });

  it("shows empty-state message when no sessions", () => {
    const w = parseSince("7d", NOW);
    if (!w.ok) throw new Error("setup");
    const pricing = loadPricingForDate(NOW);
    const report = renderStats({
      window: w.value,
      agent: "claude-code",
      sessions: [],
      topN: 5,
      groupBy: "none",
      pricing,
      pricingAgeDays: 0,
      warnings: [],
    });
    const out = formatTerminal(report, { useColor: false });
    expect(out).toContain("no sessions in this window");
  });

  it("renders per-project totals when group-by=project", () => {
    const w = parseSince("7d", NOW);
    if (!w.ok) throw new Error("setup");
    const pricing = loadPricingForDate(NOW);
    const report = renderStats({
      window: w.value,
      agent: "claude-code",
      sessions: [
        fixtureSession({ projectName: "sipcode", projectHash: "h1" }),
        fixtureSession({
          sessionId: "feedface0",
          sessionIdShort: "feedface",
          projectName: "answerable",
          projectHash: "h2",
        }),
      ],
      topN: 5,
      groupBy: "project",
      pricing,
      pricingAgeDays: 0,
      warnings: [],
    });
    const out = formatTerminal(report, { useColor: false });
    expect(out).toContain("per-project totals:");
    expect(out).toContain("sipcode");
    expect(out).toContain("answerable");
  });

  it("is deterministic — same input → same output", () => {
    const w = parseSince("7d", NOW);
    if (!w.ok) throw new Error("setup");
    const pricing = loadPricingForDate(NOW);
    const ses = [fixtureSession()];
    const r1 = renderStats({
      window: w.value,
      agent: "claude-code",
      sessions: ses,
      topN: 5,
      groupBy: "none",
      pricing,
      pricingAgeDays: 0,
      warnings: [],
    });
    const r2 = renderStats({
      window: w.value,
      agent: "claude-code",
      sessions: ses,
      topN: 5,
      groupBy: "none",
      pricing,
      pricingAgeDays: 0,
      warnings: [],
    });
    expect(formatTerminal(r1, { useColor: false })).toBe(
      formatTerminal(r2, { useColor: false }),
    );
  });
});
