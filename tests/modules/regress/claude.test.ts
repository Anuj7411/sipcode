import { describe, expect, it } from "vitest";
import { coverageOf, detectClaude } from "../../../src/modules/regress/claude.js";
import type { ClaudeRow } from "../../../src/modules/regress/rows.js";
import { healthy, type Turn } from "../../integration/regress-fixtures.js";

const T0 = Date.parse("2026-03-01T09:00:00Z");
const DAY = 86_400_000;

/** One session file's rows, built like claudeRows builds them from a transcript. */
function file(
  version: string,
  turns: readonly Turn[],
  o: { model?: string; day?: number; side?: boolean; entry?: string; session?: string } = {},
): ClaudeRow[] {
  let t = T0 + (o.day ?? 0) * DAY;
  return turns.map((x) => {
    t += (x.gap ?? 1) * 60_000;
    const c5 = x.c5 ?? 0;
    const c1 = x.c1 ?? 0;
    const inp = x.inp ?? 3;
    return {
      session: o.session ?? "sess0001",
      version,
      model: o.model ?? "claude-opus-4-8",
      entry: o.entry ?? "cli",
      side: o.side ?? false,
      ts: t,
      inp,
      cr: x.cr,
      cw: c5 + c1,
      c5,
      c1,
      out: x.out ?? 400,
      ctx: inp + x.cr + c5 + c1,
      afterTool: x.tool ?? true,
    };
  });
}

/** n back-to-back turns that each miss the cache (cache read stuck at 14,569). */
function missing(n: number): Turn[] {
  const out: Turn[] = [];
  let conv = 40e3;
  for (let i = 0; i < n; i++) {
    out.push({ gap: 1, cr: 14569, c1: conv });
    conv += 1500;
  }
  return out;
}

const ids = (r: ReturnType<typeof detectClaude>) => r.findings.map((f) => [f.id, f.from, f.to]);

describe("detectClaude: warm-cache-miss", () => {
  it("flags a version whose warm turns miss the cache, compared with the user's other versions", () => {
    const r = detectClaude([file("2.1.60", healthy(30)), file("2.1.76", missing(25), { day: 1 })]);
    expect(ids(r)).toEqual([["warm-cache-miss", "2.1.76", "2.1.76"]]);
    expect(r.findings[0]!.known.map((k) => k.id)).toEqual(["R2"]);
    expect(r.findings[0]!.evidence[0]).toBe(
      "v2.1.76: 100.0% of 24 warm turns were cache misses (your other versions: 0.0% of 29)  [matches known R2]",
    );
    expect(r.findings[0]!.examples).toHaveLength(3);
    expect(r.tables.warmCacheMiss.map((t) => [t.version, t.n])).toEqual([
      ["2.1.60", 29],
      ["2.1.76", 24],
    ]);
  });

  it("needs minN warm turns in the version", () => {
    const r = detectClaude([file("2.1.60", healthy(30)), file("2.1.76", missing(20), { day: 1 })]);
    expect(r.findings).toEqual([]);
    expect(detectClaude([file("2.1.60", healthy(30)), file("2.1.76", missing(20), { day: 1 })], 19).findings).toHaveLength(1);
  });

  it("a turn that shrank the context (compaction, /clear) is not a warm turn", () => {
    const turns: Turn[] = [];
    for (let i = 0; i < 25; i++) turns.push({ gap: 1, cr: 0, c1: i % 2 ? 100e3 : 50e3 });
    const r = detectClaude([file("2.1.60", healthy(30)), file("2.1.76", turns, { day: 1 })]);
    expect(r.tables.warmCacheMiss.find((t) => t.version === "2.1.76")).toBeUndefined();
  });
});

describe("detectClaude: post-idle-cold", () => {
  const coldAfterIdle = (): Turn[] => {
    const turns = healthy(10);
    let ctx = 70e3;
    for (let i = 0; i < 4; i++) {
      turns.push({ gap: i === 0 ? 70 : 1, cr: 0, c1: ctx });
      ctx += 3e3;
    }
    return turns;
  };

  it("flags a version where the cache stays cold after an idle break", () => {
    const files = [file("2.1.60", healthy(30, { idleAt: [15] }))];
    for (let j = 0; j < 5; j++) files.push(file("2.1.90", coldAfterIdle(), { day: 1 + j }));
    const r = detectClaude(files);
    // The cold turns are also warm-turn cache misses (R3 shows up in both checks).
    expect(ids(r)).toContainEqual(["post-idle-cold", "2.1.90", "2.1.90"]);
    expect(r.findings.find((f) => f.id === "post-idle-cold")!.known.map((k) => k.id)).toEqual(["R3"]);
  });

  it("needs max(5, minN/4) idle returns", () => {
    const files = [file("2.1.60", healthy(30, { idleAt: [15] }))];
    for (let j = 0; j < 4; j++) files.push(file("2.1.90", coldAfterIdle(), { day: 1 + j }));
    expect(detectClaude(files, 20).tables.postIdleCold.find((t) => t.version === "2.1.90")).toBeUndefined();
  });
});

describe("detectClaude: ttl-5m", () => {
  it("flags a version whose main-conversation writes are 5-minute while the others are 1-hour", () => {
    const r = detectClaude([file("2.1.60", healthy(30)), file("2.1.100", healthy(30, { ttl: "5m" }), { day: 1 })]);
    expect(ids(r)).toEqual([["ttl-5m", "2.1.100", "2.1.100"]]);
    expect(r.findings[0]!.note).toBe("If you use an API key, cloud provider or usage credits, 5-minute TTL is expected, not a bug.");
  });

  it("does not flag when no other version has minN requests (API-key users are 5-minute everywhere)", () => {
    expect(detectClaude([file("2.1.100", healthy(30, { ttl: "5m" }))]).findings).toEqual([]);
  });

  it("adjacent flagged versions merge into one range", () => {
    const r = detectClaude([
      file("2.1.60", healthy(30)),
      file("2.1.100", healthy(30, { ttl: "5m" }), { day: 1 }),
      file("2.1.105", healthy(30, { ttl: "5m" }), { day: 2 }),
      file("2.1.140", healthy(30), { day: 3 }),
      file("2.1.150", healthy(30), { day: 4 }),
      file("2.1.160", healthy(30), { day: 5 }),
    ]);
    expect(ids(r)).toEqual([["ttl-5m", "2.1.100", "2.1.105"]]);
  });
});

describe("detectClaude: uncached-input", () => {
  it("flags a model and version with a large median uncached input on tool-result turns", () => {
    const r = detectClaude([
      file("2.1.250", healthy(25, { inp: 5 }), { model: "claude-fable-5-1" }),
      file("2.1.258", healthy(25, { inp: 3200 }), { model: "claude-fable-5-1", day: 1 }),
    ]);
    expect(ids(r)).toEqual([["uncached-input", "2.1.258", "2.1.258"]]);
    expect(r.findings[0]!.evidence[0]).toContain("claude-fable-5-1 v2.1.258: median uncached input 3,200 tokens/turn over 25 tool-result turns (same model, other versions: 5)");
  });

  it("499 tokens is under the bar; a same-model baseline of 100 or more is not flagged", () => {
    expect(detectClaude([file("2.1.250", healthy(25, { inp: 5 })), file("2.1.258", healthy(25, { inp: 499 }), { day: 1 })]).findings).toEqual([]);
    expect(detectClaude([file("2.1.250", healthy(25, { inp: 100 })), file("2.1.258", healthy(25, { inp: 3200 }), { day: 1 })]).findings).toEqual([]);
  });

  it("a model seen in only one version is compared with no baseline (the prototype's rule)", () => {
    const r = detectClaude([file("2.1.258", healthy(25, { inp: 3200 }), { model: "claude-fable-5-1" })]);
    expect(r.findings[0]!.evidence[0]).toContain("(same model, other versions: no data)");
  });
});

describe("detectClaude: hourly-rebuild", () => {
  const rebuilding = (): Turn[] => {
    const turns: Turn[] = [];
    let ctx = 80e3;
    for (let i = 0; i < 240; i++) {
      const rebuild = i > 0 && i % 60 === 0;
      turns.push({ gap: 1, cr: rebuild ? 9e3 : ctx - 400, c1: rebuild ? ctx - 9e3 : 400 });
      ctx += 400;
    }
    return turns;
  };

  it("flags a version whose full rebuilds recur every 50 to 70 minutes", () => {
    // 240 turns rebuild at 60, 120 and 180: two 60-minute gaps per file; two files make the 4 gaps needed.
    const r = detectClaude([file("2.1.240", rebuilding()), file("2.1.240", rebuilding(), { day: 1 })]);
    expect(ids(r)).toEqual([["hourly-rebuild", "2.1.240", "2.1.240"]]);
    expect(r.findings[0]!.evidence[0]).toBe("v2.1.240: 4 of 4 gaps between full rebuilds were 50 to 70 minutes  [matches known R5]");
  });

  it("needs 4 gaps: one file with 2 is not flagged", () => {
    const r = detectClaude([file("2.1.240", rebuilding())]);
    expect(r.tables.hourlyRebuild).toEqual([{ version: "2.1.240", n: 2, hourly: 2 }]);
    expect(r.findings).toEqual([]);
  });
});

describe("detectClaude: scope", () => {
  it("subagent and Agent SDK requests are never compared", () => {
    const r = detectClaude([
      file("2.1.60", healthy(30)),
      file("2.1.201", healthy(30, { ttl: "5m" }), { day: 1, entry: "sdk-ts" }),
      file("2.1.201", healthy(30, { ttl: "5m" }), { day: 2, side: true }),
    ]);
    expect(r.findings).toEqual([]);
    expect(r.coverage).toMatchObject({ requests: 30, excludedAutomated: 60, versions: 1 });
  });

  it("coverage counts interactive requests, sessions, versions, dates and the catalog windows", () => {
    const c = coverageOf([file("2.1.60", healthy(3), { session: "a" }), file("2.1.258", healthy(2), { day: 10, session: "b" })]);
    expect(c).toEqual({
      requests: 5,
      excludedAutomated: 0,
      sessions: 2,
      versions: 2,
      firstVersion: "2.1.60",
      lastVersion: "2.1.258",
      from: "2026-03-01",
      to: "2026-03-11",
      knownWindowsCovered: ["R1", "R4", "R5"],
    });
  });

  it("comparable: two versions with minN or more interactive requests", () => {
    expect(detectClaude([file("2.1.60", healthy(30))]).comparable).toBe(false);
    expect(detectClaude([file("2.1.60", healthy(30)), file("2.1.61", healthy(19), { day: 1 })]).comparable).toBe(false);
    expect(detectClaude([file("2.1.60", healthy(30)), file("2.1.61", healthy(20), { day: 1 })]).comparable).toBe(true);
  });
});
