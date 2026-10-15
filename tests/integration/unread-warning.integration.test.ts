/**
 * Logs Sipcode could not read (compressed logs on a Node.js without zstd,
 * damaged or unreadable files) are impossible to miss: in the terminal, every
 * period and single-session command prints a `warning:` line at the top of
 * stdout; with --json, the notes stay on stderr and the JSON is unchanged.
 * When nothing is skipped, every output is byte-identical to before (golden
 * file recorded before the warning existed).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import { FakeClipboard } from "../../src/lib/clipboard.js";
import { runStats } from "../../src/commands/stats.js";
import { runTodayCmd } from "../../src/commands/today.js";
import { runForecastCmd } from "../../src/commands/forecast.js";
import { runTrend } from "../../src/commands/trend.js";
import { runImpactCommand } from "../../src/commands/impact.js";
import { runWhy } from "../../src/commands/why.js";
import { runReceipt } from "../../src/commands/receipt.js";
import { runDriftCommand } from "../../src/commands/drift.js";
import { runLimits } from "../../src/commands/limits.js";
import { runRegress } from "../../src/commands/regress.js";
import type { StoreIO } from "../../src/modules/drift/store.js";
import type { UsageCaches } from "../../src/modules/agents/usageSessions.js";
import { memCache } from "../modules/agents/memCache.js";
import {
  addCodexRollout,
  addShrinkScenario,
  addWeeklyLimitScenario,
  CODEX_SESSIONS,
  solTurn,
  withoutZstd,
} from "./codex-fixtures.js";
import { addClaudeDataset, addCodexDataset } from "./regress-fixtures.js";

const NOW = new Date("2026-10-09T10:00:00.000Z");

let savedTz: string | undefined;
beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = "UTC";
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

/** Claude Code and Codex logs: limits, regress data for both tools, today's sessions. */
function home<F extends InMemoryFs>(fs: F = new InMemoryFs() as F): F {
  addClaudeDataset(fs, { dirty: true });
  addCodexDataset(fs, { dirty: true });
  addWeeklyLimitScenario(fs);
  addShrinkScenario(fs);
  addCodexRollout(fs, "cx-may", [solTurn("2026-05-19T10:00:00Z"), solTurn("2026-05-19T10:05:00Z")]);
  return fs;
}

/** Two extra compressed Codex logs: skipped without zstd, damaged (unreadable) with it. */
function withBadZst<F extends InMemoryFs>(fs: F): F {
  fs.writeFile(`${CODEX_SESSIONS}/2026/05/09/rollout-a.jsonl.zst`, "z", Date.parse("2026-05-09T10:00:00Z"));
  fs.writeFile(`${CODEX_SESSIONS}/2026/05/09/rollout-b.jsonl.zst`, "z", Date.parse("2026-05-09T11:00:00Z"));
  return fs;
}

function memStoreIO(): StoreIO {
  const files = new Map<string, string>();
  return {
    async read(p) {
      return files.get(p) ?? null;
    },
    async write(p, c) {
      files.set(p, c);
    },
    async append(p, c) {
      files.set(p, (files.get(p) ?? "") + c);
    },
  };
}

interface Out {
  readonly exitCode: number;
  readonly out: string[];
  readonly err: string[];
}

type Run = (fs: InMemoryFs, json: boolean, agent: string | undefined) => Promise<Out>;

function io(fs: InMemoryFs) {
  const out: string[] = [];
  const err: string[] = [];
  const caches = new Map<string, ReturnType<typeof memCache>>();
  const usageCaches: UsageCaches = (id) => {
    if (!caches.has(id)) caches.set(id, memCache());
    return caches.get(id)!;
  };
  return {
    out,
    err,
    d: {
      fs,
      env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
      clock: new FakeClock(NOW),
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
      usageCaches,
    },
  };
}

const run =
  (f: (json: boolean, agent: string | undefined, d: ReturnType<typeof io>["d"]) => Promise<{ exitCode: number }>): Run =>
  async (fs, json, agent) => {
    const c = io(fs);
    const r = await f(json, agent, c.d);
    return { exitCode: r.exitCode, out: c.out, err: c.err };
  };

const cwd = "/nonexistent-sipcode-unread";

const COMMANDS: Array<[string, Run]> = [
  ["stats", run((json, agent, d) => runStats({ json, agent, since: "all", cwd }, { ...d, writeFile: async () => {} }))],
  ["today", run((json, agent, d) => runTodayCmd({ json, agent, cwd }, d))],
  ["forecast", run((json, agent, d) => runForecastCmd({ json, agent, cwd }, d))],
  ["trend", run((json, agent, d) => runTrend({ json, agent, cwd }, d))],
  ["impact", run((json, agent, d) => runImpactCommand({ json, agent, cwd }, d))],
  ["why", run((json, agent, d) => runWhy({ json, agent, cwd }, d))],
  [
    "receipt",
    run((json, agent, d) =>
      runReceipt({ json, agent, cwd, htmlOnly: true, noShare: true }, { ...d, clipboard: new FakeClipboard(), writeFile: async () => {} }),
    ),
  ],
  [
    "drift",
    run((json, agent, d) =>
      runDriftCommand(
        { json, agent, cwd, noCache: true },
        { ...d, now: NOW, homeDir: "/home/u", stateDir: "/state", storeIO: memStoreIO(), configPaths: [], configReader: async () => null },
      ),
    ),
  ],
  ["limits", run((json, agent, d) => runLimits({ json, agent, since: "all", cwd }, d))],
  ["regress", run((json, agent, d) => runRegress({ json, agent, cwd, bugReport: true }, d))],
];

/** Every command, terminal and JSON, both tools and each one alone (limits: Codex only). */
const CASES: Array<{ name: string; run: Run; json: boolean; agent: string | undefined }> = COMMANDS.flatMap(([name, r]) =>
  [false, true].flatMap((json) =>
    (name === "limits" ? [undefined, "codex"] : [undefined, "codex", "claude-code"]).map((agent) => ({
      name: `${name}${agent ? ` --agent ${agent}` : ""}${json ? " --json" : ""}`,
      run: r,
      json,
      agent,
    })),
  ),
);

/** stdout as lines (a command may print several lines in one write). */
const lines = (o: Out): string[] => o.out.join("\n").split("\n");

const show = (o: Out): string => [`exit ${o.exitCode}`, ...o.out, ...o.err.map((l) => `stderr: ${l}`)].join("\n");

describe("nothing skipped: output byte-identical to before", { timeout: 60_000 }, () => {
  it("every command, terminal and JSON", async () => {
    const all: string[] = [];
    for (const c of CASES) all.push(`=== ${c.name}`, show(await c.run(home(), c.json, c.agent)));
    await expect(all.join("\n") + "\n").toMatchFileSnapshot("./__golden__/unread-warning-clean.txt");
  });
});

const SKIPPED = (n: number): string =>
  `warning: ${n} Codex log file(s) could not be read (compressed .jsonl.zst logs need Node.js 22.15 or newer; you have ${process.version}). Numbers below leave them out.`;
const DAMAGED = (n: number): string =>
  `warning: ${n} Codex log file(s) could not be read (unreadable or damaged). Numbers below leave them out.`;
const SKIPPED_NOTE = (n: number): string =>
  `note: ${n} compressed Codex log(s) (.jsonl.zst) skipped: reading them needs Node.js 22.15 or newer (you have ${process.version}).`;
const DAMAGED_NOTE = (n: number): string => `note: ${n} transcript file(s) could not be read or parsed; totals exclude them.`;

/** Does this case read the Codex logs? (JSON shows one tool: Claude Code when both are installed.) */
function readsCodex(c: (typeof CASES)[number]): boolean {
  const name = c.name.split(" ")[0]!;
  if (c.agent === "codex" || name === "limits") return true;
  if (c.agent === "claude-code") return false;
  return !c.json || name === "regress";
}

for (const [label, wrap, warning, note] of [
  ["a Node.js without zstd: compressed logs skipped", withoutZstd, SKIPPED, SKIPPED_NOTE],
  ["damaged compressed logs (Node.js with zstd)", <T>(f: () => Promise<T>) => f(), DAMAGED, DAMAGED_NOTE],
] as const) {
  describe(`unread Codex logs, ${label}`, { timeout: 60_000 }, () => {
    for (const c of CASES) {
      it(c.name, async () => {
        const clean = await c.run(home(), c.json, c.agent);
        const r = await wrap(() => c.run(withBadZst(home()), c.json, c.agent));
        const cmd = c.name.split(" ")[0]!;
        expect(r.exitCode).toBe(clean.exitCode);
        if (!readsCodex(c)) {
          // The Codex logs are not read: nothing changes.
          expect(r).toEqual(clean);
          return;
        }
        if (!c.json) {
          // Terminal: the warning is the first line of stdout, then a blank line, then the usual output.
          const got = lines(r);
          expect(got[0]).toBe(warning(2));
          expect(got[1]).toBe("");
          expect(got.filter((l) => l.startsWith("warning:"))).toEqual([warning(2)]);
          if (cmd === "stats") {
            // Its own `warnings (N):` list under the Codex section stays as before.
            const noList = (ls: string[]) => ls.filter((l) => l !== "" && !/^warnings \(\d+\):$|^  · \[E\d+\] /.test(l));
            expect(noList(got.slice(2))).toEqual(noList(lines(clean)));
          } else if (cmd === "regress") {
            // Its WARNING line under the coverage (sandbox advice) stays as before.
            expect(got.slice(2).filter((l) => !l.startsWith("WARNING: "))).toEqual(lines(clean));
          } else {
            expect(got.slice(2)).toEqual(lines(clean));
          }
          // Not repeated as a small note on stderr.
          expect(r.err.join("\n")).not.toMatch(/compressed Codex log|could not be read or parsed/);
          expect(r.err).toEqual(clean.err);
          return;
        }
        // --json: stdout is unchanged JSON (stats keeps its warnings array); notes go to stderr.
        expect(r.out.join("\n")).not.toContain("warning:");
        if (cmd === "stats") {
          const j = JSON.parse(r.out.join("\n"));
          expect(j.warnings.length).toBe(JSON.parse(clean.out.join("\n")).warnings.length + 1);
          expect(r.err).toEqual(clean.err);
          return;
        }
        if (cmd === "regress") {
          // Same JSON; only its `access` counts name the skipped logs.
          const { access, ...rest } = JSON.parse(r.out.join("\n"));
          const { access: cleanAccess, ...cleanRest } = JSON.parse(clean.out.join("\n"));
          expect(rest).toEqual(cleanRest);
          expect(Object.keys(access)).toEqual(Object.keys(cleanAccess));
        } else {
          expect(r.out).toEqual(clean.out);
        }
        const both = cmd === "regress" && c.agent === undefined;
        expect(r.err).toContain(both ? `Codex: ${note(2)}` : note(2));
      });
    }
  });
}

describe("unread logs: the cases where the warning matters most", () => {
  it("limits: every Codex log skipped prints the warning before 'no readings'", async () => {
    const fs = new InMemoryFs();
    fs.writeFile(`${CODEX_SESSIONS}/2026/05/09/rollout-a.jsonl.zst`, "z", 1);
    const r = await withoutZstd(() => COMMANDS.find(([n]) => n === "limits")![1](fs, false, undefined));
    expect(lines(r)).toEqual([SKIPPED(1), "", "no Codex limit readings found yet (Codex records them after each request)."]);
  });

  it("why --agent codex: every Codex log skipped prints the warning on stdout before the error", async () => {
    const fs = new InMemoryFs();
    fs.writeFile(`${CODEX_SESSIONS}/2026/05/09/rollout-a.jsonl.zst`, "z", 1);
    const r = await withoutZstd(() => COMMANDS.find(([n]) => n === "why")![1](fs, false, "codex"));
    expect(r.exitCode).toBe(1);
    expect(lines(r)).toEqual([SKIPPED(1), ""]);
    expect(r.err.length).toBeGreaterThan(0);
  });

  it("stats --agent codex: every Codex log skipped is not a brand-new user without a warning", async () => {
    const fs = new InMemoryFs();
    fs.writeFile(`${CODEX_SESSIONS}/2026/05/09/rollout-a.jsonl.zst`, "z", 1);
    const r = await withoutZstd(() => COMMANDS.find(([n]) => n === "stats")![1](fs, false, "codex"));
    expect(lines(r)[0]).toBe(SKIPPED(1));
  });

  it("skipped and unreadable in one run: one line each, exact counts", async () => {
    // A plain rollout whose line 1 reads but whose full read fails (a file locked or cut off mid-read).
    const locked = `${CODEX_SESSIONS}/2026/05/10/rollout-2026-05-10T10-00-00-c.jsonl`;
    class LockedFs extends InMemoryFs {
      override async readFile(p: string): Promise<string> {
        if (p.replace(/\\/g, "/") === locked) throw Object.assign(new Error(`EBUSY: ${p}`), { code: "EBUSY" });
        return super.readFile(p);
      }
    }
    const locking = withBadZst(home(new LockedFs()));
    addCodexRollout(locking, "c", [solTurn("2026-05-10T10:00:00Z")]);
    const r = await withoutZstd(() => COMMANDS.find(([n]) => n === "today")![1](locking, false, "codex"));
    expect(lines(r).slice(0, 3)).toEqual([
      SKIPPED(2),
      "warning: 1 Codex log file(s) could not be read (unreadable or damaged). Numbers below leave them out.",
      "",
    ]);
  });
});
