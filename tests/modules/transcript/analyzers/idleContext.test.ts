import { describe, expect, it } from "vitest";
import type { ParsedSession, ToolCall } from "../../../../src/modules/transcript/parse.js";
import { analyzeIdleContext } from "../../../../src/modules/transcript/analyzers/idleContext.js";

function makeCall(name: string, turn: number, filePath: string): ToolCall {
  return {
    name,
    input: { file_path: filePath },
    assistantTurnIndex: turn,
    timestamp: undefined,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 500,
    cacheCreationTokens: 0,
    totalTokens: 650,
  };
}

function makeSession(toolCalls: ToolCall[], turnCount: number): ParsedSession {
  const turns = Array.from({ length: turnCount }, (_unused, i) => ({
    index: i,
    model: "claude-sonnet-4",
    timestamp: undefined,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    toolCalls: [] as ToolCall[],
    missingUsage: false,
  }));
  return {
    sessionId: "test",
    cwd: undefined,
    primaryModel: "claude-sonnet-4",
    models: new Set(["claude-sonnet-4"]),
    startedAt: undefined,
    endedAt: undefined,
    durationSec: 0,
    assistantTurns: turns,
    toolCalls,
    userTurnCount: 0,
    linesParsed: turnCount,
    linesSkipped: 0,
  };
}

describe("analyzeIdleContext", () => {
  it("flags files read once and never re-referenced for 5+ turns", () => {
    // Read at turn 0, session has 10 turns → idle for 10 turns.
    const session = makeSession(
      [makeCall("Read", 0, "/proj/x.ts")],
      10,
    );
    const res = analyzeIdleContext(session);
    expect(res.idleFiles.length).toBe(1);
    expect(res.idleFiles[0]?.idleTurns).toBeGreaterThanOrEqual(5);
    expect(res.idleTokenCost).toBeGreaterThan(0);
  });

  it("does not flag files referenced again recently", () => {
    const session = makeSession(
      [
        makeCall("Read", 0, "/proj/x.ts"),
        makeCall("Edit", 8, "/proj/x.ts"),
      ],
      10,
    );
    const res = analyzeIdleContext(session);
    expect(res.idleFiles.length).toBe(0);
  });

  it("returns empty for sessions with no reads", () => {
    const session = makeSession([], 5);
    expect(analyzeIdleContext(session).idleFiles.length).toBe(0);
  });
});
