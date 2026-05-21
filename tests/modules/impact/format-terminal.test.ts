import { describe, it, expect } from "vitest";
import { formatTerminal } from "../../../src/modules/impact/format-terminal.js";
import { runImpact } from "../../../src/modules/impact/runImpact.js";
import type { AggregatedSession } from "../../../src/modules/stats/types.js";

function mkSession(startedAt: string, tokens: number, cost: number): AggregatedSession {
  const output = Math.floor(tokens * 0.01);
  return {
    sessionId: `s-${startedAt}`,
    sessionIdShort: `s-${startedAt}`.slice(0, 8),
    projectHash: "demo",
    projectName: "demo",
    startedAt,
    endedAt: startedAt,
    durationSec: 600,
    durationHuman: "10m",
    primaryModel: "claude-opus-4-7",
    inputTokens: tokens - output,
    outputTokens: output,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: tokens,
    outputRatioPct: 1.0,
    estCostUSD: cost,
    toolCallCount: 1,
    duplicateReadTokens: 0,
    idleContextTokens: 0,
    label: "",
  };
}

describe("formatTerminal", () => {
  it("renders the table block in the measured case", () => {
    const report = runImpact({
      sessions: [
        mkSession("2026-04-01T00:00:00.000Z", 100_000, 1.0),
        mkSession("2026-05-15T00:00:00.000Z", 25_000, 0.25),
      ],
      installedAtIso: "2026-05-01T00:00:00.000Z",
      markerSource: "install-state.json (rules)",
      nowIso: "2026-05-22T00:00:00.000Z",
    });
    const out = formatTerminal(report);
    expect(out).toContain("BEFORE");
    expect(out).toContain("AFTER");
    expect(out).toContain("total spend");
    expect(out).toContain("$1.00");
    expect(out).toContain("$0.25");
    expect(out).toContain("pivot: 2026-05-01");
  });

  it("suppresses the table block in the no-install-marker case", () => {
    const report = runImpact({
      sessions: [],
      installedAtIso: null,
      markerSource: "none",
      nowIso: "2026-05-22T00:00:00.000Z",
    });
    const out = formatTerminal(report);
    expect(out).not.toContain("BEFORE");
    expect(out).toContain("no install marker");
  });

  it("is deterministic for the same report", () => {
    const sessions = [
      mkSession("2026-04-01T00:00:00.000Z", 100_000, 1.0),
      mkSession("2026-05-15T00:00:00.000Z", 25_000, 0.25),
    ];
    const r1 = runImpact({
      sessions,
      installedAtIso: "2026-05-01T00:00:00.000Z",
      markerSource: "install-state.json (rules)",
      nowIso: "2026-05-22T00:00:00.000Z",
    });
    const r2 = runImpact({
      sessions,
      installedAtIso: "2026-05-01T00:00:00.000Z",
      markerSource: "install-state.json (rules)",
      nowIso: "2026-05-22T00:00:00.000Z",
    });
    expect(formatTerminal(r1)).toBe(formatTerminal(r2));
  });
});
