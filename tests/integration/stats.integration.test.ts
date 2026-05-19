import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStats } from "../../src/commands/stats.js";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";

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
