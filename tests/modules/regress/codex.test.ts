import { describe, expect, it } from "vitest";
import type { LimitReading } from "../../../src/modules/agents/codex/rateLimits.js";
import { burnTable, detectCodex } from "../../../src/modules/regress/codex.js";
import type { CodexRequest } from "../../../src/modules/regress/rows.js";

const MIN = 60_000;
const W0 = Date.parse("2026-06-01T00:00:00Z");
const WEEK = 7 * 1440 * MIN;

interface Run {
  readonly readings: LimitReading[];
  readonly requests: CodexRequest[];
}

/**
 * `turns` requests of 20,000 work tokens (125,000 total) in week `week`, one a
 * minute; after each, a reading rising `pctPerM` percent per 1M work tokens
 * in whole percent.
 */
function week(
  version: string,
  w: number,
  pctPerM: number,
  o: { turns?: number; model?: string; plan?: string; windowMinutes?: number; session?: string } = {},
): Run {
  const { turns = 150, model = "gpt-5.5", plan = "plus", windowMinutes = 10_080, session = `s-${version}` } = o;
  const start = W0 + w * WEEK + 60 * MIN;
  const resetsAt = W0 + w * WEEK + windowMinutes * MIN;
  const readings: LimitReading[] = [];
  const requests: CodexRequest[] = [];
  for (let i = 0; i < turns; i++) {
    const at = start + (i + 1) * MIN;
    requests.push({ at, sessionId: session, cwd: "/p", model, tokens: 125_000, version, work: 20_000 });
    const used = Math.floor(((i + 1) * 20_000 * pctPerM) / 1e6 + 1e-9);
    readings.push({ at, sessionId: session, limitId: "codex", planType: plan, windowMinutes, slot: "primary", usedPercent: used, resetsAt });
  }
  return { readings, requests };
}

const join = (...runs: Run[]): Run => ({ readings: runs.flatMap((r) => r.readings), requests: runs.flatMap((r) => r.requests) });

describe("burnTable", () => {
  it("one row per version, model, plan and window, with percent per 1M work tokens", () => {
    const { readings, requests } = join(week("0.140.0", 0, 2), week("0.141.0", 1, 4));
    const t = burnTable(readings, requests);
    expect(t.map((r) => [r.version, r.model, r.plan, r.limitId, r.windowMinutes])).toEqual([
      ["0.140.0", "gpt-5.5", "plus", "codex", 10080],
      ["0.141.0", "gpt-5.5", "plus", "codex", 10080],
    ]);
    // 150 requests at 2% per 1M = 6%; requests after the last rise are not charged yet.
    expect(t[0]!.percent).toBeCloseTo(6, 9);
    expect(t[0]!.requests).toBe(150);
    expect(t[0]!.percentPerMillion).toBeCloseTo(2, 9);
    expect(t[1]!.percentPerMillion).toBeCloseTo(4, 9);
  });

  it("requests after a period's last rise are left out", () => {
    // 3% per 1M over 140 requests: the last rise (to 8%) is at request 134; requests 135 to 140 are not charged.
    const { readings, requests } = week("0.140.0", 0, 3, { turns: 140 });
    const [row] = burnTable(readings, requests);
    expect(row!.requests).toBe(134);
    expect(row!.percent).toBeCloseTo(8, 9);
    expect(row!.percentPerMillion).toBeCloseTo(row!.percent / (row!.workTokens / 1e6), 9);
  });

  it("groups under 200,000 work tokens are dropped", () => {
    const { readings, requests } = week("0.140.0", 0, 50, { turns: 9 });
    expect(burnTable(readings, requests)).toEqual([]);
  });

  it("a rise with no local request (another device) is not charged to any version", () => {
    const base = week("0.140.0", 0, 2);
    const other: LimitReading = { ...base.readings[0]!, at: base.readings[0]!.at - 30 * MIN, usedPercent: 0 };
    const jump: LimitReading = { ...base.readings[0]!, at: base.readings[0]!.at - 10 * MIN, usedPercent: 40 };
    const shifted = base.readings.map((r) => ({ ...r, usedPercent: r.usedPercent + 40 }));
    const t = burnTable([other, jump, ...shifted], base.requests);
    expect(t[0]!.percent).toBeCloseTo(6, 9);
  });
});

describe("detectCodex", () => {
  it("flags a version at 2x or more the median of the others on the same plan and window", () => {
    const { readings, requests } = join(week("0.140.0", 0, 2), week("0.141.0", 1, 2.2), week("0.142.0", 2, 25));
    const r = detectCodex(readings, requests);
    expect(r.findings.map((f) => [f.id, f.agent, f.from, f.to])).toEqual([["codex-limit-burn", "codex", "0.142.0", "0.142.0"]]);
    expect(r.findings[0]!.known).toEqual([]);
    expect(r.findings[0]!.evidence[0]).toMatch(
      /^v0\.142\.0 gpt-5\.5 \(plus, weekly window\): 25\.00% of the limit per 1M uncached\+output tokens vs 2\.\d\d% on your other versions \(\d+\.\dx\)$/,
    );
    expect(r.findings[0]!.note).toContain("A limit change on your plan at the same time as the update would look the same");
    expect(r.comparable).toBe(true);
  });

  it("does not flag under 2x", () => {
    const { readings, requests } = join(week("0.140.0", 0, 2), week("0.141.0", 1, 2.2), week("0.142.0", 2, 4.2));
    expect(detectCodex(readings, requests).findings).toEqual([]);
  });

  it("compares only within a plan and window: a lone window has no peers", () => {
    const { readings, requests } = join(week("0.140.0", 0, 2), week("0.142.0", 2, 25, { windowMinutes: 43_200, session: "s2" }));
    const r = detectCodex(readings, requests);
    expect(r.findings).toEqual([]);
    expect(r.comparable).toBe(false);
  });

  it("says when the plan's window changed and when the model differs from every peer", () => {
    const { readings, requests } = join(
      week("0.140.0", 0, 2),
      week("0.141.0", 1, 2.2),
      week("0.142.0", 2, 25, { model: "gpt-6.1-sol" }),
      week("0.143.0", 3, 2, { windowMinutes: 300, session: "s5" }),
      week("0.143.0", 4, 2, { windowMinutes: 300, session: "s6", model: "gpt-6.1-sol" }),
    );
    const f = detectCodex(readings, requests).findings.find((x) => x.from === "0.142.0")!;
    expect(f.note).toContain("Your plan's limit window changed during this period; only same-window versions were compared.");
    expect(f.note).toContain("This version ran a different model than your other versions; the model may explain the difference.");
  });

  it("coverage counts requests, sessions, versions, dates, readings and groups", () => {
    const { readings, requests } = join(week("0.140.0", 0, 2), week("0.141.0", 1, 2.2));
    expect(detectCodex(readings, requests).coverage).toEqual({
      requests: 300,
      sessions: 2,
      versions: 2,
      firstVersion: "0.140.0",
      lastVersion: "0.141.0",
      from: "2026-06-01",
      to: "2026-06-08",
      readings: 300,
      groups: 2,
    });
  });
});
