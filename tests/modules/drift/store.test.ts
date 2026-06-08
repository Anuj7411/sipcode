import { describe, it, expect } from "vitest";
import {
  loadCachedSessions,
  persistNewSessions,
  pruneIfLarge,
  type StoreIO,
} from "../../../src/modules/drift/store.js";
import type { SessionMetrics } from "../../../src/modules/drift/types.js";

function memIO(): StoreIO {
  const files = new Map<string, string>();
  return {
    async read(p) {
      return files.has(p) ? files.get(p)! : null;
    },
    async write(p, content) {
      files.set(p, content);
    },
    async append(p, content) {
      files.set(p, (files.get(p) ?? "") + content);
    },
  };
}

function m(id: string, endedAtMs: number, project = "p1"): SessionMetrics {
  return {
    sessionId: id,
    endedAtMs,
    totalTokens: 1000,
    assistantTurns: 5,
    tokensPerTurn: 200,
    cacheHitRate: 0.5,
    duplicateReadTokens: 0,
    outputRatio: 0.1,
    projectHash: project,
  };
}

describe("drift store", () => {
  it("returns [] when the cache file does not exist", async () => {
    const io = memIO();
    const got = await loadCachedSessions("/x/sessions.jsonl", io);
    expect(got).toEqual([]);
  });

  it("persists and reads back JSONL, newest-first", async () => {
    const io = memIO();
    const path = "/x/sessions.jsonl";
    await persistNewSessions(path, new Set(), [m("a", 100), m("b", 200)], io);
    const got = await loadCachedSessions(path, io);
    expect(got.map((x) => x.sessionId)).toEqual(["b", "a"]);
  });

  it("dedupes by sessionId across appends — last write wins", async () => {
    const io = memIO();
    const path = "/x/sessions.jsonl";
    await persistNewSessions(path, new Set(), [m("a", 100)], io);
    await persistNewSessions(path, new Set(), [m("a", 999)], io);
    const got = await loadCachedSessions(path, io);
    expect(got).toHaveLength(1);
    expect(got[0]!.endedAtMs).toBe(999);
  });

  it("skips already-known ids on persist (no churn)", async () => {
    const io = memIO();
    const path = "/x/sessions.jsonl";
    await persistNewSessions(path, new Set(), [m("a", 100), m("b", 200)], io);
    const known = new Set(["a", "b"]);
    const wrote = await persistNewSessions(path, known, [m("a", 999), m("c", 300)], io);
    expect(wrote).toBe(1); // only c
    const got = await loadCachedSessions(path, io);
    expect(got.map((x) => x.sessionId).sort()).toEqual(["a", "b", "c"]);
  });

  it("ignores malformed JSONL lines without throwing", async () => {
    const io = memIO();
    const path = "/x/sessions.jsonl";
    const bad = "{not json}\n" + JSON.stringify(m("a", 100)) + "\n{partial";
    await io.write(path, bad);
    const got = await loadCachedSessions(path, io);
    expect(got).toHaveLength(1);
    expect(got[0]!.sessionId).toBe("a");
  });

  it("pruneIfLarge is a no-op below threshold", async () => {
    const io = memIO();
    const path = "/x/sessions.jsonl";
    const xs = Array.from({ length: 10 }, (_, i) => m(`s${i}`, i * 100));
    await persistNewSessions(path, new Set(), xs, io);
    await pruneIfLarge(path, io);
    const got = await loadCachedSessions(path, io);
    expect(got).toHaveLength(10);
  });

  it("pruneIfLarge keeps the newest KEEP_MAX when above threshold", async () => {
    const io = memIO();
    const path = "/x/sessions.jsonl";
    const xs = Array.from({ length: 250 }, (_, i) => m(`s${i}`, i * 100));
    await persistNewSessions(path, new Set(), xs, io);
    await pruneIfLarge(path, io);
    const got = await loadCachedSessions(path, io);
    expect(got).toHaveLength(50);
    // The kept set must be the newest (highest endedAtMs).
    expect(got[0]!.endedAtMs).toBe(24900);
    expect(got[got.length - 1]!.endedAtMs).toBe(20000);
  });
});
