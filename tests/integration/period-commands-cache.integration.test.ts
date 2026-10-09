/**
 * today / forecast with the usage cache: the output is the same with no
 * cache, a cold cache and a warm one, and a warm run reads only the
 * transcripts it must (forecast: none; today: today's, for duplicate reads).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTodayCmd } from "../../src/commands/today.js";
import { runForecastCmd } from "../../src/commands/forecast.js";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import type { UsageCacheIO, UsageCaches } from "../../src/modules/agents/usageSessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => readFileSync(path.resolve(__dirname, "../fixtures/transcripts", n), "utf-8");

// read-heavy.jsonl (re-reads the same files) was logged on 2026-05-02 around 09:00Z.
const NOW = new Date("2026-05-02T12:00:00.000Z");
const DIR = "/home/u/.claude/projects/C--p";

const req = (id: string, ts: string, cacheRead = 100_000) =>
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
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 10 },
    },
  });

/** 20 days of history (one resumed with a bigger copy of its original's request) plus today's read-heavy session. */
function logs(): InMemoryFs {
  const fs = new InMemoryFs();
  for (let d = 1; d <= 20; d++) {
    const day = new Date(Date.parse("2026-04-10T10:00:00Z") + d * 86_400_000);
    const ts = day.toISOString();
    fs.writeFile(`${DIR}/h${d}.jsonl`, req(`h${d}`, ts, d * 1000), day.getTime() + 60_000);
  }
  const resumedTs = new Date(Date.parse("2026-04-30T10:00:00Z")).toISOString();
  fs.writeFile(
    `${DIR}/resumed.jsonl`,
    [req("h20", new Date(Date.parse("2026-04-10T10:00:00Z") + 20 * 86_400_000).toISOString(), 99_000), req("r1", resumedTs)].join("\n"),
    Date.parse(resumedTs) + 60_000,
  );
  fs.writeFile(`${DIR}/today.jsonl`, fixture("read-heavy.jsonl"), Date.parse("2026-05-02T09:01:00Z"));
  return fs;
}

function memCaches(): UsageCaches {
  const files = new Map<string, string>();
  return (id) => {
    const io: UsageCacheIO = {
      async read() {
        return files.get(id) ?? null;
      },
      async write(c) {
        files.set(id, c);
      },
    };
    return io;
  };
}

function spy(fs: InMemoryFs): { fs: InMemoryFs; reads: string[] } {
  const reads: string[] = [];
  const s = Object.create(fs, {
    readFile: { value: async (p: string) => (reads.push(path.basename(p)), fs.readFile(p)) },
  }) as InMemoryFs;
  return { fs: s, reads };
}

type Cmd = typeof runTodayCmd | typeof runForecastCmd;

async function run(cmd: Cmd, json: boolean, fs: InMemoryFs, usageCaches?: UsageCaches): Promise<string> {
  const out: string[] = [];
  const r = await cmd(
    { json, agent: "claude-code" },
    {
      fs,
      env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
      clock: new FakeClock(NOW),
      stdout: (s) => out.push(s),
      stderr: (s) => out.push(`err: ${s}`),
      ...(usageCaches ? { usageCaches } : {}),
    },
  );
  return `${r.exitCode}\n${out.join("\n")}`;
}

describe("today / forecast with the usage cache", () => {
  for (const [name, cmd] of [["today", runTodayCmd], ["forecast", runForecastCmd]] as const) {
    it(`${name}: same output with no cache, a cold cache and a warm one`, async () => {
      for (const json of [true, false]) {
        const none = await run(cmd, json, logs());
        const caches = memCaches();
        const fs = logs();
        expect(await run(cmd, json, fs, caches)).toBe(none);
        expect(await run(cmd, json, fs, caches)).toBe(none);
      }
    });
  }

  it("the report is a real one: today has a baseline, and a top duplicate-read leak", async () => {
    const j = JSON.parse((await run(runTodayCmd, true, logs(), memCaches())).split("\n").slice(1).join("\n"));
    expect(j.status).toBe("ok");
    expect(j.today.topLeak?.kind).toBe("duplicate-reads");
    const f = JSON.parse((await run(runForecastCmd, true, logs(), memCaches())).split("\n").slice(1).join("\n"));
    expect(f.status).toBe("ok");
  });

  it("a warm forecast reads no transcript; a warm today reads only today's", async () => {
    const caches = memCaches();
    const fs = logs();
    await run(runForecastCmd, true, fs, caches);
    const s = spy(fs);
    await run(runForecastCmd, true, s.fs, caches);
    expect(s.reads).toEqual([]);
    await run(runTodayCmd, true, s.fs, caches);
    expect(s.reads).toEqual(["today.jsonl"]);
  });
});
