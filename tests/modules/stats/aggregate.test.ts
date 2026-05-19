import { describe, expect, it } from "vitest";
import {
  aggregateSession,
  computeTotals,
  dominantModel,
  humanDuration,
  projectNameFromCwd,
} from "../../../src/modules/stats/aggregate.js";
import type { AggregatedSession } from "../../../src/modules/stats/types.js";

function makeAgg(over: Partial<AggregatedSession> = {}): AggregatedSession {
  return {
    sessionId: "abc12345xyz",
    sessionIdShort: "abc12345",
    projectHash: "C--Projects-Sipcode",
    projectName: "Sipcode",
    startedAt: "2026-05-01T00:00:00.000Z",
    endedAt: "2026-05-01T01:00:00.000Z",
    durationSec: 3600,
    durationHuman: "1h 00m",
    primaryModel: "claude-opus-4",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 200,
    cacheCreationTokens: 150,
    totalTokens: 500,
    outputRatioPct: 10,
    estCostUSD: 1.0,
    toolCallCount: 4,
    duplicateReadTokens: 25,
    idleContextTokens: 75,
    label: "",
    ...over,
  };
}

describe("humanDuration", () => {
  it("formats seconds, minutes, hours", () => {
    expect(humanDuration(0)).toBe("0s");
    expect(humanDuration(45)).toBe("45s");
    expect(humanDuration(90)).toBe("1m 30s");
    expect(humanDuration(3725)).toBe("1h 02m");
  });
});

describe("projectNameFromCwd", () => {
  it("uses cwd basename when available", () => {
    expect(projectNameFromCwd("/home/u/Projects/Foo", "C--Projects-Foo")).toBe(
      "Foo",
    );
  });

  it("normalizes Windows backslashes", () => {
    expect(
      projectNameFromCwd("C:\\Projects\\Sipcode", "C--Projects-Sipcode"),
    ).toBe("Sipcode");
  });

  it("falls back to projectHash tail when cwd is missing", () => {
    expect(projectNameFromCwd(undefined, "abc-def-myproj")).toBe("myproj");
  });
});

describe("aggregateSession", () => {
  it("folds parser + analyzer outputs into a row", () => {
    const agg = aggregateSession({
      sessionId: "feedface00",
      projectHash: "C--Projects-Sipcode",
      fallbackStartedAtMs: new Date("2026-05-01T00:00:00Z").getTime(),
      parsed: {
        sessionId: "feedface00",
        cwd: "/home/u/Projects/Sipcode",
        primaryModel: "claude-opus-4",
        models: new Set(["claude-opus-4"]),
        startedAt: "2026-05-01T00:00:00.000Z",
        endedAt: "2026-05-01T01:00:00.000Z",
        durationSec: 3600,
        assistantTurns: [],
        toolCalls: [],
        userTurnCount: 0,
        linesParsed: 5,
        linesSkipped: 0,
      },
      totals: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 200,
        cacheCreationTokens: 150,
        durationSec: 3600,
        toolCallCount: 4,
        outputRatio: 0.1,
        estCostUSD: 1.5,
        costByModel: [],
        missingAllUsage: false,
      },
      duplicates: {
        distinctFilesRead: 2,
        duplicateReadTokenCost: 25,
        topOffenders: [],
      },
      idle: { idleTokenCost: 75, idleFiles: [] },
    });
    expect(agg.sessionIdShort).toBe("feedface");
    expect(agg.totalTokens).toBe(500);
    expect(agg.outputRatioPct).toBe(10);
    expect(agg.projectName).toBe("Sipcode");
    expect(agg.duplicateReadTokens).toBe(25);
    expect(agg.idleContextTokens).toBe(75);
    expect(agg.durationHuman).toBe("1h 00m");
  });

  it("falls back to mtime when parsed.startedAt is missing", () => {
    const agg = aggregateSession({
      sessionId: "no-ts",
      projectHash: "p",
      fallbackStartedAtMs: new Date("2026-04-15T00:00:00Z").getTime(),
      parsed: {
        sessionId: "no-ts",
        cwd: undefined,
        primaryModel: undefined,
        models: new Set(),
        startedAt: undefined,
        endedAt: undefined,
        durationSec: 0,
        assistantTurns: [],
        toolCalls: [],
        userTurnCount: 0,
        linesParsed: 0,
        linesSkipped: 0,
      },
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        durationSec: 0,
        toolCallCount: 0,
        outputRatio: 0,
        estCostUSD: 0,
        costByModel: [],
        missingAllUsage: true,
      },
      duplicates: {
        distinctFilesRead: 0,
        duplicateReadTokenCost: 0,
        topOffenders: [],
      },
      idle: { idleTokenCost: 0, idleFiles: [] },
    });
    expect(agg.startedAt).toBe("2026-04-15T00:00:00.000Z");
    expect(agg.primaryModel).toBe("(unknown)");
    expect(agg.totalTokens).toBe(0);
  });
});

describe("computeTotals", () => {
  it("sums across sessions and computes output ratio", () => {
    const totals = computeTotals([
      makeAgg({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 50, cacheCreationTokens: 0, totalTokens: 200 }),
      makeAgg({ inputTokens: 200, outputTokens: 50, cacheReadTokens: 50, cacheCreationTokens: 0, totalTokens: 300 }),
    ]);
    expect(totals.inputTokens).toBe(300);
    expect(totals.outputTokens).toBe(100);
    expect(totals.totalTokens).toBe(500);
    expect(totals.outputRatioPct).toBe(20);
  });

  it("returns zero ratio when total is zero", () => {
    const totals = computeTotals([]);
    expect(totals.totalTokens).toBe(0);
    expect(totals.outputRatioPct).toBe(0);
  });
});

describe("dominantModel", () => {
  it("picks the most frequent model", () => {
    expect(
      dominantModel([
        makeAgg({ primaryModel: "claude-opus-4" }),
        makeAgg({ primaryModel: "claude-opus-4" }),
        makeAgg({ primaryModel: "claude-sonnet-4" }),
      ]),
    ).toBe("claude-opus-4");
  });

  it("returns (unknown) on empty", () => {
    expect(dominantModel([])).toBe("(unknown)");
  });
});
