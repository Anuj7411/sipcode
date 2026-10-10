/**
 * DedupeIndex (the streaming form of cross-file dedupe) against an
 * independent copy of the in-memory rule (dedupe-oracle.ts), on random
 * sessions built to collide: shared keys, repeats inside a file, equal and
 * missing timestamps, usage that differs between copies, keyless turns.
 */
import { describe, expect, it } from "vitest";
import { dedupeAcrossSessions, DedupeIndex } from "../../../src/modules/transcript/dedupe.js";
import type { AssistantTurn, ParsedSession, ToolCall } from "../../../src/modules/transcript/parse.js";
import { oracleDedupe } from "./dedupe-oracle.js";

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TIMES = [undefined, "2026-09-01T10:00:00Z", "2026-09-01T10:00:00.000Z", "2026-09-01T11:00:00Z", "2026-09-02T10:00:00Z", "not a date"];

function randomSessions(seed: number): ParsedSession[] {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const n = 1 + Math.floor(r() * 6);
  const keyPool = Array.from({ length: 1 + Math.floor(r() * 8) }, (_, i) => `k${i}`);
  return Array.from({ length: n }, (_, si) => {
    const turnCount = Math.floor(r() * 7);
    const turns: AssistantTurn[] = Array.from({ length: turnCount }, (_, ti) => {
      const key = r() < 0.15 ? undefined : pick(keyPool);
      const reads = r() < 0.5 ? [`/w/f${Math.floor(r() * 3)}.ts`] : [];
      const toolCalls: ToolCall[] = reads.map((p) => ({
        name: "Read",
        input: { file_path: p },
        assistantTurnIndex: ti,
        timestamp: undefined,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 0,
        resultTokens: 5,
      }));
      const u = () => Math.floor(r() * 4);
      return {
        index: ti,
        model: pick(["claude-opus-5", "claude-sonnet-5", undefined]),
        timestamp: pick(TIMES),
        inputTokens: u(),
        outputTokens: u(),
        cacheReadTokens: u(),
        cacheCreationTokens: u(),
        cacheCreation1hTokens: u(),
        toolCalls,
        missingUsage: r() < 0.2,
        requestKey: key,
      };
    });
    return {
      sessionId: `s${si}`,
      cwd: "/p",
      primaryModel: "claude-opus-5",
      models: new Set(["claude-opus-5"]),
      startedAt: pick(TIMES),
      endedAt: pick(TIMES),
      durationSec: 7,
      assistantTurns: turns,
      toolCalls: turns.flatMap((t) => t.toolCalls),
      userTurnCount: 1,
      linesParsed: 1,
      linesSkipped: 0,
      ...(r() < 0.2 ? { priorReads: new Set(["/w/old.ts"]) } : {}),
    };
  });
}

describe("DedupeIndex", () => {
  it("dedupeAcrossSessions gives exactly the oracle's sessions, identities and drop count (2,000 random cases)", () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const input = randomSessions(seed);
      const want = oracleDedupe(input);
      const got = dedupeAcrossSessions(input);
      expect(got.droppedRequests, `seed ${seed}`).toBe(want.droppedRequests);
      expect(got.sessions, `seed ${seed}`).toEqual(want.sessions);
      // A session the oracle leaves alone is returned as the same object.
      got.sessions.forEach((s, i) => expect(s === input[i], `seed ${seed} #${i}`).toBe(want.sessions[i] === input[i]));
    }
  });

  it("changed(i) is true exactly for the sessions dedupe rewrites", () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const input = randomSessions(seed);
      const want = oracleDedupe(input);
      const ix = new DedupeIndex(input.length);
      input.forEach((s, i) => ix.add(i, s));
      input.forEach((s, i) => expect(ix.changed(i), `seed ${seed} #${i}`).toBe(want.sessions[i] !== s));
    }
  });

  it("sessions added in any order, and claimers added by keys only, give the oracle's result over zero-usage stubs", () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const input = randomSessions(seed);
      // Every other session is a claimer: only its keys, time span and turn count take part.
      const stub = (s: ParsedSession): ParsedSession => ({
        ...s,
        assistantTurns: s.assistantTurns.map((t) => ({
          ...t,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cacheCreation1hTokens: 0,
          toolCalls: [],
          missingUsage: true,
        })),
      });
      const claim = (i: number) => i % 2 === 1;
      const oracleInput = input.map((s, i) => (claim(i) ? stub(s) : s));
      const want = oracleDedupe(oracleInput);
      const ix = new DedupeIndex(input.length);
      const order = input.map((_, i) => i).reverse();
      for (const i of order) {
        const s = input[i]!;
        if (!claim(i)) ix.add(i, s);
        else {
          const keys: string[] = [];
          const seen = new Set<string>();
          let keyless = 0;
          for (const t of s.assistantTurns) {
            if (t.requestKey === undefined) keyless++;
            else if (!seen.has(t.requestKey)) {
              seen.add(t.requestKey);
              keys.push(t.requestKey);
            }
          }
          void keyless;
          // Repeats inside a claimer claim nothing more; its turn count still orders it.
          ix.addKeys(i, { startedAt: s.startedAt, endedAt: s.endedAt, turns: s.assistantTurns.length }, keys);
        }
      }
      input.forEach((s, i) => {
        if (claim(i)) return;
        expect(ix.apply(i, s).session, `seed ${seed} #${i}`).toEqual(want.sessions[i]);
      });
    }
  });

  it("a session settled right after it is added keeps its result exactly while isSettled (random order, claimers interleaved)", () => {
    let unsettledSeen = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const input = randomSessions(seed);
      const want = oracleDedupe(input);
      const r = rng(seed * 7919);
      const order = input.map((_, i) => i).sort(() => r() - 0.5);
      const ix = new DedupeIndex(input.length);
      const early = new Map<number, ParsedSession>();
      for (const i of order) {
        ix.add(i, input[i]!);
        early.set(i, ix.apply(i, input[i]!).session);
        ix.settle(i);
      }
      input.forEach((s, i) => {
        const final = ix.apply(i, s).session;
        expect(final, `seed ${seed} #${i}`).toEqual(want.sessions[i]);
        if (ix.isSettled(i)) expect(early.get(i), `seed ${seed} #${i} settled`).toEqual(want.sessions[i]);
        else unsettledSeen++;
      });
    }
    // The random cases do exercise sessions whose result changed after they were settled.
    expect(unsettledSeen).toBeGreaterThan(100);
  });
});
