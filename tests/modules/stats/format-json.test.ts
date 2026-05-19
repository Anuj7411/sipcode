import { describe, expect, it } from "vitest";
import { formatJson } from "../../../src/modules/stats/format-json.js";
import { renderStats } from "../../../src/modules/stats/render.js";
import { parseSince } from "../../../src/modules/stats/window.js";
import type { AggregatedSession } from "../../../src/modules/stats/types.js";
import { loadPricingForDate } from "../../../src/lib/pricing/load.js";

const NOW = new Date("2026-05-19T12:00:00.000Z");

function session(): AggregatedSession {
  return {
    sessionId: "feedface00",
    sessionIdShort: "feedface",
    projectHash: "C--Projects-Sipcode",
    projectName: "Sipcode",
    startedAt: "2026-05-18T00:00:00.000Z",
    endedAt: "2026-05-18T00:30:00.000Z",
    durationSec: 1800,
    durationHuman: "30m 00s",
    primaryModel: "claude-opus-4",
    inputTokens: 1234,
    outputTokens: 567,
    cacheReadTokens: 8901,
    cacheCreationTokens: 2345,
    totalTokens: 13047,
    outputRatioPct: 4.3,
    estCostUSD: 1.2345678,
    toolCallCount: 10,
    duplicateReadTokens: 100,
    idleContextTokens: 200,
    label: "",
  };
}

describe("formatJson", () => {
  it("emits a parseable, stable-schema JSON", () => {
    const w = parseSince("7d", NOW);
    if (!w.ok) throw new Error("setup");
    const pricing = loadPricingForDate(NOW);
    const report = renderStats({
      window: w.value,
      agent: "claude-code",
      sessions: [session()],
      topN: 3,
      groupBy: "project",
      pricing,
      pricingAgeDays: 18,
      warnings: [],
    });
    const json = formatJson(report);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe("sipcode-stats/1");
    expect(parsed.sessionCount).toBe(1);
    expect(parsed.totals.totalTokens).toBe(13047);
    expect(parsed.window.raw).toBe("7d");
    expect(parsed.trendDaily.length).toBe(7);
    expect(parsed.topExpensive.length).toBe(1);
    expect(parsed.byProject.length).toBe(1);
    expect(parsed.byProject[0].name).toBe("Sipcode");
    expect(parsed.metaPricing.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is byte-identical across two renders of the same input", () => {
    const w = parseSince("30d", NOW);
    if (!w.ok) throw new Error("setup");
    const pricing = loadPricingForDate(NOW);
    const args = {
      window: w.value,
      agent: "claude-code" as const,
      sessions: [session()],
      topN: 5,
      groupBy: "none" as const,
      pricing,
      pricingAgeDays: 18,
      warnings: [],
    };
    expect(formatJson(renderStats(args))).toBe(formatJson(renderStats(args)));
  });

  it("rounds USD to a stable precision", () => {
    const w = parseSince("7d", NOW);
    if (!w.ok) throw new Error("setup");
    const pricing = loadPricingForDate(NOW);
    const report = renderStats({
      window: w.value,
      agent: "claude-code",
      sessions: [session()],
      topN: 3,
      groupBy: "none",
      pricing,
      pricingAgeDays: 0,
      warnings: [],
    });
    const json = JSON.parse(formatJson(report));
    expect(typeof json.totals.estCostUSD).toBe("number");
    // Round trip should produce <=4 decimal places.
    expect(json.totals.estCostUSD.toString()).toMatch(/^\d+(\.\d{1,4})?$/);
  });
});
