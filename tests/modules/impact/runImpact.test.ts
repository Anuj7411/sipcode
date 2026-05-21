import { describe, it, expect } from "vitest";
import { runImpact } from "../../../src/modules/impact/runImpact.js";
import type { AggregatedSession } from "../../../src/modules/stats/types.js";

function mkSession(opts: {
  startedAt: string;
  totalTokens: number;
  estCostUSD: number;
  outputTokens?: number;
}): AggregatedSession {
  const output = opts.outputTokens ?? Math.floor(opts.totalTokens * 0.01);
  const input = opts.totalTokens - output;
  return {
    sessionId: `s-${opts.startedAt}`,
    sessionIdShort: `s-${opts.startedAt}`.slice(0, 8),
    projectHash: "demo",
    projectName: "demo",
    startedAt: opts.startedAt,
    endedAt: opts.startedAt,
    durationSec: 600,
    durationHuman: "10m",
    primaryModel: "claude-opus-4-7",
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: opts.totalTokens,
    outputRatioPct: Math.round((output / opts.totalTokens) * 1000) / 10,
    estCostUSD: opts.estCostUSD,
    toolCallCount: 1,
    duplicateReadTokens: 0,
    idleContextTokens: 0,
    label: "",
  };
}

describe("runImpact", () => {
  it("returns 'no-install-marker' when installedAtIso is null", () => {
    const report = runImpact({
      sessions: [],
      installedAtIso: null,
      markerSource: "none",
      nowIso: "2026-05-22T00:00:00.000Z",
    });
    expect(report.status).toBe("no-install-marker");
    expect(report.installedAtIso).toBeNull();
  });

  it("returns 'insufficient-post-data' when install was less than minPostDays ago", () => {
    const now = "2026-05-22T00:00:00.000Z";
    const yesterday = "2026-05-21T00:00:00.000Z";
    const report = runImpact({
      sessions: [
        mkSession({ startedAt: "2026-05-01T00:00:00.000Z", totalTokens: 100_000, estCostUSD: 1.0 }),
        mkSession({ startedAt: yesterday, totalTokens: 50_000, estCostUSD: 0.5 }),
      ],
      installedAtIso: yesterday,
      markerSource: "install-state.json (rules)",
      nowIso: now,
      minPostDays: 3,
    });
    expect(report.status).toBe("insufficient-post-data");
  });

  it("returns 'no-baseline' when all sessions are after the pivot", () => {
    const report = runImpact({
      sessions: [
        mkSession({ startedAt: "2026-05-15T00:00:00.000Z", totalTokens: 10_000, estCostUSD: 0.1 }),
        mkSession({ startedAt: "2026-05-16T00:00:00.000Z", totalTokens: 10_000, estCostUSD: 0.1 }),
      ],
      installedAtIso: "2026-05-10T00:00:00.000Z",
      markerSource: "install-state.json (rules)",
      nowIso: "2026-05-22T00:00:00.000Z",
    });
    expect(report.status).toBe("no-baseline");
  });

  it("returns 'no-post-sessions' when all sessions are before the pivot", () => {
    const report = runImpact({
      sessions: [
        mkSession({ startedAt: "2026-04-01T00:00:00.000Z", totalTokens: 50_000, estCostUSD: 0.5 }),
        mkSession({ startedAt: "2026-04-02T00:00:00.000Z", totalTokens: 50_000, estCostUSD: 0.5 }),
      ],
      installedAtIso: "2026-05-01T00:00:00.000Z",
      markerSource: "install-state.json (rules)",
      nowIso: "2026-05-22T00:00:00.000Z",
    });
    expect(report.status).toBe("no-post-sessions");
  });

  it("computes correct before/after deltas in the measured case", () => {
    // Before: 2 sessions, 100K + 100K tokens, $1 + $1 = $2 total, avg $1.
    // After: 2 sessions, 25K + 25K tokens, $0.25 + $0.25 = $0.50 total, avg $0.25.
    // Delta: -$1.50 (75% cost reduction), -150K tokens (75% reduction).
    const report = runImpact({
      sessions: [
        mkSession({ startedAt: "2026-04-01T00:00:00.000Z", totalTokens: 100_000, estCostUSD: 1.0 }),
        mkSession({ startedAt: "2026-04-15T00:00:00.000Z", totalTokens: 100_000, estCostUSD: 1.0 }),
        mkSession({ startedAt: "2026-05-10T00:00:00.000Z", totalTokens: 25_000, estCostUSD: 0.25 }),
        mkSession({ startedAt: "2026-05-15T00:00:00.000Z", totalTokens: 25_000, estCostUSD: 0.25 }),
      ],
      installedAtIso: "2026-05-01T00:00:00.000Z",
      markerSource: "install-state.json (rules)",
      nowIso: "2026-05-22T00:00:00.000Z",
    });
    expect(report.status).toBe("measured");
    expect(report.before.sessionCount).toBe(2);
    expect(report.after.sessionCount).toBe(2);
    expect(report.before.estCostUSD).toBeCloseTo(2.0, 2);
    expect(report.after.estCostUSD).toBeCloseTo(0.5, 2);
    expect(report.delta.costDeltaAbsUSD).toBeCloseTo(-1.5, 2);
    expect(report.delta.costDeltaPct).toBe(-75);
    expect(report.delta.tokenDeltaAbs).toBe(-150_000);
    expect(report.delta.tokenDeltaPct).toBe(-75);
  });

  it("emits a meaningful headline in the measured case (tokens leading, $ secondary)", () => {
    const report = runImpact({
      sessions: [
        mkSession({ startedAt: "2026-04-01T00:00:00.000Z", totalTokens: 100_000, estCostUSD: 1.0 }),
        mkSession({ startedAt: "2026-05-15T00:00:00.000Z", totalTokens: 25_000, estCostUSD: 0.25 }),
      ],
      installedAtIso: "2026-05-01T00:00:00.000Z",
      markerSource: "--since flag",
      nowIso: "2026-05-22T00:00:00.000Z",
    });
    expect(report.headline).toMatch(/saved 75\.0K tokens/);
    expect(report.headline).toMatch(/75\.0%/);
    expect(report.headline).toMatch(/about \$0\.75/);
  });

  it("schema version is stable", () => {
    const report = runImpact({
      sessions: [],
      installedAtIso: null,
      markerSource: "none",
      nowIso: "2026-05-22T00:00:00.000Z",
    });
    expect(report.schemaVersion).toBe("sipcode-impact/1");
  });

  it("output ratio delta surfaces the improvement", () => {
    const report = runImpact({
      sessions: [
        // before: 1% output ratio
        mkSession({ startedAt: "2026-04-01T00:00:00.000Z", totalTokens: 100_000, estCostUSD: 1.0, outputTokens: 1_000 }),
        // after: 5% output ratio
        mkSession({ startedAt: "2026-05-15T00:00:00.000Z", totalTokens: 20_000, estCostUSD: 0.25, outputTokens: 1_000 }),
      ],
      installedAtIso: "2026-05-01T00:00:00.000Z",
      markerSource: "install-state.json (rules)",
      nowIso: "2026-05-22T00:00:00.000Z",
    });
    expect(report.before.outputRatioPct).toBeCloseTo(1.0, 1);
    expect(report.after.outputRatioPct).toBeCloseTo(5.0, 1);
    expect(report.delta.outputRatioDeltaPp).toBeCloseTo(4.0, 1);
  });
});
