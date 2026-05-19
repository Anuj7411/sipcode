import { describe, expect, it } from "vitest";
import { groupByProject } from "../../../src/modules/stats/projects.js";
import type { AggregatedSession } from "../../../src/modules/stats/types.js";

function agg(
  project: string,
  hash: string,
  tokens: number,
  usd: number,
): AggregatedSession {
  return {
    sessionId: `s-${project}-${tokens}`,
    sessionIdShort: project.slice(0, 8),
    projectHash: hash,
    projectName: project,
    startedAt: "2026-05-01T00:00:00.000Z",
    endedAt: "2026-05-01T01:00:00.000Z",
    durationSec: 3600,
    durationHuman: "1h 00m",
    primaryModel: "claude-opus-4",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: tokens,
    outputRatioPct: 0,
    estCostUSD: usd,
    toolCallCount: 0,
    duplicateReadTokens: 0,
    idleContextTokens: 0,
    label: "",
  };
}

describe("groupByProject", () => {
  it("groups by hash and computes spend share", () => {
    const groups = groupByProject([
      agg("sipcode", "h1", 100, 10),
      agg("sipcode", "h1", 200, 20),
      agg("answerable", "h2", 50, 5),
    ]);
    expect(groups.length).toBe(2);
    expect(groups[0]?.name).toBe("sipcode");
    expect(groups[0]?.sessionCount).toBe(2);
    expect(groups[0]?.tokens).toBe(300);
    expect(groups[0]?.estCostUSD).toBe(30);
    expect(groups[0]?.pctOfSpend).toBeCloseTo(85.7, 0);
    expect(groups[1]?.name).toBe("answerable");
  });

  it("returns empty array on empty input", () => {
    expect(groupByProject([])).toEqual([]);
  });

  it("yields stable ordering on tied USD", () => {
    const groups = groupByProject([
      agg("b", "hB", 100, 5),
      agg("a", "hA", 100, 5),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["a", "b"]);
  });
});
