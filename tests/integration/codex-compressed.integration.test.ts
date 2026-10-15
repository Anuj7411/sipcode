/**
 * Codex compresses older rollouts to rollout-*.jsonl.zst (mtimes kept). A
 * Codex home where some or all rollouts are compressed gives exactly the
 * output of the same home with every rollout plain: stats, today, forecast,
 * limits, why and regress, JSON and terminal, stdout and stderr, byte for
 * byte. Between them these runs use every reader of a session log:
 * discovery's line 1, the full parse, the request-key scan of files outside a
 * window, the limit-reading scan, regress and why (auto-pick and --session),
 * plus the usage cache (cold and warm).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import zlib from "node:zlib";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import { runStats } from "../../src/commands/stats.js";
import { runTodayCmd } from "../../src/commands/today.js";
import { runForecastCmd } from "../../src/commands/forecast.js";
import { runLimits } from "../../src/commands/limits.js";
import { runWhy } from "../../src/commands/why.js";
import { runRegress } from "../../src/commands/regress.js";
import { runReceipt } from "../../src/commands/receipt.js";
import { runDriftCommand } from "../../src/commands/drift.js";
import type { UsageCaches } from "../../src/modules/agents/usageSessions.js";
import { memCache, type MemCache } from "../modules/agents/memCache.js";
import {
  addCodexRollout,
  addShrinkScenario,
  addWeeklyLimitScenario,
  CODEX_SESSIONS,
  codexRollout,
  LIMITS_SESSION_A,
  LIMITS_SHRINK_SESSION,
  solTurn,
  withoutZstd,
  zstdSkipMessage,
} from "./codex-fixtures.js";
import { addCodexDataset } from "./regress-fixtures.js";

const NOW = new Date("2026-10-09T10:00:00.000Z");
const compress = (s: string): Buffer =>
  (zlib as unknown as { zstdCompressSync: (b: Buffer) => Buffer }).zstdCompressSync(Buffer.from(s, "utf8"));

let savedTz: string | undefined;
beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = "UTC";
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

/** Records every file a scenario writes, so the same home can be laid out plain or compressed. */
class Recorder extends InMemoryFs {
  readonly files: Array<{ p: string; content: string; mtimeMs: number }> = [];
  override writeFile(p: string, content: string, mtimeMs = 0): void {
    this.files.push({ p, content, mtimeMs });
    super.writeFile(p, content, mtimeMs);
  }
}

function scenario(): Recorder {
  const fs = new Recorder();
  addWeeklyLimitScenario(fs); // limits, today, why
  addShrinkScenario(fs); // limits history, files outside today's window (key scan)
  addCodexDataset(fs, { dirty: true }); // regress finding (June)
  addCodexRollout(fs, "cx-may", [solTurn("2026-05-19T10:00:00Z"), solTurn("2026-05-19T10:05:00Z")]);
  // Session A resumed today in a second log: A's requests copied, plus one new
  // request. A (outside today's window) keeps the copied requests whichever
  // log is compressed: read by key scan for the period commands, by
  // dropCopiedRequests for why / receipt.
  const a = fs.files.find((f) => f.p.includes(LIMITS_SESSION_A))!;
  const extra = codexRollout("resumed-a", "C:\\work\\sipcode", [solTurn("2026-10-09T09:30:00.000Z", 70_000, 2_000)])
    .split("\n")
    .slice(1)
    .join("\n");
  fs.writeFile(
    `${CODEX_SESSIONS}/2026/10/09/rollout-2026-10-09T09-30-00-resumed-a.jsonl`,
    `${a.content.trimEnd()}\n${extra}`,
    Date.parse("2026-10-09T09:31:00.000Z"),
  );
  fs.writeFile(
    `${CODEX_SESSIONS}/2026/10/09/rollout-2026-10-09T09-00-00-today.jsonl`,
    codexRollout("today-1", "/home/u/my-app", [solTurn("2026-10-09T09:00:00.000Z", 40_000, 900)]),
    Date.parse("2026-10-09T09:01:00.000Z"),
  );
  return fs;
}

type Layout = "plain" | "mixed" | "compressed" | "both";

/** The scenario with rollouts plain, every other one compressed, all compressed, or each in both forms. */
function home(layout: Layout): InMemoryFs {
  const fs = new InMemoryFs();
  scenario().files.forEach((f, i) => {
    const rollout = /\/rollout-[^/]*\.jsonl$/.test(f.p);
    const zst = rollout && (layout === "compressed" || layout === "both" || (layout === "mixed" && i % 2 === 0));
    if (!zst || layout === "both") fs.writeFile(f.p, f.content, f.mtimeMs);
    if (zst) fs.writeBytes(`${f.p}.zst`, compress(f.content), f.mtimeMs);
  });
  return fs;
}

const deps = (fs: InMemoryFs, extra: { usageCaches?: UsageCaches } = {}) => {
  const out: string[] = [];
  const d = {
    fs,
    env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
    clock: new FakeClock(NOW),
    stdout: (s: string) => out.push(s),
    stderr: (s: string) => out.push(`stderr: ${s}`),
    writeFile: async () => {},
    ...extra,
  };
  return { d, out };
};

type Cmd = (fs: InMemoryFs, json: boolean, extra?: { usageCaches?: UsageCaches }) => Promise<string>;

const cmd =
  (run: (json: boolean, d: ReturnType<typeof deps>["d"]) => Promise<{ exitCode: number }>): Cmd =>
  async (fs, json, extra) => {
    const { d, out } = deps(fs, extra);
    const r = await run(json, d);
    return `exit ${r.exitCode}\n${out.join("\n")}`;
  };

const COMMANDS: Array<[string, Cmd]> = [
  ["stats --since all", cmd((json, d) => runStats({ json, agent: "codex", since: "all", cwd: "/w" }, d))],
  ["today", cmd((json, d) => runTodayCmd({ json, agent: "codex", cwd: "/w" }, d))],
  ["forecast", cmd((json, d) => runForecastCmd({ json, agent: "codex", cwd: "/w" }, d))],
  ["limits --since all", cmd((json, d) => runLimits({ json, since: "all", cwd: "/w" }, d))],
  ["why (newest)", cmd((json, d) => runWhy({ json, agent: "codex", cwd: "/w" }, d))],
  ["why --session", cmd((json, d) => runWhy({ json, agent: "codex", session: LIMITS_SHRINK_SESSION.slice(0, 13), cwd: "/w" }, d))],
  ["regress", cmd((json, d) => runRegress({ json, agent: "codex", cwd: "/w", bugReport: true }, d))],
  // Two logs of session A: the newest is reported with the requests the other one keeps dropped.
  ["why --session (copied log)", cmd((json, d) => runWhy({ json, agent: "codex", session: LIMITS_SESSION_A, cwd: "/w" }, d))],
  ["receipt --session (copied log)", cmd((json, d) => runReceipt({ json: true, agent: "codex", session: LIMITS_SESSION_A, cwd: "/w", noShare: true }, d))],
  ["drift", cmd((json, d) => runDriftCommand({ json, agent: "codex", noCache: true, cwd: "/w" }, { ...d, now: NOW, stateDir: "/home/u/.sipcode/drift", configPaths: [] }))],
];

describe("Codex logs compressed (.jsonl.zst) read exactly like plain ones", { timeout: 30_000 }, () => {
  for (const [name, run] of COMMANDS) {
    it(`${name}: identical output for plain, mixed, all-compressed and both-forms homes`, async () => {
      for (const json of [true, false]) {
        const plain = await run(home("plain"), json);
        expect(plain).not.toMatch(/stderr: .*(could not be read|compressed Codex log)/);
        for (const layout of ["mixed", "compressed", "both"] as const) {
          expect(await run(home(layout), json), `${layout}, json=${json}`).toBe(plain);
        }
      }
    });
  }

  it("the reports are real ones (sessions, limit history, a regress finding)", async () => {
    const statsOut = (await COMMANDS[0]![1](home("compressed"), true)).split("\n").slice(1);
    const stats = JSON.parse(statsOut.filter((l) => !l.startsWith("stderr: ")).join("\n"));
    // 10 rollouts.
    expect(stats.sessionCount).toBe(10);
    const limits = JSON.parse((await COMMANDS[3]![1](home("compressed"), true)).split("\n").slice(1).join("\n"));
    expect(limits.windows[0].possibleCut).toEqual({ at: "2026-09-15", factor: 4 });
    const regress = JSON.parse((await COMMANDS[6]![1](home("compressed"), true)).split("\n").slice(1).join("\n"));
    expect(regress.findings.length).toBeGreaterThan(0);
    expect(regress.access.skippedCompressed).toBe(0);
  });

  it("the usage cache serves compressed logs: cold and warm runs match, and a warm forecast decodes none", async () => {
    const files = new Map<string, MemCache>();
    const caches: UsageCaches = (id) => {
      if (!files.has(id)) files.set(id, memCache());
      return files.get(id)!;
    };
    const fs = home("compressed");
    let bytesRead = 0;
    const spy = Object.create(fs, {
      readBytes: { value: async (p: string) => (bytesRead++, fs.readBytes(p)) },
    }) as InMemoryFs;
    const forecast = COMMANDS[2]![1];
    const today = COMMANDS[1]![1];
    const expected = await forecast(home("plain"), true);
    expect(await forecast(spy, true, { usageCaches: caches })).toBe(expected);
    expect(files.get("codex")!.text).toContain(".jsonl.zst");
    const before = bytesRead;
    expect(await forecast(spy, true, { usageCaches: caches })).toBe(expected);
    // Discovery still reads line 1 of each log; no full read of a compressed log.
    expect(bytesRead - before).toBe(countRollouts());
    expect(await today(spy, true, { usageCaches: caches })).toBe(await today(home("plain"), true));
  });

  it("on a Node.js without zstd: compressed logs are skipped with a note naming the Node version needed", async () => {
    const out = await withoutZstd(() => COMMANDS[0]![1](home("mixed"), false));
    const n = scenario().files.filter((f, i) => /\/rollout-[^/]*\.jsonl$/.test(f.p) && i % 2 === 0).length;
    expect(out).toContain(`[E009] ${zstdSkipMessage(n)}`);
    const reg = await withoutZstd(() => COMMANDS[6]![1](home("mixed"), false));
    expect(reg).toContain(`note: ${zstdSkipMessage(n)}`);
  });
});

function countRollouts(): number {
  return scenario().files.filter((f) => /\/rollout-[^/]*\.jsonl$/.test(f.p)).length;
}
