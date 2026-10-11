/**
 * `sipcode today` adds one Codex limit line in the terminal, and nothing else
 * changes: without limit readings the output is byte-identical, and --json
 * never carries the line.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runTodayCmd } from "../../src/commands/today.js";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import { addWeeklyLimitScenario } from "./codex-fixtures.js";

const NOW = new Date("2026-10-09T10:00:00.000Z");
const LINE = "Codex weekly limit: 62% used, resets Wed 08:30. At this pace you run out Sat ~16:00.";

let savedTz: string | undefined;
beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = "UTC";
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

async function run(opts: Parameters<typeof runTodayCmd>[0], fs: InMemoryFs, now = NOW) {
  const out: string[] = [];
  const err: string[] = [];
  const r = await runTodayCmd(opts, {
    fs,
    env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
    clock: new FakeClock(now),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  });
  return { exitCode: r.exitCode, out: out.join("\n"), err: err.join("\n") };
}

function scenario(readings: boolean): InMemoryFs {
  const fs = new InMemoryFs();
  addWeeklyLimitScenario(fs, { readings });
  return fs;
}

describe("today: Codex limit line", () => {
  it("the Codex output ends with the line for the limit closest to running out", async () => {
    const r = await run({}, scenario(true));
    expect(r.exitCode).toBe(0);
    expect(r.out.split("\n").at(-1)).toBe(LINE);
  });

  it("the line is the only difference from the same requests without limit readings", async () => {
    const withLine = await run({}, scenario(true));
    const without = await run({}, scenario(false));
    expect(without.out).not.toContain("Codex weekly limit");
    expect(withLine.out).toBe(`${without.out}\n${LINE}`);
    expect(withLine.err).toBe(without.err);
  });

  it("--json is unchanged by limit readings", async () => {
    const withLine = await run({ json: true }, scenario(true));
    const without = await run({ json: true }, scenario(false));
    expect(withLine.out).toBe(without.out);
    expect(withLine.out).not.toContain("limit");
  });

  it("no line once the window has reset since its newest reading", async () => {
    const later = new Date("2026-10-15T00:00:00.000Z");
    const withReadings = await run({}, scenario(true), later);
    const without = await run({}, scenario(false), later);
    expect(withReadings.out).toBe(without.out);
  });

  it("an empty Codex home: --agent codex prints the plain no-data report", async () => {
    const fs = new InMemoryFs();
    fs.mkdir("/home/u/.codex/sessions");
    const r = await run({ agent: "codex" }, fs);
    expect(r.exitCode).toBe(0);
    expect(r.out).toBe(
      ["sipcode today · today", "", "  No Codex sessions found yet. Run `codex` in any project to start."].join("\n"),
    );
  });

  it("--agent claude-code never shows the line", async () => {
    const r = await run({ agent: "claude-code" }, scenario(true));
    expect(r.out).not.toContain("Codex weekly limit");
  });
});
