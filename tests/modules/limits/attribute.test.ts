import { describe, expect, it } from "vitest";
import type { LimitReading } from "../../../src/modules/agents/codex/rateLimits.js";
import {
  attribute,
  folderName,
  requestsInPeriod,
  summarizeShares,
  type LimitRequest,
} from "../../../src/modules/limits/attribute.js";
import { buildPeriods, type LimitPeriod, type PeriodPoint } from "../../../src/modules/limits/periods.js";

const H = 3_600_000;
const S = Date.parse("2026-10-07T00:00:00.000Z");

function period(points: PeriodPoint[]): LimitPeriod {
  const last = points[points.length - 1]!;
  return {
    limitId: "codex",
    windowMinutes: 10080,
    startedAt: S,
    resetsAt: S + 7 * 24 * H,
    usedPercent: last.usedPercent,
    newestAt: last.at,
    points,
  };
}

function req(at: number, tokens: number, sessionId = "a", extra: Partial<LimitRequest> = {}): LimitRequest {
  return { at, sessionId, cwd: `C:\\work\\${sessionId}`, model: "gpt-5.4", tokens, ...extra };
}

const percents = (a: ReturnType<typeof attribute>) => a.shares.map((s) => [s.request.sessionId, s.percent]);

describe("attribute", () => {
  it("splits each rise across the requests since the previous rise, by tokens", () => {
    const p = period([
      { at: S + 2 * H, usedPercent: 4 },
      { at: S + 3 * H, usedPercent: 4 },
      { at: S + 4 * H, usedPercent: 4 },
      { at: S + 5 * H, usedPercent: 6 },
    ]);
    const a = attribute(p, [req(S + H, 100, "a"), req(S + 2 * H, 300, "b"), req(S + 3.5 * H, 500, "a")]);
    expect(percents(a)).toEqual([
      ["a", 1],
      ["b", 3],
      ["a", 2],
    ]);
    expect(a.unattributedPercent).toBe(0);
  });

  it("a rise seen only on a later reading goes to the requests before it (older Codex refreshes per turn)", () => {
    // Turn 1: requests at 1h and 2h, readings stay at the stale 10%; turn 2 starts at 5h showing 16%.
    const p = period([
      { at: S + 0.5 * H, usedPercent: 10 },
      { at: S + H, usedPercent: 10 },
      { at: S + 2 * H, usedPercent: 10 },
      { at: S + 5 * H, usedPercent: 16 },
    ]);
    const a = attribute(p, [req(S + 0.25 * H, 50, "x"), req(S + H, 200, "a"), req(S + 2 * H, 400, "a")]);
    expect(percents(a)).toEqual([
      ["x", 10],
      ["a", 2],
      ["a", 4],
    ]);
  });

  it("a rise with no local request since the previous rise is unattributed", () => {
    const p = period([
      { at: S + H, usedPercent: 3 },
      { at: S + 2 * H, usedPercent: 5 },
      { at: S + 3 * H, usedPercent: 9 },
    ]);
    const a = attribute(p, [req(S + 1.5 * H, 10)]);
    expect(percents(a)).toEqual([["a", 2]]);
    expect(a.unattributedPercent).toBe(7);
  });

  it("a request logged at the same instant as a reading counts toward it", () => {
    const a = attribute(period([{ at: S + H, usedPercent: 2 }]), [req(S + H, 10)]);
    expect(percents(a)).toEqual([["a", 2]]);
  });

  it("ignores requests outside (period start, newest reading] and requests with no tokens", () => {
    const p = period([{ at: S + H, usedPercent: 2 }]);
    const a = attribute(p, [req(S - 1, 10, "before"), req(S + 2 * H, 10, "after"), req(S + 0.5 * H, 0, "empty"), req(S + 0.5 * H, 10)]);
    expect(percents(a)).toEqual([["a", 2]]);
  });

  it("attributed plus unattributed equals the period's percent", () => {
    const points: PeriodPoint[] = [];
    const requests: LimitRequest[] = [];
    let pct = 0;
    for (let i = 1; i <= 60; i++) {
      if (i % 3 === 0) pct += 1 + (i % 4);
      points.push({ at: S + i * H, usedPercent: pct });
      if (i % 5 !== 0) requests.push(req(S + i * H - 1000, 7 + ((i * 13) % 11), i % 2 ? "a" : "b"));
    }
    const a = attribute(period(points), requests);
    const sum = a.shares.reduce((n, s) => n + s.percent, 0) + a.unattributedPercent;
    expect(sum).toBeCloseTo(pct, 9);
  });
});

describe("attribute across an early reset", () => {
  it("a request belongs to one period only: the next period starts no earlier than the previous one's newest reading", () => {
    // 30-day window: the limit fills to 100% over 10 days, then resets early with a reset
    // time 76 minutes later. resetsAt minus 30 days would start the new period on day 0,
    // before the previous period's readings, and count the day-1 request twice.
    const r = S + 30 * 24 * H;
    const rd = (at: number, usedPercent: number, resetsAt: number): LimitReading => ({
      at,
      sessionId: "a",
      limitId: "codex",
      planType: "go",
      windowMinutes: 43200,
      slot: "primary",
      usedPercent,
      resetsAt,
    });
    const filled = S + 10 * 24 * H;
    const [w] = buildPeriods([
      rd(S + 2 * H, 90, r),
      rd(filled, 100, r),
      rd(filled + 0.5 * H, 5, r + 76 * 60_000),
      rd(filled + 2 * H, 8, r + 76 * 60_000),
    ]);
    const [first, second] = w!.periods;
    expect(second!.startedAt).toBe(filled);
    const requests = [req(S + H, 900, "a"), req(S + 5 * H, 100, "b"), req(filled + H, 50, "c")];
    expect(requestsInPeriod(first!, requests).map((q) => q.sessionId)).toEqual(["a", "b"]);
    expect(requestsInPeriod(second!, requests).map((q) => q.sessionId)).toEqual(["c"]);
    const total = [first!, second!]
      .flatMap((p) => attribute(p, requests).shares)
      .reduce((n, sh) => n + sh.percent, 0);
    const unattributed = attribute(first!, requests).unattributedPercent + attribute(second!, requests).unattributedPercent;
    expect(total + unattributed).toBeCloseTo(108, 9);
  });
});

describe("folderName", () => {
  it("returns the last folder of a Windows or POSIX path, never the path", () => {
    expect(folderName("C:\\Users\\me\\proj-a")).toBe("proj-a");
    expect(folderName("/home/me/proj-b/")).toBe("proj-b");
    expect(folderName(undefined)).toBeNull();
    expect(folderName("/")).toBeNull();
  });
});

describe("summarizeShares", () => {
  const shares = [
    { request: req(S + H, 100, "a", { cwd: "C:\\Users\\me\\proj-a" }), percent: 1 },
    { request: req(S + 2 * H, 300, "b", { cwd: "/home/me/proj-b" }), percent: 3 },
    { request: req(S + 3 * H, 500, "a", { cwd: "C:\\Users\\me\\proj-a" }), percent: 1.5 },
    { request: req(S + 4 * H, 20, "c", { model: "codex-auto-review" }), percent: 0.25 },
    { request: req(S + 5 * H, 30, "d", { model: "codex-auto-review", cwd: "/home/me/proj-b" }), percent: 0.5 },
    { request: req(S + 6 * H, 40, "e"), percent: 0 },
  ];

  it("totals each session, highest percent first, and names the project by folder only", () => {
    const s = summarizeShares(shares);
    expect(s.sessions).toEqual([
      { sessionId: "b", project: "proj-b", percent: 3, tokens: 300 },
      { sessionId: "a", project: "proj-a", percent: 2.5, tokens: 600 },
      { sessionId: "e", project: "e", percent: 0, tokens: 40 },
    ]);
  });

  it("groups codex-auto-review requests into one line", () => {
    expect(summarizeShares(shares).autoReview).toEqual({ percent: 0.75, tokens: 50, requests: 2 });
  });

  it("include narrows the list (--here)", () => {
    const s = summarizeShares(shares, (r) => (r.cwd ?? "").startsWith("/home/me/proj-b"));
    expect(s.sessions.map((x) => x.sessionId)).toEqual(["b"]);
    expect(s.autoReview).toEqual({ percent: 0.5, tokens: 30, requests: 1 });
  });

  it("no auto-review line when those requests used none of the limit", () => {
    const s = summarizeShares([{ request: req(S, 10, "c", { model: "codex-auto-review" }), percent: 0 }]);
    expect(s.autoReview).toBeNull();
  });
});
