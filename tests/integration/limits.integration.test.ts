/** `sipcode limits` end to end on in-memory Codex logs. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLimits } from "../../src/commands/limits.js";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import {
  addCodexRollout,
  addShrinkScenario,
  addWeeklyLimitScenario,
  CODEX_SESSIONS,
  LIMITS_REVIEW,
  LIMITS_SESSION_A,
  LIMITS_SESSION_B,
  solTurn,
} from "./codex-fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "../fixtures/codex");
const NOW = new Date("2026-10-09T10:00:00.000Z");

let savedTz: string | undefined;
beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = "UTC";
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

async function run(opts: Parameters<typeof runLimits>[0], fs: InMemoryFs, now = NOW) {
  const out: string[] = [];
  const err: string[] = [];
  const r = await runLimits(opts, {
    fs,
    env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
    clock: new FakeClock(now),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  });
  return { exitCode: r.exitCode, out: out.join("\n"), err: err.join("\n") };
}

function weeklyFs(): InMemoryFs {
  const fs = new InMemoryFs();
  addWeeklyLimitScenario(fs);
  return fs;
}

describe("sipcode limits: empty and error states", () => {
  it("no Codex logs: says so and exits 0", async () => {
    const r = await run({}, new InMemoryFs());
    expect(r.exitCode).toBe(0);
    expect(r.out).toBe("no Codex limit readings found yet (Codex records them after each request).");
  });

  it("Codex logs without limit readings: the same message", async () => {
    const fs = new InMemoryFs();
    addCodexRollout(fs, "cx1", [solTurn("2026-10-08T10:00:00Z")]);
    const r = await run({}, fs);
    expect(r.exitCode).toBe(0);
    expect(r.out).toBe("no Codex limit readings found yet (Codex records them after each request).");
  });

  it("only stale readings (logged after their reset time) count as no readings", async () => {
    const fs = new InMemoryFs();
    addCodexRollout(fs, "cx1", [
      { ...solTurn("2026-10-08T10:00:00Z"), limit: { usedPercent: 40, windowMinutes: 300, resetsAt: "2026-10-08T09:00:00Z" } },
    ]);
    const r = await run({}, fs);
    expect(r.exitCode).toBe(0);
    expect(r.out).toBe("no Codex limit readings found yet (Codex records them after each request).");
    const j = await run({ json: true }, fs);
    expect(j.exitCode).toBe(0);
    expect(JSON.parse(j.out)).toEqual({ agent: "codex", planType: null, asOf: null, windows: [] });
  });

  it("--json without readings prints an empty windows list", async () => {
    const r = await run({ json: true }, new InMemoryFs());
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ agent: "codex", planType: null, asOf: null, windows: [] });
  });

  it("--agent claude-code (or cursor) stops with E009: limits are recorded only by Codex", async () => {
    for (const agent of ["claude-code", "cursor"]) {
      const r = await run({ agent }, weeklyFs());
      expect(r.exitCode).toBe(1);
      expect(r.out).toBe("");
      expect(r.err).toContain("[E009] sipcode limits reads Codex limits only.");
      expect(r.err).toContain("limits are recorded only by Codex");
    }
  });

  it("the E009 why line names the agent that was asked for", async () => {
    const cursor = await run({ agent: "cursor" }, weeklyFs());
    expect(cursor.err).toContain("why: limits are recorded only by Codex. Cursor's logs do not record them.");
    expect(cursor.err).not.toContain("Claude Code");
    const claude = await run({ agent: "claude-code" }, weeklyFs());
    expect(claude.err).toContain("why: limits are recorded only by Codex. Claude Code's logs do not record them.");
  });

  it("--agent codex and --agent auto read Codex", async () => {
    for (const agent of ["codex", "auto"]) {
      const r = await run({ agent, json: true }, weeklyFs());
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.out).windows).toHaveLength(1);
    }
  });

  it("an unknown --agent is rejected", async () => {
    const r = await run({ agent: "gemini" }, weeklyFs());
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain("gemini");
  });

  it("a bad --since is E010 and points at limits", async () => {
    const r = await run({ since: "yesterday" }, weeklyFs());
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain('[E010] couldn\'t parse --since "yesterday".');
    expect(r.err).toContain("next: npx sipcode limits --since 30d");
  });

  it("a damaged reading line is skipped with a note on stderr", async () => {
    const fs = weeklyFs();
    fs.writeFile(
      `${CODEX_SESSIONS}/2026/10/09/rollout-broken.jsonl`,
      '{"timestamp":"2026-10-09T09:00:00.000Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary"',
      Date.parse("2026-10-09T09:00:00.000Z"),
    );
    const r = await run({ json: true }, fs);
    expect(r.exitCode).toBe(0);
    expect(r.err).toContain("note: 1 Codex limit reading(s) could not be read and were skipped.");
    expect(JSON.parse(r.out).windows[0].usedPercent).toBe(62);
  });
});

describe("sipcode limits: one weekly period", () => {
  it("shows the window, the pace and what used it", async () => {
    const r = await run({}, weeklyFs());
    expect(r.exitCode).toBe(0);
    expect(r.out).toBe(
      [
        "sipcode limits · Codex · plan: plus · as of 2h ago (your last Codex request)",
        "",
        "Weekly limit    62% used   resets Wed 14 Oct 08:30   at this pace: runs out Sat 10 Oct ~16:00",
        "",
        "What used your weekly limit (since Wed 7 Oct)",
        "  0199a1b2-c3d4-7a11   sipcode       30%   3.1M tokens",
        "  0199a0f7-11aa-7b02   my-app        27%   3.1M tokens",
        "  codex-auto-review (1 request)       5%",
      ].join("\n"),
    );
  });

  it("--json: the documented shape, and the lines add up to the percent used", async () => {
    const r = await run({ json: true }, weeklyFs());
    const j = JSON.parse(r.out);
    expect(j.agent).toBe("codex");
    expect(j.planType).toBe("plus");
    expect(j.asOf).toBe("2026-10-09T08:00:00.000Z");
    expect(j.windows).toHaveLength(1);
    const w = j.windows[0];
    expect(Object.keys(w)).toEqual([
      "limitId",
      "windowMinutes",
      "label",
      "usedPercent",
      "resetsAt",
      "projection",
      "usedBy",
      "unattributedPercent",
      "tokensPerPercent",
      "possibleCut",
      "periodCount",
    ]);
    expect(w).toMatchObject({
      limitId: "codex",
      windowMinutes: 10080,
      label: "Weekly",
      usedPercent: 62,
      resetsAt: "2026-10-14T08:30:00.000Z",
      unattributedPercent: 0,
      tokensPerPercent: [],
      possibleCut: null,
      periodCount: 1,
    });
    expect(w.projection.kind).toBe("runs-out");
    expect(Math.abs(Date.parse(w.projection.at) - Date.parse("2026-10-10T16:20:19.355Z"))).toBeLessThan(1000);
    expect(w.usedBy.map((u: { sessionId: string; project: string | null; tokens: number }) => [u.sessionId, u.project, u.tokens])).toEqual([
      [LIMITS_SESSION_A, "sipcode", 3_100_000],
      [LIMITS_SESSION_B, "my-app", 3_100_000],
      ["codex-auto-review", null, 20_503],
    ]);
    const percents = w.usedBy.map((u: { percent: number }) => u.percent);
    expect(percents[0]).toBeCloseTo(30, 9);
    expect(percents[1]).toBeCloseTo(27, 9);
    expect(percents[2]).toBeCloseTo(5, 9);
    expect(percents.reduce((a: number, b: number) => a + b, 0) + w.unattributedPercent).toBeCloseTo(62, 9);
    expect(r.out).not.toContain("C:\\\\work");
    expect(r.out).not.toContain(LIMITS_REVIEW);
  });

  it("--here keeps only this folder's sessions in what used it; the percent stays account-wide", async () => {
    const r = await run({ json: true, here: true, cwd: "C:\\work\\sipcode" }, weeklyFs());
    const w = JSON.parse(r.out).windows[0];
    expect(w.usedPercent).toBe(62);
    expect(w.usedBy.map((u: { sessionId: string }) => u.sessionId)).toEqual([LIMITS_SESSION_A, "codex-auto-review"]);
    expect(w.unattributedPercent).toBe(0);
  });

  it("once the reset time has passed, the window says so instead of a stale percent", async () => {
    const r = await run({}, weeklyFs(), new Date("2026-10-15T00:00:00.000Z"));
    expect(r.out).toBe(
      [
        "sipcode limits · Codex · plan: plus · as of 5d ago (your last Codex request)",
        "",
        "Weekly limit    reset since your last Codex request (at Wed 14 Oct 08:30)",
      ].join("\n"),
    );
  });
});

describe("sipcode limits: tokens per 1% over time", () => {
  const SHRINK_NOW = new Date("2026-10-09T00:00:00.000Z");
  const shrinkFs = () => {
    const fs = new InMemoryFs();
    addShrinkScenario(fs);
    return fs;
  };

  it("shows each finished period and a possible cut with the other-devices caveat", async () => {
    const r = await run({}, shrinkFs(), SHRINK_NOW);
    expect(r.out).toBe(
      [
        "sipcode limits · Codex · plan: plus · as of 24h ago (your last Codex request)",
        "",
        "Weekly limit    10% used   resets Tue 13 Oct 00:00   at this pace: lasts until reset",
        "",
        "What used your weekly limit (since Tue 6 Oct)",
        "  0199a000-0000-7000   proj          10%   1.0M tokens",
        "",
        "Tokens per 1% of your weekly limit (gpt-5.4)",
        "  Sep 1: 400K   Sep 8: 400K   Sep 15: 100K",
        "  Possible limit cut around Sep 15: 4.0x fewer tokens per 1%.",
        "  Limits cover your whole account. Codex use on other devices or in the cloud",
        "  is not in these logs and can look like a cut.",
      ].join("\n"),
    );
    const j = JSON.parse((await run({ json: true }, shrinkFs(), SHRINK_NOW)).out);
    expect(j.windows[0].periodCount).toBe(4);
    expect(j.windows[0].tokensPerPercent).toEqual([
      { model: "gpt-5.4", periodStart: "2026-09-01T00:00:00.000Z", tokensPerPercent: 400_000 },
      { model: "gpt-5.4", periodStart: "2026-09-08T00:00:00.000Z", tokensPerPercent: 400_000 },
      { model: "gpt-5.4", periodStart: "2026-09-15T00:00:00.000Z", tokensPerPercent: 100_000 },
    ]);
    expect(j.windows[0].possibleCut).toEqual({ at: "2026-09-15", factor: 4 });
  });

  it("--since limits how far back the history goes (default 90d)", async () => {
    const j = JSON.parse((await run({ json: true, since: "7d" }, shrinkFs(), SHRINK_NOW)).out);
    expect(j.windows[0].tokensPerPercent).toEqual([]);
    expect(j.windows[0].possibleCut).toBeNull();
    expect(j.windows[0].periodCount).toBe(4);
    const t = await run({ since: "7d" }, shrinkFs(), SHRINK_NOW);
    expect(t.out).not.toContain("Tokens per 1%");
  });
});

describe("sipcode limits: anonymised real rollout (tests/fixtures/codex/compacted.jsonl)", () => {
  const FIXTURE_NOW = new Date("2026-01-09T18:00:00.000Z");
  const fixtureFs = () => {
    const fs = new InMemoryFs();
    fs.writeFile(
      `${CODEX_SESSIONS}/2026/01/01/rollout-2026-01-01T00-00-00-019b0004-0001-7000-8000-000000000000.jsonl`,
      readFileSync(path.join(FIXTURES, "compacted.jsonl"), "utf-8"),
      Date.parse("2026-01-09T17:48:00.000Z"),
    );
    return fs;
  };

  it("limits --json --since all", async () => {
    const r = await run({ json: true, since: "all" }, fixtureFs(), FIXTURE_NOW);
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.planType).toBe("x");
    expect(j.asOf).toBe("2026-01-09T17:23:35.171Z");
    expect(j.windows).toHaveLength(1);
    const w = j.windows[0];
    expect(w).toMatchObject({
      limitId: "x",
      windowMinutes: 10080,
      label: "Weekly",
      usedPercent: 92,
      resetsAt: "2026-01-14T14:44:07.000Z",
      projection: { kind: "runs-out", at: "2026-01-09T22:27:29.881Z" },
      periodCount: 2,
      tokensPerPercent: [{ model: "gpt-5.4", periodStart: "2025-12-26T17:17:46.000Z", tokensPerPercent: 111_071 }],
      possibleCut: null,
    });
    expect(w.usedBy).toHaveLength(1);
    expect(w.usedBy[0].sessionId).toBe("019b0004-0001-7000-8000-000000000000");
    expect(w.usedBy[0].project).toBe("fixture");
    expect(w.usedBy[0].tokens).toBe(7_120_846);
    expect(w.usedBy[0].percent).toBeCloseTo(89, 9);
    expect(w.unattributedPercent).toBe(3);
  });

  it("terminal", async () => {
    const r = await run({ since: "all" }, fixtureFs(), FIXTURE_NOW);
    // The anonymised fixture's limit id is "x", so the window is named after it.
    expect(r.out.split("\n").slice(0, 3)).toEqual([
      "sipcode limits · Codex · plan: x · as of 36m ago (your last Codex request)",
      "",
      "Weekly limit (x)  92% used   resets Wed 14 Jan 14:44   at this pace: runs out Fri 9 Jan ~22:00",
    ]);
    expect(r.out).toContain("  019b0004-0001-7000   fixture       89%   7.1M tokens");
    expect(r.out).toContain("  unattributed (no Codex requests on this computer)  3%");
  });
});
