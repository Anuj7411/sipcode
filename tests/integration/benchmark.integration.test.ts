import { describe, expect, it } from "vitest";
import { runBenchmark } from "../../src/commands/benchmark.js";
import { defaultCorpusDir } from "../../src/modules/benchmark/corpus.js";
import { FakeClock } from "../../src/lib/clock.js";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (s: string) => out.push(s),
    stderr: (s: string) => err.push(s),
  };
}

describe("sipcode benchmark integration", () => {
  it("--list prints all 10 task ids and exits 0", async () => {
    const c = capture();
    const r = await runBenchmark(
      { list: true },
      {
        stdout: c.stdout,
        stderr: c.stderr,
        clock: new FakeClock(new Date("2026-05-20T00:00:00Z")),
      },
    );
    expect(r.exitCode).toBe(0);
    const joined = c.out.join("\n");
    for (let n = 1; n <= 10; n++) {
      expect(joined).toContain(`BT${String(n).padStart(3, "0")}`);
    }
  });

  it("full run lands the median in a credible band (25-80%)", async () => {
    const c = capture();
    const r = await runBenchmark(
      { json: true },
      {
        stdout: c.stdout,
        stderr: c.stderr,
        clock: new FakeClock(new Date("2026-05-20T00:00:00Z")),
      },
    );
    expect(r.exitCode).toBe(0);
    const json = JSON.parse(c.out.join("\n"));
    expect(json.taskCount).toBe(10);
    const median = json.headline.medianSavingsPct;
    expect(median).toBeGreaterThan(25);
    expect(median).toBeLessThan(80);
  });

  it("--task BT001 runs a single task and exits 0", async () => {
    const c = capture();
    const r = await runBenchmark(
      { task: "BT001", json: true },
      {
        stdout: c.stdout,
        stderr: c.stderr,
        clock: new FakeClock(new Date("2026-05-20T00:00:00Z")),
      },
    );
    expect(r.exitCode).toBe(0);
    const json = JSON.parse(c.out.join("\n"));
    expect(json.taskCount).toBe(1);
    expect(json.tasks[0].id).toBe("BT001");
  });

  it("--task BT999 errors with brand-voice message", async () => {
    const c = capture();
    const r = await runBenchmark(
      { task: "BT999" },
      {
        stdout: c.stdout,
        stderr: c.stderr,
        clock: new FakeClock(new Date("2026-05-20T00:00:00Z")),
      },
    );
    expect(r.exitCode).toBe(1);
    expect(c.err.join("\n")).toContain("BT999");
  });

  it("--quick runs 3 tasks", async () => {
    const c = capture();
    const r = await runBenchmark(
      { quick: true, json: true },
      {
        stdout: c.stdout,
        stderr: c.stderr,
        clock: new FakeClock(new Date("2026-05-20T00:00:00Z")),
      },
    );
    expect(r.exitCode).toBe(0);
    const json = JSON.parse(c.out.join("\n"));
    expect(json.taskCount).toBe(3);
  });

  it("two runs against the live corpus produce byte-identical JSON", async () => {
    const c1 = capture();
    const c2 = capture();
    const clock = () => new FakeClock(new Date("2026-05-20T00:00:00Z"));
    await runBenchmark({ json: true }, { stdout: c1.stdout, stderr: c1.stderr, clock: clock() });
    await runBenchmark({ json: true }, { stdout: c2.stdout, stderr: c2.stderr, clock: clock() });
    expect(c1.out.join("\n")).toBe(c2.out.join("\n"));
  });
});
