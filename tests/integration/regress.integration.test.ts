/** `sipcode regress` end to end on in-memory Claude Code and Codex logs. */
import { describe, expect, it } from "vitest";
import { runRegress } from "../../src/commands/regress.js";
import { InMemoryFs, type FileSystem } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import {
  addClaudeDataset,
  addClaudeSession,
  addCodexDataset,
  addCodexRollout,
  CLAUDE_PROJECT,
  claudeSessionText,
  healthy,
  HOME,
} from "./regress-fixtures.js";

const NOW = new Date("2026-10-12T10:00:00.000Z");

async function run(opts: Parameters<typeof runRegress>[0], fs: FileSystem) {
  const out: string[] = [];
  const err: string[] = [];
  const r = await runRegress(opts, {
    fs,
    env: new FakeProcessEnv({ homeDir: HOME, platform: "linux", vars: { NO_COLOR: "1" } }),
    clock: new FakeClock(NOW),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    version: "1.7.2",
  });
  return { exitCode: r.exitCode, out: out.join("\n"), err: err.join("\n") };
}

function dataset(dirty: boolean): InMemoryFs {
  const fs = new InMemoryFs();
  addClaudeDataset(fs, { dirty });
  addCodexDataset(fs, { dirty });
  return fs;
}

/** Fails listing or reading the paths `fail` names, like a sandbox that blocks them. */
function blocked(base: InMemoryFs, fail: (p: string) => boolean): FileSystem {
  const guard = (p: string) => {
    if (fail(p.replace(/\\/g, "/"))) throw Object.assign(new Error(`EACCES: ${p}`), { code: "EACCES" });
  };
  return {
    exists: (p) => base.exists(p),
    readFile: async (p) => (guard(p), base.readFile(p)),
    readHead: async (p, n) => (guard(p), base.readHead(p, n)),
    readDir: async (p) => (guard(p), base.readDir(p)),
    stat: (p) => base.stat(p),
  };
}

describe("sipcode regress: ground truth (the prototype's confirmed regressions)", () => {
  it("every confirmed regression fires and maps to its known issue; the Codex drain fires", async () => {
    const r = await run({ json: true }, dataset(true));
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(r.out);
    const got = (id: string) => j.findings.find((f: { id: string }) => f.id === id);
    const expected: Array<[string, string | null, string, string]> = [
      // 2.1.90 (R3) also misses the cache on 25% of its warm turns, next to 2.1.76: one range.
      ["warm-cache-miss", "R2", "2.1.76", "2.1.90"],
      ["post-idle-cold", "R3", "2.1.90", "2.1.90"],
      ["ttl-5m", "R4", "2.1.100", "2.1.105"],
      ["uncached-input", "R1", "2.1.258", "2.1.258"],
      ["hourly-rebuild", "R5", "2.1.240", "2.1.240"],
      ["codex-limit-burn", null, "0.142.0", "0.142.0"],
    ];
    for (const [id, known, from, to] of expected) {
      const f = got(id);
      expect(f, id).toBeDefined();
      expect([f.from, f.to], id).toEqual([from, to]);
      if (known) expect(f.known.map((k: { id: string }) => k.id), id).toContain(known);
      else expect(f.known, id).toEqual([]);
    }
    expect(j.findings).toHaveLength(6);
  });

  it("the clean dataset produces zero findings and says so", async () => {
    const fs = dataset(false);
    const j = JSON.parse((await run({ json: true }, fs)).out);
    expect(j.findings).toEqual([]);
    expect(j.comparable).toBe(true);
    const t = await run({}, fs);
    expect(t.exitCode).toBe(0);
    expect(t.out).toContain("No regressions detected in your logs.");
  });

  it("coverage: interactive requests only; subagent and Agent SDK requests are counted apart", async () => {
    const j = JSON.parse((await run({ json: true }, dataset(false))).out);
    // 6 healthy versions x (3 x 30 + 25) requests; the SDK and sidechain sessions (2 x 30) are left out.
    expect(j.coverage.claudeCode).toEqual({
      requests: 690,
      excludedAutomated: 60,
      sessions: 24,
      versions: 6,
      firstVersion: "2.1.60",
      lastVersion: "2.1.262",
      from: "2026-03-01",
      to: "2026-04-25",
      knownWindowsCovered: ["R3", "R4", "R5"],
    });
    expect(j.coverage.codex).toMatchObject({ requests: 450, sessions: 3, versions: 3, firstVersion: "0.140.0", lastVersion: "0.142.0", groups: 3 });
    expect(j.access).toEqual({ missingDirs: [], unreadableFiles: 0, unreadableFolders: 0, skippedCompressed: 0, nothingRead: false });
  });

  it("a request copied into a resumed session file counts once", async () => {
    const fs = dataset(false);
    const before = JSON.parse((await run({ json: true }, fs)).out).coverage.claudeCode.requests;
    const original = await fs.readFile(`${CLAUDE_PROJECT}/sess0001-0000-4000-8000-000000000000.jsonl`);
    fs.writeFile(`${CLAUDE_PROJECT}/resumed-copy.jsonl`, original, Date.parse("2026-09-01T00:00:00Z"));
    const after = JSON.parse((await run({ json: true }, fs)).out).coverage.claudeCode.requests;
    expect(after).toBe(before);
  });
});

describe("sipcode regress: terminal output", () => {
  it("prints the coverage lines, each finding, the catalog status and the signal-not-proof line", async () => {
    const r = await run({}, dataset(true));
    expect(r.exitCode).toBe(0);
    const lines = r.out.split("\n");
    expect(lines[0]).toBe("sipcode regress · local only, no network");
    expect(lines[1]).toMatch(/^Claude Code: [\d,]+ interactive requests in \d+ sessions \(60 subagent and Agent SDK requests left out of the comparison\), 2026-03-01 to 2026-\d\d-\d\d, versions 2\.1\.60 to 2\.1\.262$/);
    expect(lines[2]).toBe("Known-regression windows your logs cover: R1, R2, R3, R4, R5");
    expect(lines[3]).toMatch(/^Codex: 450 requests in 3 sessions, 2026-06-01 to 2026-06-15, versions 0\.140\.0 to 0\.142\.0, 3 version\/model groups with enough limit data$/);
    expect(r.out).toContain("● Prompt cache missing on back-to-back turns  [warm-cache-miss]  Claude Code 2.1.76 to 2.1.90  = known R2, R3");
    expect(r.out).toContain("● Main-conversation cache written with the 5-minute TTL instead of 1-hour  [ttl-5m]  Claude Code 2.1.100 to 2.1.105  = known R4");
    expect(r.out).toContain("● Codex rate limit drains faster per token  [codex-limit-burn]  Codex 0.142.0  (not in the known-issue catalog)");
    expect(r.out).toContain("A finding that is not in the known-issue catalog is a signal worth reporting, not proof of a bug.");
    expect(r.out).toContain("run `sipcode limits` to see whether a limit may have shrunk");
    expect(r.out).not.toContain("---- paste into a GitHub issue");
    expect(r.out).not.toMatch(/[\u2013\u2014]/);
  });

  it("--bug-report adds one GitHub-ready section per finding, token counts only", async () => {
    const r = await run({ bugReport: true }, dataset(true));
    expect(r.out).toContain("---- paste into a GitHub issue (review it first) ----");
    expect(r.out).toContain("### Prompt cache missing on back-to-back turns");
    expect(r.out).toContain("**Detected by** sipcode regress 1.7.2 from local logs only (no data left the machine).");
    expect(r.out).toContain("**Affected Claude Code versions (from my logs):** 2.1.100 to 2.1.105");
    expect(r.out).toContain("**Affected Codex versions (from my logs):** 0.142.0");
    expect(r.out).toContain("**Matches known issue:** R2 --resume full prompt-cache miss");
    expect(r.out).not.toContain(HOME);
  });

  it("--json --bug-report carries the block; without findings it is null", async () => {
    const dirty = JSON.parse((await run({ json: true, bugReport: true }, dataset(true))).out);
    expect(dirty.bugReport).toContain("### Codex rate limit drains faster per token");
    const clean = JSON.parse((await run({ json: true, bugReport: true }, dataset(false))).out);
    expect(clean.bugReport).toBeNull();
    const plain = JSON.parse((await run({ json: true }, dataset(true))).out);
    expect("bugReport" in plain).toBe(false);
  });
});

describe("sipcode regress: nothing read is never a clean result", () => {
  it("no logs at all: exit 2, 'Nothing to analyse', both folders named", async () => {
    const r = await run({}, new InMemoryFs());
    expect(r.exitCode).toBe(2);
    expect(r.out).toMatch(/Not found or not readable: [\\/]home[\\/]u[\\/]\.claude[\\/]projects/);
    expect(r.out).toMatch(/Not found or not readable: [\\/]home[\\/]u[\\/]\.codex[\\/]sessions/);
    expect(r.out).toContain("Nothing to analyse: no Claude Code or Codex requests could be read. This is NOT a clean result.");
    expect(r.out).not.toContain("No regressions detected");
  });

  it("--json: exit 2 and access.nothingRead", async () => {
    const r = await run({ json: true }, new InMemoryFs());
    expect(r.exitCode).toBe(2);
    const j = JSON.parse(r.out);
    expect(j.access.nothingRead).toBe(true);
    expect(j.access.missingDirs).toHaveLength(2);
    expect(j.findings).toEqual([]);
  });

  it("a sandbox that blocks the Claude Code folder: counted, warned, and exit 2 when nothing else is readable", async () => {
    const mem = new InMemoryFs();
    addClaudeDataset(mem, { dirty: true });
    const fs = blocked(mem, (p) => p.startsWith("/home/u/.claude"));
    const r = await run({ agent: "claude-code" }, fs);
    expect(r.exitCode).toBe(2);
    expect(r.out).toContain("WARNING: 1 log file(s) or folder(s) could not be read.");
    expect(r.out).toContain("If this runs inside a sandbox (for example Codex), allow read access to");
    expect(r.out).toContain("This is NOT a clean result.");
  });

  it("an unreadable file is counted and the result is marked partial", async () => {
    const mem = dataset(false);
    const fs = blocked(mem, (p) => p.endsWith("sess0002-0000-4000-8000-000000000000.jsonl"));
    const r = await run({ json: true }, fs);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.out).access.unreadableFiles).toBe(1);
    const t = await run({}, fs);
    expect(t.out).toContain("WARNING: 1 log file(s) or folder(s) could not be read.");
  });

  it("logs with too little data: not a clean result either", async () => {
    const fs = new InMemoryFs();
    addClaudeSession(fs, "only-0000-4000-8000-000000000000", "2.1.200", "claude-opus-4-8", healthy(10));
    const r = await run({}, fs);
    expect(r.exitCode).toBe(0);
    expect(r.out).toContain(
      "Not enough data to compare versions yet: Claude Code needs 2 versions with 20 or more requests each, Codex needs 2 versions with 200,000 or more tokens on the same plan and limit window. This is not a clean result.",
    );
    expect(r.out).not.toContain("No regressions detected");
    expect(JSON.parse((await run({ json: true }, fs)).out).comparable).toBe(false);
  });
});

describe("sipcode regress: flags", () => {
  it("--agent codex reads only Codex; --agent claude-code only Claude Code", async () => {
    const fs = dataset(true);
    const cx = JSON.parse((await run({ json: true, agent: "codex" }, fs)).out);
    expect(cx.agents).toEqual(["codex"]);
    expect(cx.coverage.claudeCode).toBeNull();
    expect(cx.findings.map((f: { id: string }) => f.id)).toEqual(["codex-limit-burn"]);
    const cc = JSON.parse((await run({ json: true, agent: "claude-code" }, fs)).out);
    expect(cc.agents).toEqual(["claude-code"]);
    expect(cc.coverage.codex).toBeNull();
    expect(cc.findings).toHaveLength(5);
  });

  it("--agent cursor stops with E009; an unknown agent is rejected", async () => {
    const c = await run({ agent: "cursor" }, dataset(false));
    expect(c.exitCode).toBe(1);
    expect(c.err).toContain("[E009] sipcode regress reads Claude Code and Codex logs only.");
    const u = await run({ agent: "gemini" }, dataset(false));
    expect(u.exitCode).toBe(1);
    expect(u.err).toContain("gemini");
  });

  it("--min-n must be a whole number from 1 to 1000", async () => {
    for (const bad of ["0", "abc", "2.5", "1001"]) {
      const r = await run({ minN: bad }, dataset(false));
      expect(r.exitCode, bad).toBe(1);
      expect(r.err, bad).toContain(`[E010] couldn't parse --min-n "${bad}".`);
    }
    const ok = JSON.parse((await run({ json: true, minN: "40" }, dataset(false))).out);
    expect(ok.minN).toBe(40);
  });

  it("a larger --min-n drops versions below it from the tables", async () => {
    const fs = dataset(true);
    const low = JSON.parse((await run({ json: true, minN: "20" }, fs)).out);
    const high = JSON.parse((await run({ json: true, minN: "500" }, fs)).out);
    expect(low.checks.claudeCode.warmCacheMiss.length).toBeGreaterThan(0);
    expect(high.checks.claudeCode.warmCacheMiss).toEqual([]);
  });
});

describe("sipcode regress: Codex", () => {
  it("a rise with no request on this computer is left out (other devices)", async () => {
    const fs = new InMemoryFs();
    addCodexDataset(fs, { dirty: false });
    // Another device's use: a reading in week 1 rising 30% with no local request before it.
    const id = "0199a000-0000-7000-8000-0000000000ff";
    fs.writeFile(
      `${HOME}/.codex/sessions/2026/06/09/rollout-other-${id}.jsonl`,
      [
        JSON.stringify({ timestamp: "2026-06-08T00:30:00.000Z", type: "session_meta", payload: { id, session_id: id, cwd: "/x", cli_version: "0.141.0" } }),
        JSON.stringify({
          timestamp: "2026-06-08T00:30:00.000Z",
          type: "event_msg",
          payload: { type: "token_count", info: null, rate_limits: { limit_id: "codex", plan_type: "plus", primary: { used_percent: 30, window_minutes: 10080, resets_at: Date.parse("2026-06-15T00:00:00Z") / 1000 }, secondary: null } },
        }),
      ].join("\n"),
      Date.parse("2026-06-08T00:31:00Z"),
    );
    const j = JSON.parse((await run({ json: true, agent: "codex" }, fs)).out);
    expect(j.findings).toEqual([]);
  });

  it("the table carries percent, work tokens and percent per 1M for each group", async () => {
    const j = JSON.parse((await run({ json: true, agent: "codex" }, dataset(true))).out);
    const rows = j.checks.codex;
    expect(rows.map((r: { version: string }) => r.version)).toEqual(["0.140.0", "0.141.0", "0.142.0"]);
    for (const r of rows) {
      expect(r).toMatchObject({ model: "gpt-5.5", plan: "plus", limitId: "codex", windowMinutes: 10080 });
      expect(r.percentPerMillion).toBeCloseTo(r.percent / (r.workTokens / 1e6), 9);
    }
    expect(rows[2].percentPerMillion / rows[1].percentPerMillion).toBeGreaterThan(2);
  });

  it("a version that ran another model says the model may explain it", async () => {
    const fs = new InMemoryFs();
    addCodexRollout(fs, "0199a000-0000-7000-8000-0000000000a1", "0.140.0", 0, 2);
    addCodexRollout(fs, "0199a000-0000-7000-8000-0000000000a2", "0.141.0", 1, 2.2);
    addCodexRollout(fs, "0199a000-0000-7000-8000-0000000000a3", "0.142.0", 2, 25, { model: "gpt-6.1-sol" });
    const j = JSON.parse((await run({ json: true, agent: "codex" }, fs)).out);
    expect(j.findings).toHaveLength(1);
    expect(j.findings[0].note).toContain("This version ran a different model than your other versions; the model may explain the difference.");
  });
});

describe("sipcode regress: Claude Code session text helper", () => {
  it("writes one user and one assistant line per turn", () => {
    expect(claudeSessionText("s", "2.1.1", "m", healthy(3)).trim().split("\n")).toHaveLength(6);
  });
});
