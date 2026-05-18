import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWhy } from "../../src/commands/why.js";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, "../fixtures/transcripts");
const loadFixture = (n: string) =>
  readFileSync(path.join(fixtures, n), "utf-8");

function makeFs(): InMemoryFs {
  const fs = new InMemoryFs();
  fs.writeFile(
    "/home/u/.claude/projects/test-proj/minimal01.jsonl",
    loadFixture("minimal-2turn.jsonl"),
    new Date("2026-05-01T10:00:45Z").getTime(),
  );
  fs.writeFile(
    "/home/u/.claude/projects/test-proj/readheavy1.jsonl",
    loadFixture("read-heavy.jsonl"),
    new Date("2026-05-02T09:00:30Z").getTime(),
  );
  return fs;
}

function makeEnv(): FakeProcessEnv {
  return new FakeProcessEnv({
    homeDir: "/home/u",
    platform: "linux",
    vars: { NO_COLOR: "1" },
  });
}

describe("runWhy integration", () => {
  it("--json on most recent (read-heavy) returns valid JSON with savings", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const result = await runWhy(
      { json: true },
      {
        fs: makeFs(),
        env: makeEnv(),
        clock: new FakeClock(new Date("2026-05-15T00:00:00Z")),
        stdout: (s) => out.push(s),
        stderr: (s) => err.push(s),
      },
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(out.join("\n"));
    expect(parsed.schemaVersion).toBe("sipcode-why/1");
    expect(parsed.header.sessionIdShort).toBe("readheav");
    expect(parsed.estimatedSavings.totalTokens).toBeGreaterThan(0);
  });

  it("--list prints sessions sorted by recency", async () => {
    const out: string[] = [];
    const result = await runWhy(
      { list: true },
      {
        fs: makeFs(),
        env: makeEnv(),
        clock: new FakeClock(new Date("2026-05-15T00:00:00Z")),
        stdout: (s) => out.push(s),
        stderr: () => {},
      },
    );
    expect(result.exitCode).toBe(0);
    expect(out[0]).toContain("readheav");
    expect(out[1]).toContain("minimal0");
  });

  it("--session targets a specific session by prefix", async () => {
    const out: string[] = [];
    const result = await runWhy(
      { session: "minimal", json: true },
      {
        fs: makeFs(),
        env: makeEnv(),
        clock: new FakeClock(new Date("2026-05-15T00:00:00Z")),
        stdout: (s) => out.push(s),
        stderr: () => {},
      },
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(out.join("\n"));
    expect(parsed.header.sessionIdShort).toBe("minimal0");
  });

  it("missing projects dir emits brand-voice E003 error", async () => {
    const err: string[] = [];
    const result = await runWhy(
      {},
      {
        fs: new InMemoryFs(),
        env: makeEnv(),
        clock: new FakeClock(new Date("2026-05-15T00:00:00Z")),
        stdout: () => {},
        stderr: (s) => err.push(s),
      },
    );
    expect(result.exitCode).toBe(1);
    const joined = err.join("\n");
    expect(joined).toContain("[E003]");
    expect(joined).toContain("why:");
    expect(joined).toContain("fix:");
    expect(joined).toContain("next:");
  });

  it("nonexistent --session emits brand-voice error", async () => {
    const err: string[] = [];
    const result = await runWhy(
      { session: "nopenope" },
      {
        fs: makeFs(),
        env: makeEnv(),
        clock: new FakeClock(new Date("2026-05-15T00:00:00Z")),
        stdout: () => {},
        stderr: (s) => err.push(s),
      },
    );
    expect(result.exitCode).toBe(1);
    expect(err.join("\n")).toContain("[E003]");
  });

  it("stale pricing surfaces brand-voice E004", async () => {
    const err: string[] = [];
    await runWhy(
      { json: true },
      {
        fs: makeFs(),
        env: makeEnv(),
        // Way in the future → pricing is "stale".
        clock: new FakeClock(new Date("2027-01-01T00:00:00Z")),
        stdout: () => {},
        stderr: (s) => err.push(s),
      },
    );
    expect(err.join("\n")).toContain("[E004]");
  });
});
