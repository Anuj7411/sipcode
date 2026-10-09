import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStats } from "../../src/commands/stats.js";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import { addCodexRollout, autoReviewTurn, CODEX_SESSIONS, solTurn } from "./codex-fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, "../fixtures/transcripts");
const loadFixture = (n: string) => readFileSync(path.join(fixtures, n), "utf-8");

const NOW = new Date("2026-05-19T12:00:00.000Z");

function makeEnv(): FakeProcessEnv {
  return new FakeProcessEnv({
    homeDir: "/home/u",
    platform: "linux",
    vars: { NO_COLOR: "1" },
  });
}

function makeFs(): InMemoryFs {
  const fs = new InMemoryFs();
  // Three sessions across two projects, all within the last 30 days.
  fs.writeFile(
    "/home/u/.claude/projects/C--Projects-Sipcode/minimal01.jsonl",
    loadFixture("minimal-2turn.jsonl"),
    new Date("2026-05-01T10:00:45Z").getTime(),
  );
  fs.writeFile(
    "/home/u/.claude/projects/C--Projects-Sipcode/readheavy1.jsonl",
    loadFixture("read-heavy.jsonl"),
    new Date("2026-05-02T09:00:30Z").getTime(),
  );
  fs.writeFile(
    "/home/u/.claude/projects/other-proj/multimodel.jsonl",
    loadFixture("multi-model.jsonl"),
    new Date("2026-05-03T08:01:10Z").getTime(),
  );
  return fs;
}

describe("runStats integration", () => {
  it("--json returns a sipcode-stats/1 envelope for the last 30 days", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const result = await runStats(
      { json: true, since: "30d" },
      {
        fs: makeFs(),
        env: makeEnv(),
        clock: new FakeClock(NOW),
        stdout: (s) => out.push(s),
        stderr: (s) => err.push(s),
      },
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(out.join("\n"));
    expect(parsed.schemaVersion).toBe("sipcode-stats/1");
    expect(parsed.sessionCount).toBe(3);
    expect(parsed.byProject.length).toBeGreaterThanOrEqual(2);
    expect(parsed.topExpensive.length).toBeGreaterThan(0);
    expect(parsed.trendDaily.length).toBe(30);
  });

  it("--json output is byte-identical across two runs (idempotence)", async () => {
    const env = makeEnv();
    const fs1 = makeFs();
    const fs2 = makeFs();
    const out1: string[] = [];
    const out2: string[] = [];
    await runStats(
      { json: true, since: "30d" },
      { fs: fs1, env, clock: new FakeClock(NOW), stdout: (s) => out1.push(s), stderr: () => {} },
    );
    await runStats(
      { json: true, since: "30d" },
      { fs: fs2, env, clock: new FakeClock(NOW), stdout: (s) => out2.push(s), stderr: () => {} },
    );
    expect(out1.join("\n")).toBe(out2.join("\n"));
  });

  it("--since 7d narrows the window", async () => {
    const out: string[] = [];
    const result = await runStats(
      { json: true, since: "7d" },
      {
        fs: makeFs(),
        env: makeEnv(),
        clock: new FakeClock(NOW),
        stdout: (s) => out.push(s),
        stderr: () => {},
      },
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(out.join("\n"));
    // None of the fixture sessions are within the last 7 days of NOW.
    expect(parsed.sessionCount).toBe(0);
    expect(parsed.trendDaily.length).toBe(7);
  });

  it("--since all surfaces all-time sessions", async () => {
    const out: string[] = [];
    const result = await runStats(
      { json: true, since: "all" },
      {
        fs: makeFs(),
        env: makeEnv(),
        clock: new FakeClock(NOW),
        stdout: (s) => out.push(s),
        stderr: () => {},
      },
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(out.join("\n"));
    expect(parsed.sessionCount).toBe(3);
  });

  it("bad --since emits brand-voice E010", async () => {
    const err: string[] = [];
    const result = await runStats(
      { since: "zzz" },
      {
        fs: makeFs(),
        env: makeEnv(),
        clock: new FakeClock(NOW),
        stdout: () => {},
        stderr: (s) => err.push(s),
      },
    );
    expect(result.exitCode).toBe(1);
    const joined = err.join("\n");
    expect(joined).toContain("[E010]");
    expect(joined).toContain("why:");
    expect(joined).toContain("fix:");
    expect(joined).toContain("next:");
  });

  it("--top must be a positive integer", async () => {
    const err: string[] = [];
    const result = await runStats(
      { top: "0", since: "30d" },
      {
        fs: makeFs(),
        env: makeEnv(),
        clock: new FakeClock(NOW),
        stdout: () => {},
        stderr: (s) => err.push(s),
      },
    );
    expect(result.exitCode).toBe(1);
    expect(err.join("\n")).toContain("[E010]");
  });

  it("--group-by rejects unknown values", async () => {
    const err: string[] = [];
    const result = await runStats(
      { groupBy: "frog", since: "30d" },
      {
        fs: makeFs(),
        env: makeEnv(),
        clock: new FakeClock(NOW),
        stdout: () => {},
        stderr: (s) => err.push(s),
      },
    );
    expect(result.exitCode).toBe(1);
    expect(err.join("\n")).toContain("[E010]");
  });

  it("--agent cursor exits with E009 cleanly", async () => {
    const err: string[] = [];
    const result = await runStats(
      { agent: "cursor", since: "30d" },
      {
        fs: makeFs(),
        env: makeEnv(),
        clock: new FakeClock(NOW),
        stdout: () => {},
        stderr: (s) => err.push(s),
      },
    );
    expect(result.exitCode).toBe(1);
    expect(err.join("\n")).toContain("[E009]");
  });

  it("--agent garbage exits 1 with brand-voice unknown-agent", async () => {
    const err: string[] = [];
    const result = await runStats(
      { agent: "frogcoder", since: "30d" },
      {
        fs: makeFs(),
        env: makeEnv(),
        clock: new FakeClock(NOW),
        stdout: () => {},
        stderr: (s) => err.push(s),
      },
    );
    expect(result.exitCode).toBe(1);
    expect(err.join("\n").toLowerCase()).toContain("unknown agent");
  });

  it("missing projects dir emits brand-voice E003", async () => {
    const err: string[] = [];
    const result = await runStats(
      { since: "30d" },
      {
        fs: new InMemoryFs(),
        env: makeEnv(),
        clock: new FakeClock(NOW),
        stdout: () => {},
        stderr: (s) => err.push(s),
      },
    );
    expect(result.exitCode).toBe(1);
    expect(err.join("\n")).toContain("[E003]");
  });

  it("empty projects dir (brand-new user) is a friendly exit 0, not a false 'transcripts exist'", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const fs = new InMemoryFs();
    fs.mkdir("/home/u/.claude/projects"); // dir exists, but holds no transcripts
    const result = await runStats(
      { since: "30d" },
      {
        fs,
        env: makeEnv(),
        clock: new FakeClock(NOW),
        stdout: (s) => out.push(s),
        stderr: (s) => err.push(s),
      },
    );
    expect(result.exitCode).toBe(0);
    expect(out.join("\n")).toContain("no Claude Code sessions found yet");
    // Must NOT claim transcripts exist when none do.
    expect(out.join("\n")).not.toContain("transcripts exist");
  });

  it("--here scopes to the cwd's project (shared filter used by today/forecast/trend/impact too)", async () => {
    // makeFs seeds 2 sessions under C--Projects-Sipcode + 1 under other-proj.
    const all: string[] = [];
    await runStats(
      { json: true, since: "all" },
      {
        fs: makeFs(),
        env: makeEnv(),
        clock: new FakeClock(NOW),
        stdout: (s) => all.push(s),
        stderr: () => {},
      },
    );
    expect(JSON.parse(all.join("\n")).sessionCount).toBe(3);

    // cwd "C:\Projects\Sipcode" hashes to "C--Projects-Sipcode" → only its 2.
    const here: string[] = [];
    await runStats(
      { json: true, since: "all", here: true, cwd: "C:\\Projects\\Sipcode" },
      {
        fs: makeFs(),
        env: makeEnv(),
        clock: new FakeClock(NOW),
        stdout: (s) => here.push(s),
        stderr: () => {},
      },
    );
    expect(JSON.parse(here.join("\n")).sessionCount).toBe(2);
  });

  it("--html writes .sipcode/stats.html via injected writeFile", async () => {
    const wrote: { path: string; content: string } = { path: "", content: "" };
    const out: string[] = [];
    const result = await runStats(
      { since: "30d", html: true, cwd: "/work/proj" },
      {
        fs: makeFs(),
        env: makeEnv(),
        clock: new FakeClock(NOW),
        stdout: (s) => out.push(s),
        stderr: () => {},
        writeFile: async (p, c) => {
          wrote.path = p;
          wrote.content = c;
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(wrote.path.replace(/\\/g, "/")).toBe("/work/proj/.sipcode/stats.html");
    expect(wrote.content).toContain("<!doctype html>");
  });

  it("terminal default output prints a sparkline + cost summary", async () => {
    const out: string[] = [];
    const result = await runStats(
      { since: "30d" },
      {
        fs: makeFs(),
        env: makeEnv(),
        clock: new FakeClock(NOW),
        stdout: (s) => out.push(s),
        stderr: () => {},
      },
    );
    expect(result.exitCode).toBe(0);
    const joined = out.join("\n");
    expect(joined).toContain("sipcode stats");
    expect(joined).toContain("est. total cost:");
    expect(joined).toContain("trend: token spend per day");
  });

  it("--group-by project surfaces per-project totals", async () => {
    const out: string[] = [];
    const result = await runStats(
      { since: "30d", groupBy: "project" },
      {
        fs: makeFs(),
        env: makeEnv(),
        clock: new FakeClock(NOW),
        stdout: (s) => out.push(s),
        stderr: () => {},
      },
    );
    expect(result.exitCode).toBe(0);
    expect(out.join("\n")).toContain("per-project totals:");
  });
});

describe("runStats: resumed sessions are not double counted", () => {
  it("counts a request repeated in a resumed file once", async () => {
    const fs = new InMemoryFs();
    const req = (id: string) =>
      JSON.stringify({
        type: "assistant",
        requestId: `req_${id}`,
        timestamp: "2026-05-10T10:00:00.000Z",
        sessionId: "s",
        message: {
          id: `msg_${id}`,
          model: "claude-opus-4-8",
          role: "assistant",
          content: [{ type: "text", text: "." }],
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 1_000_000,
            cache_creation_input_tokens: 0,
          },
        },
      });
    const t = new Date("2026-05-10T10:05:00Z").getTime();
    fs.writeFile("/home/u/.claude/projects/C--p/orig.jsonl", req("1"), t);
    fs.writeFile("/home/u/.claude/projects/C--p/resumed.jsonl", [req("1"), req("2")].join("\n"), t);
    const out: string[] = [];
    const r = await runStats(
      { json: true, since: "30d" },
      { fs, env: makeEnv(), clock: new FakeClock(NOW), stdout: (s) => out.push(s), stderr: () => {} },
    );
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(out.join("\n"));
    expect(j.totals.totalTokens).toBe(2_000_000);
  });

  it("an out-of-window original still removes its copy from a newer resumed file", async () => {
    const fs = new InMemoryFs();
    const req = (id: string, ts: string) =>
      JSON.stringify({
        type: "assistant",
        requestId: `req_${id}`,
        timestamp: ts,
        sessionId: "s",
        message: {
          id: `msg_${id}`,
          model: "claude-opus-4-8",
          role: "assistant",
          content: [{ type: "text", text: "." }],
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 1_000_000,
            cache_creation_input_tokens: 0,
          },
        },
      });
    // Original last written 100 days before NOW: outside --since 30d, key-scanned only.
    fs.writeFile(
      "/home/u/.claude/projects/C--p/orig.jsonl",
      req("1", "2026-02-01T10:00:00.000Z"),
      new Date("2026-02-01T10:05:00Z").getTime(),
    );
    fs.writeFile(
      "/home/u/.claude/projects/C--p/resumed.jsonl",
      [req("1", "2026-02-01T10:00:00.000Z"), req("2", "2026-05-10T10:00:00.000Z")].join("\n"),
      new Date("2026-05-10T10:05:00Z").getTime(),
    );
    const out: string[] = [];
    const r = await runStats(
      { json: true, since: "30d" },
      { fs, env: makeEnv(), clock: new FakeClock(NOW), stdout: (s) => out.push(s), stderr: () => {} },
    );
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(out.join("\n"));
    expect(j.totals.totalTokens).toBe(1_000_000);
  });
});

describe("runStats: Claude Code and Codex sections", () => {
  const run = async (opts: Parameters<typeof runStats>[0], fs: InMemoryFs) => {
    const out: string[] = [];
    const err: string[] = [];
    const r = await runStats(opts, {
      fs,
      env: makeEnv(),
      clock: new FakeClock(NOW),
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    });
    return { exitCode: r.exitCode, out: out.join("\n"), err: err.join("\n"), outLines: out };
  };
  const withCodex = (fs: InMemoryFs = makeFs()) => {
    addCodexRollout(fs, "cx1", [solTurn("2026-05-10T10:00:00Z")]);
    return fs;
  };
  const codexOnly = () => withCodex(new InMemoryFs());

  it("--html names the file by tool: stats.html for Claude Code, stats-codex.html for Codex", async () => {
    const html = async (opts: Parameters<typeof runStats>[0], fs: InMemoryFs): Promise<string[]> => {
      const paths: string[] = [];
      await runStats(
        { since: "30d", html: true, cwd: "/work/proj", ...opts },
        { fs, env: makeEnv(), clock: new FakeClock(NOW), stdout: () => {}, stderr: () => {}, writeFile: async (p) => void paths.push(p.replace(/\\/g, "/")) },
      );
      return paths;
    };
    expect(await html({ agent: "codex" }, withCodex())).toEqual(["/work/proj/.sipcode/stats-codex.html"]);
    expect(await html({}, codexOnly())).toEqual(["/work/proj/.sipcode/stats-codex.html"]);
    expect(await html({}, withCodex())).toEqual(["/work/proj/.sipcode/stats.html", "/work/proj/.sipcode/stats-codex.html"]);
    expect(await html({ agent: "claude-code" }, withCodex())).toEqual(["/work/proj/.sipcode/stats.html"]);
  });

  it("shows a Claude Code section and a Codex section, then the combined line", async () => {
    const r = await run({ since: "30d" }, withCodex());
    expect(r.exitCode).toBe(0);
    expect(r.out).toContain("── Claude Code ──");
    expect(r.out).toContain("── Codex ──");
    expect(r.out.indexOf("── Claude Code ──")).toBeLessThan(r.out.indexOf("── Codex ──"));
    expect(r.out).toMatch(/Both tools: .* tokens · ~\$.* \+ ~\$/);
    // Section headers replace the auto-detect banner.
    expect(r.out).not.toContain("detected agent:");
  });

  it("Claude Code alone is unchanged: banner, no headers, no combined line", async () => {
    const r = await run({ since: "30d" }, makeFs());
    expect(r.outLines[0]).toBe("detected agent: claude-code (auto). pass --agent to override.");
    expect(r.out).not.toContain("──");
    expect(r.out).not.toContain("Both tools");
  });

  it("works for a Codex-only user (no ~/.claude): no E003, Codex numbers", async () => {
    const r = await run({ since: "30d" }, codexOnly());
    expect(r.exitCode).toBe(0);
    expect(r.err).not.toContain("[E003]");
    expect(r.outLines[0]).toBe("detected agent: codex (auto). pass --agent to override.");
    expect(r.out).toContain("across 1 sessions you burned 1,100 tokens.");
    expect(r.out).not.toContain("──");
  });

  it("Cursor + Codex without Claude Code logs shows Codex alone (terminal and JSON)", async () => {
    const fs = codexOnly();
    fs.mkdir("/home/u/.cursor");
    const r = await run({ since: "30d" }, fs);
    expect(r.exitCode).toBe(0);
    expect(r.outLines[0]).toBe("detected agent: codex (auto). pass --agent to override.");
    expect(r.out).toContain("across 1 sessions you burned 1,100 tokens.");
    expect(r.out).not.toContain("──");
    expect(r.err).not.toContain("[E009]");
    const json = await run({ since: "30d", json: true }, fs);
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.out).agent).toBe("codex");
    expect(json.err).toBe("");
  });

  it("a Codex section's stale-price warning is about the OpenAI table", async () => {
    const fs = new InMemoryFs();
    addCodexRollout(fs, "cx-late", [solTurn("2026-12-20T10:00:00Z")]);
    const err: string[] = [];
    await runStats(
      { since: "30d" },
      {
        fs,
        env: makeEnv(),
        // Both bundled tables are >30 days old here.
        clock: new FakeClock(new Date("2027-01-01T12:00:00Z")),
        stdout: () => {},
        stderr: (s) => err.push(s),
      },
    );
    const text = err.join("\n");
    expect(text).toContain("[E004]");
    expect(text).toContain("openai's pricing");
    expect(text).not.toContain("anthropic's pricing");
  });

  it("Cursor alone keeps its E009 (unchanged)", async () => {
    const fs = new InMemoryFs();
    fs.mkdir("/home/u/.cursor");
    const r = await run({ since: "30d" }, fs);
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain("[E009]");
  });

  it("--agent codex with no Codex logs names Codex in the empty state", async () => {
    const r = await run({ since: "30d", agent: "codex" }, new InMemoryFs());
    expect(r.exitCode).toBe(0);
    expect(r.out).toContain("no Codex sessions found yet.");
    expect(r.out).not.toContain("Claude Code");
  });

  it("an agent with no sessions in the window prints its empty message in its section and does not fail", async () => {
    const fs = makeFs();
    addCodexRollout(fs, "old", [solTurn("2026-01-10T10:00:00Z")]);
    const r = await run({ since: "30d" }, fs);
    expect(r.exitCode).toBe(0);
    const codexPart = r.out.slice(r.out.indexOf("── Codex ──"));
    expect(codexPart).toContain("no sessions found in the last 30d.");
    expect(codexPart).toContain("Codex session logs exist");
    expect(r.out).not.toContain("Both tools");
  });

  it("JSON with both installed is the unchanged Claude Code JSON plus a stderr note", async () => {
    const claudeOnly = await run({ since: "30d", json: true }, makeFs());
    const both = await run({ since: "30d", json: true }, withCodex());
    expect(both.out).toBe(claudeOnly.out);
    expect(both.err).toMatch(/--agent codex/);
    expect(claudeOnly.err).toBe("");
  });

  it("--agent codex --json is the Codex JSON", async () => {
    const r = await run({ since: "30d", json: true, agent: "codex" }, withCodex());
    const j = JSON.parse(r.out);
    expect(j.agent).toBe("codex");
    expect(j.sessionCount).toBe(1);
    expect(j.totals.totalTokens).toBe(1100);
  });

  it("names tokens on models without a price under the cost, never as $0, and keeps JSON fields", async () => {
    const fs = new InMemoryFs();
    addCodexRollout(fs, "cx1", [solTurn("2026-05-10T10:00:00Z"), autoReviewTurn("2026-05-10T10:05:00Z")]);
    const r = await run({ since: "30d" }, fs);
    const lines = r.outLines.join("\n").split("\n");
    const cost = lines.findIndex((l) => l.startsWith("est. total cost:"));
    expect(lines[cost]).toBe("est. total cost: $0.0030");
    expect(lines[cost + 1]).toBe(
      "20,503 tokens on models without a known price (codex-auto-review): not included in the cost above.",
    );
    const json = await run({ since: "30d", json: true }, fs);
    const j = JSON.parse(json.out);
    expect(j.totals.estCostUSD).toBe(0.003);
    expect(Object.keys(j)).toEqual(Object.keys(JSON.parse((await run({ since: "30d", json: true }, makeFs())).out)));
    expect(json.out).not.toContain("codex-auto-review");
  });

  it("the combined line marks the part with unpriced tokens", async () => {
    const fs = makeFs();
    addCodexRollout(fs, "cx1", [solTurn("2026-05-10T10:00:00Z"), autoReviewTurn("2026-05-10T10:05:00Z")]);
    const r = await run({ since: "30d" }, fs);
    expect(r.out).toMatch(/Both tools: .* \+ ~\$0\.00 \(\+ unpriced\)$/m);
  });

  it("reports skipped compressed Codex logs as one line, apart from unreadable files", async () => {
    const fs = codexOnly();
    fs.writeFile(`${CODEX_SESSIONS}/2026/05/11/rollout-a.jsonl.zst`, "z", 1);
    fs.writeFile(`${CODEX_SESSIONS}/2026/05/12/rollout-b.jsonl.zst`, "z", 1);
    const r = await run({ since: "30d" }, fs);
    expect(r.out).toContain(
      "[E009] 2 compressed Codex log(s) (.jsonl.zst) skipped: Sipcode cannot read compressed logs yet.",
    );
    expect(r.out).not.toMatch(/couldn't read \d+ transcript file/);
    expect(r.out.match(/\.jsonl\.zst/g)).toHaveLength(1);
  });

  it("--since all counts days from the earliest session, not from 1970", async () => {
    const j = JSON.parse((await run({ since: "all", json: true }, makeFs())).out);
    // Earliest fixture session starts 2026-05-01; the window ends after 2026-05-19.
    expect(j.window.days).toBe(19);
    expect(j.window.sinceIso).toBe("2026-05-01T00:00:00.000Z");
    const t = await run({ since: "all" }, makeFs());
    expect(t.out).toContain("trend: token spend per day (19 days)");
  });
});
