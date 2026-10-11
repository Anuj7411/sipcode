import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LimitPeriod } from "../../../src/modules/limits/periods.js";
import type { LimitsReport, WindowReport } from "../../../src/modules/limits/report.js";
import {
  formatAgo,
  formatApprox,
  formatLimitsTerminal,
  formatPercent,
  formatTodayLimitLine,
  formatTokensCompact,
  formatWhen,
} from "../../../src/modules/limits/format-terminal.js";
import { formatLimitsJson } from "../../../src/modules/limits/format-json.js";

const H = 3_600_000;
const DAY = 24 * H;
const NOW = new Date("2026-10-09T10:00:00.000Z");
const iso = (s: string) => Date.parse(s);

let savedTz: string | undefined;
beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = "UTC";
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

function period(extra: Partial<LimitPeriod> = {}): LimitPeriod {
  return {
    limitId: "codex",
    windowMinutes: 10080,
    startedAt: iso("2026-10-07T14:00:00.000Z"),
    resetsAt: iso("2026-10-14T14:00:00.000Z"),
    usedPercent: 62,
    newestAt: iso("2026-10-09T08:00:00.000Z"),
    points: [],
    ...extra,
  };
}

function win(extra: Partial<WindowReport> = {}): WindowReport {
  return {
    limitId: "codex",
    windowMinutes: 10080,
    label: "Weekly",
    period: period(),
    periodCount: 1,
    projection: { kind: "runs-out", at: iso("2026-10-13T17:50:00.000Z") },
    usedBy: [],
    autoReview: null,
    unattributedPercent: 0,
    shrink: { points: [], possibleCut: null },
    ...extra,
  };
}

describe("helpers", () => {
  it("formatWhen shows the hour within a week, the date otherwise", () => {
    expect(formatWhen(iso("2026-10-14T14:00:00.000Z"), NOW.getTime())).toBe("Wed 14 Oct 14:00");
    expect(formatWhen(iso("2026-11-02T00:00:00.000Z"), NOW.getTime())).toBe("Mon 2 Nov");
    expect(formatWhen(iso("2026-04-20T06:03:00.000Z"), NOW.getTime())).toBe("Mon 20 Apr");
  });

  it("formatApprox rounds to the nearest hour", () => {
    expect(formatApprox(iso("2026-10-13T17:50:00.000Z"), NOW.getTime())).toBe("Tue 13 Oct ~18:00");
    expect(formatApprox(iso("2026-10-13T17:29:00.000Z"), NOW.getTime())).toBe("Tue 13 Oct ~17:00");
    expect(formatApprox(iso("2026-10-31T17:29:00.000Z"), NOW.getTime())).toBe("Sat 31 Oct");
  });

  it("formatAgo", () => {
    const n = NOW.getTime();
    expect(formatAgo(n - 30_000, n)).toBe("just now");
    expect(formatAgo(n - (36 * 60_000 + 25_000), n)).toBe("36m ago");
    expect(formatAgo(n - 2 * H, n)).toBe("2h ago");
    expect(formatAgo(n - 47 * H, n)).toBe("47h ago");
    expect(formatAgo(n - 3 * DAY, n)).toBe("3d ago");
  });

  it("formatPercent and formatTokensCompact", () => {
    expect(formatPercent(19.4)).toBe("19%");
    expect(formatPercent(0.44)).toBe("0.4%");
    expect(formatPercent(100)).toBe("100%");
    expect(formatTokensCompact(3_100_000)).toBe("3.1M");
    expect(formatTokensCompact(425_000)).toBe("425K");
    expect(formatTokensCompact(80_400)).toBe("80K");
    expect(formatTokensCompact(999_600)).toBe("1.0M");
    expect(formatTokensCompact(512)).toBe("512");
  });
});

describe("formatLimitsTerminal", () => {
  it("renders the header, one row per window and the sections under them", () => {
    const report: LimitsReport = {
      planType: "go",
      asOf: NOW.getTime() - 2 * H,
      windows: [
        win({
          usedBy: [
            { sessionId: "0199a1b2-c3d4-7a11-8000-00000000000a", project: "sipcode", percent: 19.2, tokens: 3_100_000 },
            { sessionId: "0199a0f7-11aa-7b02-8000-00000000000b", project: "my-app", percent: 12, tokens: 1_400_000 },
            { sessionId: "0199a0f7-11aa-7b03-8000-00000000000c", project: "a-very-long-project-name", percent: 0.4, tokens: 2_000 },
            { sessionId: "0199a0f7-11aa-7b04-8000-00000000000d", project: null, percent: 0, tokens: 900 },
          ],
          autoReview: { percent: 6, tokens: 180_000, requests: 9 },
          unattributedPercent: 3,
          shrink: {
            points: [
              { model: "gpt-5.4", periodStart: iso("2026-03-28T15:11:00.000Z"), tokensPerPercent: 425_000 },
              { model: "gpt-5.4", periodStart: iso("2026-04-01T08:37:00.000Z"), tokensPerPercent: 357_000 },
              { model: "gpt-5.4", periodStart: iso("2026-04-13T06:03:00.000Z"), tokensPerPercent: 80_000 },
              { model: "gpt-5.5", periodStart: iso("2026-05-01T00:00:00.000Z"), tokensPerPercent: 90_000 },
            ],
            possibleCut: {
              model: "gpt-5.4",
              periodStart: iso("2026-04-13T06:03:00.000Z"),
              tokensPerPercent: 80_000,
              baselineMedian: 391_000,
              factor: 4.9,
            },
          },
        }),
        win({
          limitId: "codex",
          windowMinutes: 43200,
          label: "30-day",
          period: period({ windowMinutes: 43200, usedPercent: 41, resetsAt: iso("2026-11-02T00:00:00.000Z") }),
          projection: { kind: "lasts" },
        }),
      ],
    };
    expect(formatLimitsTerminal(report, NOW)).toBe(
      [
        "sipcode limits · Codex · plan: go · as of 2h ago (your last Codex request)",
        "",
        "Weekly limit    62% used   resets Wed 14 Oct 14:00   at this pace: runs out Tue 13 Oct ~18:00",
        "30-day limit    41% used   resets Mon 2 Nov          at this pace: lasts until reset",
        "",
        "What used your weekly limit (since Wed 7 Oct)",
        "  0199a1b2-c3d4-7a11   sipcode       19%   3.1M tokens",
        "  0199a0f7-11aa-7b02   my-app        12%   1.4M tokens",
        "  0199a0f7-11aa-7b03   a-very-long-… 0.4%   2K tokens",
        "  codex-auto-review (9 requests)      6%",
        "  unattributed (no Codex requests on this computer)  3%",
        "",
        "Tokens per 1% of your weekly limit (gpt-5.4)",
        "  Mar 28: 425K   Apr 1: 357K   Apr 13: 80K",
        "  Possible limit cut around Apr 13: 4.9x fewer tokens per 1%.",
        "  Limits cover your whole account. Codex use on other devices or in the cloud",
        "  is not in these logs and can look like a cut.",
      ].join("\n"),
    );
  });

  it("reached, too-early and reset-since rows; no plan, no sections", () => {
    const report: LimitsReport = {
      planType: null,
      asOf: NOW.getTime() - 30_000,
      windows: [
        win({
          label: "5-hour",
          windowMinutes: 300,
          period: period({ usedPercent: 3, resetsAt: iso("2026-10-09T14:00:00.000Z") }),
          projection: { kind: "too-early" },
        }),
        win({ period: period({ usedPercent: 100 }), projection: { kind: "reached" } }),
        win({
          label: "30-day",
          period: period({ resetsAt: iso("2026-04-20T06:03:00.000Z") }),
          projection: { kind: "reset-since" },
          unattributedPercent: 62,
        }),
      ],
    };
    expect(formatLimitsTerminal(report, NOW)).toBe(
      [
        "sipcode limits · Codex · as of just now (your last Codex request)",
        "",
        "5-hour limit    3% used    resets Fri 9 Oct 14:00    not enough data yet for a pace",
        "Weekly limit    100% used  limit reached, resets Wed 14 Oct 14:00",
        "30-day limit    reset since your last Codex request (at Mon 20 Apr)",
      ].join("\n"),
    );
  });
});

describe("formatTodayLimitLine", () => {
  const line = (w: Partial<WindowReport>) => {
    const full = win(w);
    return formatTodayLimitLine({ label: full.label, period: full.period, projection: full.projection }, NOW);
  };

  it("runs out", () => {
    expect(line({})).toBe("Codex weekly limit: 62% used, resets Wed 14:00. At this pace you run out Tue ~18:00.");
  });

  it("lasts, with a reset more than a week away", () => {
    expect(
      line({
        label: "30-day",
        period: period({ usedPercent: 41, resetsAt: iso("2026-11-02T00:00:00.000Z") }),
        projection: { kind: "lasts" },
      }),
    ).toBe("Codex 30-day limit: 41% used, resets Mon 2 Nov. At this pace it lasts until the reset.");
  });

  it("reached and too early", () => {
    expect(line({ period: period({ usedPercent: 100 }), projection: { kind: "reached" } })).toBe(
      "Codex weekly limit: limit reached, resets Wed 14:00.",
    );
    expect(
      line({
        label: "5-hour",
        period: period({ usedPercent: 3, resetsAt: iso("2026-10-09T14:00:00.000Z") }),
        projection: { kind: "too-early" },
      }),
    ).toBe("Codex 5-hour limit: 3% used, resets Fri 14:00. Not enough data yet for a pace.");
  });
});

describe("formatLimitsJson", () => {
  it("prints the documented shape", () => {
    const report: LimitsReport = {
      planType: "go",
      asOf: iso("2026-10-09T08:00:00.000Z"),
      windows: [
        win({
          usedBy: [{ sessionId: "s1", project: "sipcode", percent: 50, tokens: 3_100_000 }],
          autoReview: { percent: 6, tokens: 180_000, requests: 9 },
          unattributedPercent: 6,
          periodCount: 4,
          shrink: {
            points: [{ model: "gpt-5.4", periodStart: iso("2026-04-13T06:03:00.000Z"), tokensPerPercent: 77_400.5 }],
            possibleCut: {
              model: "gpt-5.4",
              periodStart: iso("2026-04-13T06:03:00.000Z"),
              tokensPerPercent: 77_400.5,
              baselineMedian: 390_761,
              factor: 5,
            },
          },
        }),
      ],
    };
    expect(JSON.parse(formatLimitsJson(report))).toEqual({
      agent: "codex",
      planType: "go",
      asOf: "2026-10-09T08:00:00.000Z",
      windows: [
        {
          limitId: "codex",
          windowMinutes: 10080,
          label: "Weekly",
          usedPercent: 62,
          resetsAt: "2026-10-14T14:00:00.000Z",
          projection: { kind: "runs-out", at: "2026-10-13T17:50:00.000Z" },
          usedBy: [
            { sessionId: "s1", project: "sipcode", percent: 50, tokens: 3_100_000 },
            { sessionId: "codex-auto-review", project: null, percent: 6, tokens: 180_000 },
          ],
          unattributedPercent: 6,
          tokensPerPercent: [{ model: "gpt-5.4", periodStart: "2026-04-13T06:03:00.000Z", tokensPerPercent: 77_401 }],
          possibleCut: { at: "2026-04-13", factor: 5 },
          periodCount: 4,
        },
      ],
    });
  });

  it("projection kinds other than runs-out carry no time; no data gives an empty list", () => {
    const report: LimitsReport = { planType: null, asOf: 0, windows: [win({ projection: { kind: "lasts" } })] };
    expect(JSON.parse(formatLimitsJson(report)).windows[0].projection).toEqual({ kind: "lasts" });
    expect(JSON.parse(formatLimitsJson(null))).toEqual({ agent: "codex", planType: null, asOf: null, windows: [] });
  });
});
