import { describe, expect, it } from "vitest";
import { dedupeAcrossSessions } from "../../../src/modules/transcript/dedupe.js";
import type { AssistantTurn, ParsedSession, ToolCall } from "../../../src/modules/transcript/parse.js";

function call(name: string, turn: number): ToolCall {
  return { name, input: {}, assistantTurnIndex: turn, timestamp: undefined, inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, resultTokens: 10 };
}
function turn(index: number, key: string | undefined, tools: string[] = []): AssistantTurn {
  return { index, model: "claude-opus-5", timestamp: undefined, inputTokens: 1, outputTokens: 1,
    cacheReadTokens: 100, cacheCreationTokens: 0, cacheCreation1hTokens: 0,
    toolCalls: tools.map((t) => call(t, index)), missingUsage: false, requestKey: key };
}
function session(id: string, startedAt: string, turns: AssistantTurn[]): ParsedSession {
  return { sessionId: id, cwd: "/p", primaryModel: "claude-opus-5", models: new Set(["claude-opus-5"]),
    startedAt, endedAt: startedAt, durationSec: 0, assistantTurns: turns,
    toolCalls: turns.flatMap((t) => t.toolCalls), userTurnCount: 1, linesParsed: 1, linesSkipped: 0 };
}

describe("dedupeAcrossSessions", () => {
  it("drops requests repeated in a later file (resumed session) and keeps the original", () => {
    const original = session("a", "2026-09-01T10:00:00Z", [turn(0, "k1"), turn(1, "k2")]);
    const resumed = session("b", "2026-09-01T12:00:00Z", [turn(0, "k1"), turn(1, "k2"), turn(2, "k3")]);
    const r = dedupeAcrossSessions([resumed, original]);
    expect(r.droppedRequests).toBe(2);
    const byId = new Map(r.sessions.map((s) => [s.sessionId, s]));
    expect(byId.get("a")!.assistantTurns.map((t) => t.requestKey)).toEqual(["k1", "k2"]);
    expect(byId.get("b")!.assistantTurns.map((t) => t.requestKey)).toEqual(["k3"]);
  });

  it("sorts undated sessions last so they never claim a dated session's requests", () => {
    const undated = { ...session("u", "2026-09-01T10:00:00Z", [turn(0, "k1")]), startedAt: undefined };
    const dated = session("d", "2026-09-03T10:00:00Z", [turn(0, "k1")]);
    const r = dedupeAcrossSessions([undated, dated]);
    expect(r.droppedRequests).toBe(1);
    expect(r.sessions[0]!.assistantTurns).toHaveLength(0);
    expect(r.sessions[1]!.assistantTurns).toHaveLength(1);
  });

  it("treats equivalent timestamp spellings as the same instant (tie keeps input order)", () => {
    const first = session("x", "2026-09-01T10:00:00Z", [turn(0, "k1")]);
    const second = session("y", "2026-09-01T10:00:00.000Z", [turn(0, "k1")]);
    const r = dedupeAcrossSessions([first, second]);
    expect(r.sessions[0]!.assistantTurns).toHaveLength(1);
    expect(r.sessions[1]!.assistantTurns).toHaveLength(0);
    const flipped = dedupeAcrossSessions([second, first]);
    expect(flipped.sessions[0]!.assistantTurns).toHaveLength(1);
    expect(flipped.sessions[1]!.assistantTurns).toHaveLength(0);
  });

  it("keeps turns that have no request key", () => {
    const s1 = session("a", "2026-09-01T10:00:00Z", [turn(0, undefined)]);
    const s2 = session("b", "2026-09-02T10:00:00Z", [turn(0, undefined)]);
    expect(dedupeAcrossSessions([s1, s2]).droppedRequests).toBe(0);
  });

  it("drops the tool calls of dropped turns and re-indexes the rest", () => {
    const s1 = session("a", "2026-09-01T10:00:00Z", [turn(0, "k1", ["Read"])]);
    const s2 = session("b", "2026-09-02T10:00:00Z", [turn(0, "k1", ["Read"]), turn(1, "k2", ["Bash"])]);
    const out = dedupeAcrossSessions([s1, s2]).sessions[1]!;
    expect(out.assistantTurns.map((t) => t.index)).toEqual([0]);
    expect(out.toolCalls.map((c) => [c.name, c.assistantTurnIndex])).toEqual([["Bash", 0]]);
  });

  it("returns sessions in the input order", () => {
    const s1 = session("late", "2026-09-05T10:00:00Z", [turn(0, "k1")]);
    const s2 = session("early", "2026-09-01T10:00:00Z", [turn(0, "k1")]);
    const r = dedupeAcrossSessions([s1, s2]);
    expect(r.sessions.map((s) => s.sessionId)).toEqual(["late", "early"]);
    expect(r.sessions[0]!.assistantTurns).toHaveLength(0);
    expect(r.sessions[1]!.assistantTurns).toHaveLength(1);
  });

  it("does not mutate its input", () => {
    const s1 = session("a", "2026-09-01T10:00:00Z", [turn(0, "k1")]);
    const s2 = session("b", "2026-09-02T10:00:00Z", [turn(0, "k1"), turn(1, "k2")]);
    dedupeAcrossSessions([s1, s2]);
    expect(s2.assistantTurns).toHaveLength(2);
  });
});
