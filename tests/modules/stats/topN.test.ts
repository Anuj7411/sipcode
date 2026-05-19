import { describe, expect, it } from "vitest";
import { topNExpensive } from "../../../src/modules/stats/topN.js";
import type { AggregatedSession } from "../../../src/modules/stats/types.js";

function s(
  id: string,
  tokens: number,
  usd: number,
  startedAt = "2026-05-01T00:00:00.000Z",
): AggregatedSession {
  return {
    sessionId: id,
    sessionIdShort: id.slice(0, 8),
    projectHash: "p",
    projectName: "p",
    startedAt,
    endedAt: startedAt,
    durationSec: 60,
    durationHuman: "1m 00s",
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

describe("topNExpensive", () => {
  it("picks N largest by tokens", () => {
    const out = topNExpensive(
      [s("a", 100, 1), s("b", 300, 3), s("c", 200, 2)],
      2,
    );
    expect(out.map((r) => r.sessionId)).toEqual(["b", "c"]);
  });

  it("returns empty when n=0", () => {
    expect(topNExpensive([s("a", 1, 1)], 0)).toEqual([]);
  });

  it("returns all sessions when n exceeds population", () => {
    expect(topNExpensive([s("a", 1, 1)], 100).length).toBe(1);
  });

  it("breaks ties by USD then most-recent first", () => {
    const out = topNExpensive(
      [
        s("a", 100, 1, "2026-05-01T00:00:00.000Z"),
        s("b", 100, 1, "2026-05-15T00:00:00.000Z"),
      ],
      2,
    );
    expect(out[0]?.sessionId).toBe("b");
  });
});
