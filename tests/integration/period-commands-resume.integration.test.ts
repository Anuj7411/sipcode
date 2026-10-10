/**
 * today / forecast / trend must count a request that a resumed session file
 * repeats from its original exactly once (11.4% over-count on real data).
 */
import { describe, expect, it } from "vitest";
import { runTodayCmd } from "../../src/commands/today.js";
import { runForecastCmd } from "../../src/commands/forecast.js";
import { runTrend } from "../../src/commands/trend.js";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";

const NOW = new Date("2026-05-19T09:07:00.000Z");
const DIR = "/home/u/.claude/projects/C--p";

function makeEnv(): FakeProcessEnv {
  return new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } });
}

function req(id: string, ts: string): string {
  return JSON.stringify({
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
}

const ms = (iso: string) => new Date(iso).getTime();

async function run<T>(
  fn: (deps: {
    fs: InMemoryFs;
    env: FakeProcessEnv;
    clock: FakeClock;
    stdout: (s: string) => void;
    stderr: (s: string) => void;
  }) => Promise<T>,
  fs: InMemoryFs,
): Promise<{ result: T; out: string }> {
  const out: string[] = [];
  const result = await fn({
    fs,
    env: makeEnv(),
    clock: new FakeClock(NOW),
    stdout: (s) => out.push(s),
    stderr: () => {},
  });
  return { result, out: out.join("\n") };
}

describe("today: resumed sessions are not double counted", () => {
  const T1 = "2026-05-19T09:00:00.000Z";
  const T2 = "2026-05-19T09:02:00.000Z";

  it("counts a request repeated in a resumed file once", async () => {
    const fs = new InMemoryFs();
    fs.writeFile(`${DIR}/orig.jsonl`, req("1", T1), ms("2026-05-19T09:01:00Z"));
    fs.writeFile(`${DIR}/resumed.jsonl`, [req("1", T1), req("2", T2)].join("\n"), ms("2026-05-19T09:03:00Z"));
    const { result, out } = await run((d) => runTodayCmd({ json: true }, d), fs);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(out).today.totalTokens).toBe(2_000_000);
  });

  it("an older original still removes its copy from a newer resumed file", async () => {
    const fs = new InMemoryFs();
    fs.writeFile(`${DIR}/orig.jsonl`, req("1", "2026-02-01T10:00:00.000Z"), ms("2026-02-01T10:05:00Z"));
    fs.writeFile(
      `${DIR}/resumed.jsonl`,
      [req("1", "2026-02-01T10:00:00.000Z"), req("2", T2)].join("\n"),
      ms("2026-05-19T09:03:00Z"),
    );
    const { result, out } = await run((d) => runTodayCmd({ json: true }, d), fs);
    expect(result.exitCode).toBe(0);
    // orig.jsonl is a real (old) session of 1M; resumed contributes only request 2 (1M, today).
    expect(JSON.parse(out).today.totalTokens).toBe(1_000_000);
  });
});

describe("forecast: resumed sessions are not double counted", () => {
  // forecast needs >= 7 days of history, so a filler session 10 days back exists in every case.
  const filler = (fs: InMemoryFs) =>
    fs.writeFile(`${DIR}/filler.jsonl`, req("f", "2026-05-09T10:00:00.000Z"), ms("2026-05-09T10:05:00Z"));

  async function spendSoFar(fs: InMemoryFs): Promise<number> {
    const { result, out } = await run((d) => runForecastCmd({ json: true }, d), fs);
    expect(result.exitCode).toBe(0);
    const j = JSON.parse(out);
    expect(j.status).toBe("ok");
    return j.monthEnd.spendSoFarUSD as number;
  }

  it("counts a request repeated in a resumed file once", async () => {
    const T1 = "2026-05-18T10:00:00.000Z";
    const T2 = "2026-05-18T10:02:00.000Z";
    const resumedFs = new InMemoryFs();
    filler(resumedFs);
    resumedFs.writeFile(`${DIR}/orig.jsonl`, req("1", T1), ms("2026-05-18T10:01:00Z"));
    resumedFs.writeFile(`${DIR}/resumed.jsonl`, [req("1", T1), req("2", T2)].join("\n"), ms("2026-05-18T10:03:00Z"));
    const singleFs = new InMemoryFs();
    filler(singleFs);
    singleFs.writeFile(`${DIR}/one.jsonl`, [req("1", T1), req("2", T2)].join("\n"), ms("2026-05-18T10:03:00Z"));
    const resumed = await spendSoFar(resumedFs);
    const single = await spendSoFar(singleFs);
    expect(single).toBeGreaterThan(0);
    expect(resumed).toBeCloseTo(single, 10);
  });

  it("an older original still removes its copy from a newer resumed file", async () => {
    const T2 = "2026-05-18T10:02:00.000Z";
    const resumedFs = new InMemoryFs();
    filler(resumedFs);
    resumedFs.writeFile(`${DIR}/orig.jsonl`, req("1", "2026-04-01T10:00:00.000Z"), ms("2026-04-01T10:05:00Z"));
    resumedFs.writeFile(
      `${DIR}/resumed.jsonl`,
      [req("1", "2026-04-01T10:00:00.000Z"), req("2", T2)].join("\n"),
      ms("2026-05-18T10:03:00Z"),
    );
    const singleFs = new InMemoryFs();
    filler(singleFs);
    singleFs.writeFile(`${DIR}/orig.jsonl`, req("1", "2026-04-01T10:00:00.000Z"), ms("2026-04-01T10:05:00Z"));
    singleFs.writeFile(`${DIR}/resumed.jsonl`, req("2", T2), ms("2026-05-18T10:03:00Z"));
    const resumed = await spendSoFar(resumedFs);
    const single = await spendSoFar(singleFs);
    expect(single).toBeGreaterThan(0);
    expect(resumed).toBeCloseTo(single, 10);
  });
});

describe("trend: resumed sessions are not double counted", () => {
  async function windowTokens(fs: InMemoryFs): Promise<number> {
    const { result, out } = await run(
      (d) => runTrend({ json: true, since: "30d", metric: "output-ratio" }, d),
      fs,
    );
    expect(result.exitCode).toBe(0);
    const j = JSON.parse(out) as { days: { denominator: number }[] };
    return j.days.reduce((sum, d) => sum + d.denominator, 0);
  }

  it("counts a request repeated in a resumed file once", async () => {
    const T1 = "2026-05-10T10:00:00.000Z";
    const T2 = "2026-05-10T10:02:00.000Z";
    const fs = new InMemoryFs();
    fs.writeFile(`${DIR}/orig.jsonl`, req("1", T1), ms("2026-05-10T10:01:00Z"));
    fs.writeFile(`${DIR}/resumed.jsonl`, [req("1", T1), req("2", T2)].join("\n"), ms("2026-05-10T10:03:00Z"));
    expect(await windowTokens(fs)).toBe(2_000_000);
  });

  it("an out-of-window original (mtime before --since) still removes its copy", async () => {
    const fs = new InMemoryFs();
    // 100 days before NOW: only key-scanned, never returned.
    fs.writeFile(`${DIR}/orig.jsonl`, req("1", "2026-02-01T10:00:00.000Z"), ms("2026-02-01T10:05:00Z"));
    fs.writeFile(
      `${DIR}/resumed.jsonl`,
      [req("1", "2026-02-01T10:00:00.000Z"), req("2", "2026-05-10T10:00:00.000Z")].join("\n"),
      ms("2026-05-10T10:05:00Z"),
    );
    expect(await windowTokens(fs)).toBe(1_000_000);
  });
});
