import { describe, expect, it } from "vitest";
import { dedupeAcrossSessions } from "../../../src/modules/transcript/dedupe.js";
import type { AssistantTurn, ParsedSession, ToolCall } from "../../../src/modules/transcript/parse.js";

function call(name: string, turn: number): ToolCall {
  return { name, input: {}, assistantTurnIndex: turn, timestamp: undefined, inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, resultTokens: 10 };
}
function turn(
  index: number,
  key: string | undefined,
  tools: string[] = [],
  extra: Partial<AssistantTurn> = {},
): AssistantTurn {
  return { index, model: "claude-opus-5", timestamp: undefined, inputTokens: 1, outputTokens: 1,
    cacheReadTokens: 100, cacheCreationTokens: 0, cacheCreation1hTokens: 0,
    toolCalls: tools.map((t) => call(t, index)), missingUsage: false, requestKey: key, ...extra };
}
function readTurn(index: number, key: string, filePath: string): AssistantTurn {
  const c: ToolCall = { ...call("Read", index), input: { file_path: filePath } };
  return { ...turn(index, key), toolCalls: [c] };
}
function withTimes(s: ParsedSession, startedAt: string | undefined, endedAt: string | undefined): ParsedSession {
  return { ...s, startedAt, endedAt };
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
    const s2 = session("b", "2026-09-02T10:00:00Z", [turn(0, "k1", ["Read"]), turn(1, "k2", ["Bash"])]);
    dedupeAcrossSessions([s1, s2]);
    expect(s2.assistantTurns).toHaveLength(2);
    expect(s2.assistantTurns.map((t) => t.index)).toEqual([0, 1]);
    expect(s2.assistantTurns[1]!.toolCalls[0]!.assistantTurnIndex).toBe(1);
    expect(s2.toolCalls).toHaveLength(2);
    expect(s2.toolCalls[1]!.assistantTurnIndex).toBe(1);
    expect(s2.priorReads).toBeUndefined();
  });

  it("with equal startedAt the earlier-ending parent keeps the shared requests even when the superset comes first", () => {
    const a = withTimes(session("a", "x", [turn(0, "k1"), turn(1, "k2")]), "2026-09-01T10:00:00Z", "2026-09-01T10:30:00Z");
    const b = withTimes(session("b", "x", [turn(0, "k1"), turn(1, "k2"), turn(2, "k3")]), "2026-09-01T10:00:00Z", "2026-09-01T12:00:00Z");
    const r = dedupeAcrossSessions([b, a]);
    expect(r.droppedRequests).toBe(2);
    expect(r.sessions[1]!.assistantTurns.map((t) => t.requestKey)).toEqual(["k1", "k2"]);
    expect(r.sessions[0]!.assistantTurns.map((t) => t.requestKey)).toEqual(["k3"]);
  });

  it("breaks startedAt and endedAt ties by fewer turns", () => {
    const small = withTimes(session("s", "x", [turn(0, "k1")]), "2026-09-01T10:00:00Z", "2026-09-01T10:00:00Z");
    const big = withTimes(session("g", "x", [turn(0, "k1"), turn(1, "k2")]), "2026-09-01T10:00:00Z", "2026-09-01T10:00:00Z");
    const r = dedupeAcrossSessions([big, small]);
    expect(r.sessions[1]!.assistantTurns.map((t) => t.requestKey)).toEqual(["k1"]);
    expect(r.sessions[0]!.assistantTurns.map((t) => t.requestKey)).toEqual(["k2"]);
  });

  it("handles a three-file resume chain", () => {
    const a = withTimes(session("a", "x", [turn(0, "k1")]), "2026-09-01T10:00:00Z", "2026-09-01T10:10:00Z");
    const b = withTimes(session("b", "x", [turn(0, "k1"), turn(1, "k2")]), "2026-09-01T10:00:00Z", "2026-09-01T11:00:00Z");
    const c = withTimes(session("c", "x", [turn(0, "k1"), turn(1, "k2"), turn(2, "k3")]), "2026-09-01T10:00:00Z", "2026-09-01T12:00:00Z");
    const r = dedupeAcrossSessions([c, b, a]);
    expect(r.droppedRequests).toBe(3);
    const keys = (id: string) => r.sessions.find((s) => s.sessionId === id)!.assistantTurns.map((t) => t.requestKey);
    expect(keys("a")).toEqual(["k1"]);
    expect(keys("b")).toEqual(["k2"]);
    expect(keys("c")).toEqual(["k3"]);
  });

  it("recomputes startedAt, endedAt and durationSec from the kept turns", () => {
    const a = session("a", "2026-09-01T10:00:00Z", [turn(0, "k1", [], { timestamp: "2026-09-01T10:00:00Z" })]);
    const b: ParsedSession = {
      ...session("b", "2026-09-01T10:00:00Z", [
        turn(0, "k1", [], { timestamp: "2026-09-01T10:00:00Z" }),
        turn(1, "k2", [], { timestamp: "2026-09-05T09:00:00Z" }),
        turn(2, "k3", [], { timestamp: "2026-09-05T09:01:30Z" }),
      ]),
      endedAt: "2026-09-05T09:01:30Z",
      durationSec: 999_999,
    };
    const out = dedupeAcrossSessions([a, b]).sessions[1]!;
    expect(out.startedAt).toBe("2026-09-05T09:00:00Z");
    expect(out.endedAt).toBe("2026-09-05T09:01:30Z");
    expect(out.durationSec).toBe(90);
  });

  it("keeps the original times when no kept turn has a timestamp", () => {
    const a = session("a", "2026-09-01T10:00:00Z", [turn(0, "k1")]);
    const b: ParsedSession = { ...session("b", "2026-09-02T10:00:00Z", [turn(0, "k1"), turn(1, "k2")]), durationSec: 42 };
    const out = dedupeAcrossSessions([a, b]).sessions[1]!;
    expect(out.startedAt).toBe("2026-09-02T10:00:00Z");
    expect(out.durationSec).toBe(42);
  });

  it("records files read in dropped turns as priorReads (normalised)", () => {
    const a = session("a", "2026-09-01T10:00:00Z", [readTurn(0, "k1", "C:\\p\\a.ts")]);
    const b = session("b", "2026-09-02T10:00:00Z", [readTurn(0, "k1", "C:\\p\\a.ts"), turn(1, "k2", ["Bash"])]);
    const out = dedupeAcrossSessions([a, b]).sessions[1]!;
    expect([...out.priorReads!]).toEqual(["c:/p/a.ts"]);
  });

  it("recomputes models and primaryModel when dropped turns used another model", () => {
    const a = session("a", "2026-09-01T10:00:00Z", [turn(0, "k1", [], { model: "claude-sonnet-5" })]);
    const b = session("b", "2026-09-02T10:00:00Z", [
      turn(0, "k1", [], { model: "claude-sonnet-5" }),
      turn(1, "k2", [], { model: "claude-opus-5" }),
    ]);
    const out = dedupeAcrossSessions([a, b]).sessions[1]!;
    expect([...out.models]).toEqual(["claude-opus-5"]);
    expect(out.primaryModel).toBe("claude-opus-5");
  });

  it("leaves a session with 0 turns when every turn is a repeat", () => {
    const a = session("a", "2026-09-01T10:00:00Z", [turn(0, "k1"), turn(1, "k2")]);
    const b = session("b", "2026-09-02T10:00:00Z", [turn(0, "k1"), turn(1, "k2")]);
    const out = dedupeAcrossSessions([a, b]).sessions[1]!;
    expect(out.assistantTurns).toHaveLength(0);
    expect(out.toolCalls).toHaveLength(0);
    expect(out.primaryModel).toBeUndefined();
  });
  describe("order-independent usage across copies", () => {
    const zeroed = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
    const real = { inputTokens: 5, outputTokens: 7, cacheReadTokens: 900, cacheCreationTokens: 40, cacheCreation1hTokens: 30 };

    it("the winning copy carries the largest usage even when it was logged zeroed", () => {
      // "a" starts first, so it wins the tie-break, but its copy of k1 has zeroed usage.
      const a = session("a", "2026-09-01T10:00:00Z", [turn(0, "k1", ["Read"], zeroed)]);
      const b = session("b", "2026-09-01T10:00:00Z", [turn(0, "k1", ["Read"], real), turn(1, "k2")]);
      for (const input of [[a, b], [b, a]]) {
        const r = dedupeAcrossSessions(input);
        const winner = r.sessions[input.indexOf(a)]!;
        const kept = winner.assistantTurns[0]!;
        expect(kept.inputTokens).toBe(5);
        expect(kept.outputTokens).toBe(7);
        expect(kept.cacheReadTokens).toBe(900);
        expect(kept.cacheCreationTokens).toBe(40);
        expect(kept.cacheCreation1hTokens).toBe(30);
        const c = kept.toolCalls[0]!;
        expect([c.inputTokens, c.outputTokens, c.cacheReadTokens, c.cacheCreationTokens]).toEqual([5, 7, 900, 40]);
        expect(c.totalTokens).toBe(952);
        expect(winner.toolCalls[0]).toBe(c);
        expect(r.droppedRequests).toBe(1);
      }
    });

    it("does not mutate the input session", () => {
      const a = session("a", "2026-09-01T10:00:00Z", [turn(0, "k1", [], zeroed)]);
      const b = session("b", "2026-09-02T10:00:00Z", [turn(0, "k1", [], real)]);
      dedupeAcrossSessions([a, b]);
      expect(a.assistantTurns[0]!.cacheReadTokens).toBe(0);
    });

    it("returns an unchanged session as the same object (no allocation)", () => {
      const a = session("a", "2026-09-01T10:00:00Z", [turn(0, "k1"), turn(1, "k2")]);
      const b = session("b", "2026-09-02T10:00:00Z", [turn(0, "k3")]);
      const r = dedupeAcrossSessions([a, b]);
      expect(r.sessions[0]).toBe(a);
      expect(r.sessions[1]).toBe(b);
    });

    it("keeps a copy that already holds the maximum as-is (same object)", () => {
      const a = session("a", "2026-09-01T10:00:00Z", [turn(0, "k1", [], real)]);
      const b = session("b", "2026-09-02T10:00:00Z", [turn(0, "k1", [], zeroed), turn(1, "k2")]);
      const r = dedupeAcrossSessions([a, b]);
      expect(r.sessions[0]).toBe(a);
    });
  });
});
