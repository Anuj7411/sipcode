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
  it("auto-pick skips an empty/in-flight latest session", async () => {
    const fs = new InMemoryFs();
    fs.writeFile(
      "/home/u/.claude/projects/test-proj/readheavy1.jsonl",
      loadFixture("read-heavy.jsonl"),
      new Date("2026-05-02T09:00:30Z").getTime(),
    );
    // NEWEST file, but empty — must be skipped in favour of the real one.
    fs.writeFile(
      "/home/u/.claude/projects/test-proj/empty-latest.jsonl",
      loadFixture("empty.jsonl"),
      new Date("2026-05-10T09:00:30Z").getTime(),
    );
    const out: string[] = [];
    const result = await runWhy(
      { json: true },
      {
        fs,
        env: makeEnv(),
        clock: new FakeClock(new Date("2026-05-15T00:00:00Z")),
        stdout: (s) => out.push(s),
        stderr: () => {},
      },
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(out.join("\n"));
    expect(parsed.header.sessionIdShort).toBe("readheav");
  });

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

  it("an old session priced with its own (old) table does not raise E004 while the newest table is fresh", async () => {
    // Sessions are from 2026-05 and correctly use the 2026-05-01 table, which is
    // >30 days old on 2026-10-20. Sipcode's newest table (2026-10-08) is not.
    const err: string[] = [];
    const out: string[] = [];
    await runWhy(
      { json: true },
      {
        fs: makeFs(),
        env: makeEnv(),
        clock: new FakeClock(new Date("2026-10-20T00:00:00Z")),
        stdout: (s) => out.push(s),
        stderr: (s) => err.push(s),
      },
    );
    expect(err.join("\n")).not.toContain("[E004]");
    // The report still names the table the session was priced with.
    expect(JSON.parse(out.join("\n")).metaPricing.asOf).toBe("2026-05-01");
  });

  it("E004 names the newest bundled table, not the session's table", async () => {
    const err: string[] = [];
    await runWhy(
      { json: true },
      {
        fs: makeFs(),
        env: makeEnv(),
        clock: new FakeClock(new Date("2027-01-01T00:00:00Z")),
        stdout: () => {},
        stderr: (s) => err.push(s),
      },
    );
    const text = err.join("\n");
    expect(text).toContain("[E004]");
    expect(text).toContain("file dated 2026-10-08");
  });
});
