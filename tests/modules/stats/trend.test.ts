import { describe, expect, it } from "vitest";
import { buildTrend } from "../../../src/modules/stats/trend.js";
import { parseSince } from "../../../src/modules/stats/window.js";
import type { AggregatedSession } from "../../../src/modules/stats/types.js";

const NOW = new Date("2026-05-19T12:00:00.000Z");

function agg(date: string, tokens: number): AggregatedSession {
  return {
    sessionId: `s-${date}`,
    sessionIdShort: date.slice(0, 8),
    projectHash: "p",
    projectName: "p",
    startedAt: `${date}T10:00:00.000Z`,
    endedAt: `${date}T11:00:00.000Z`,
    durationSec: 3600,
    durationHuman: "1h 00m",
    primaryModel: "claude-opus-4",
    inputTokens: tokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: tokens,
    outputRatioPct: 0,
    estCostUSD: tokens * 0.001,
    toolCallCount: 1,
    duplicateReadTokens: 0,
    idleContextTokens: 0,
    label: "",
  };
}

describe("buildTrend", () => {
  it("buckets sessions per UTC day", () => {
    const w = parseSince("7d", NOW);
    if (!w.ok) throw new Error("setup");
    const trend = buildTrend(
      [agg("2026-05-19", 100), agg("2026-05-19", 200), agg("2026-05-17", 50)],
      w.value,
    );
    expect(trend.length).toBe(7);
    const may19 = trend.find((d) => d.date === "2026-05-19")!;
    const may17 = trend.find((d) => d.date === "2026-05-17")!;
    const may18 = trend.find((d) => d.date === "2026-05-18")!;
    expect(may19.tokens).toBe(300);
    expect(may19.sessions).toBe(2);
    expect(may17.tokens).toBe(50);
    expect(may17.sessions).toBe(1);
    expect(may18.tokens).toBe(0);
    expect(may18.sessions).toBe(0);
  });

  it("emits a zero entry for days with no sessions", () => {
    const w = parseSince("3d", NOW);
    if (!w.ok) throw new Error("setup");
    const trend = buildTrend([], w.value);
    expect(trend.length).toBe(3);
    expect(trend.every((d) => d.tokens === 0)).toBe(true);
  });

  it("is sorted ascending by date", () => {
    const w = parseSince("5d", NOW);
    if (!w.ok) throw new Error("setup");
    const trend = buildTrend([], w.value);
    const dates = trend.map((d) => d.date);
    expect(dates).toEqual([...dates].sort());
  });
});
