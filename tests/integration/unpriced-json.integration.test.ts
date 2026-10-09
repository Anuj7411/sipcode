/**
 * Tokens on a model with no known price are left out of every cost. JSON
 * consumers get the same signal as terminal readers without a schema change:
 * the CLI's --json prints the note on stderr, and MCP tools return it as an
 * extra text item after the JSON.
 */
import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import { runStats } from "../../src/commands/stats.js";
import { runTodayCmd } from "../../src/commands/today.js";
import { runForecastCmd } from "../../src/commands/forecast.js";
import { runTrend } from "../../src/commands/trend.js";
import { runImpactCommand } from "../../src/commands/impact.js";
import { runWhy } from "../../src/commands/why.js";
import { callTool } from "../../src/mcp/server.js";
import type { StoreIO } from "../../src/modules/drift/store.js";
import { addCodexRollout, autoReviewTurn, solTurn } from "./codex-fixtures.js";

const NOW = new Date("2026-05-20T12:00:00.000Z");
const NOTE = "20,503 tokens on models without a known price (codex-auto-review): not included in the cost above.";

/** Codex history with an unpriced auto-review request in today's session. */
function logs(): InMemoryFs {
  const fs = new InMemoryFs();
  addCodexRollout(fs, "cx0", [solTurn("2026-05-05T10:00:00Z", 100_000, 10_000)]);
  addCodexRollout(fs, "cx1", [solTurn("2026-05-20T10:00:00Z"), autoReviewTurn("2026-05-20T10:05:00Z")]);
  return fs;
}

const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    deps: {
      env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
      clock: new FakeClock(NOW),
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
    },
  };
};

type Cmd = (fs: InMemoryFs, c: ReturnType<typeof io>) => Promise<{ exitCode: number }>;
const cmds: Array<[string, Cmd]> = [
  ["stats", (fs, c) => runStats({ json: true, agent: "codex", since: "30d", cwd: "/w" }, { fs, ...c.deps })],
  ["today", (fs, c) => runTodayCmd({ json: true, agent: "codex", cwd: "/w" }, { fs, ...c.deps })],
  ["forecast", (fs, c) => runForecastCmd({ json: true, agent: "codex", cwd: "/w" }, { fs, ...c.deps })],
  ["trend", (fs, c) => runTrend({ json: true, agent: "codex", metric: "cost-per-session", cwd: "/w" }, { fs, ...c.deps })],
  ["impact", (fs, c) => runImpactCommand({ json: true, agent: "codex", since: "2026-05-10", cwd: "/w" }, { fs, ...c.deps })],
  ["why", (fs, c) => runWhy({ json: true, agent: "codex", cwd: "/w" }, { fs, ...c.deps })],
];

describe("--json: unpriced tokens are noted on stderr, JSON unchanged", () => {
  for (const [name, run] of cmds) {
    it(name, async () => {
      const c = io();
      const r = await run(logs(), c);
      expect(r.exitCode).toBe(0);
      expect(c.err).toContain(NOTE);
      const text = c.out.join("\n");
      expect(() => JSON.parse(text)).not.toThrow();
      expect(text).not.toContain("without a known price");
    });
  }

  it("no note when every model has a price", async () => {
    const fs = new InMemoryFs();
    addCodexRollout(fs, "cx0", [solTurn("2026-05-05T10:00:00Z", 100_000, 10_000)]);
    addCodexRollout(fs, "cx1", [solTurn("2026-05-20T10:00:00Z")]);
    for (const [name, run] of cmds) {
      const c = io();
      await run(fs, c);
      expect(c.err.join("\n"), name).not.toContain("without a known price");
    }
  });
});

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

describe("MCP tools: unpriced tokens are an extra text item, never inside the JSON", () => {
  const tools: Array<[string, Record<string, unknown>]> = [
    ["get_session_stats", { since: "30d" }],
    ["get_today_summary", {}],
    ["forecast_monthly_spend", {}],
    ["verify_sipcode_impact", { since: "2026-05-10", cwd: "/w" }],
    ["audit_latest_session", {}],
  ];
  for (const [name, args] of tools) {
    it(name, async () => {
      const r = await callTool(name, { ...args, agent: "codex" }, {
        fs: logs(),
        env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
        clock: new FakeClock(NOW),
        cwd: "/w",
        drift: { now: NOW, homeDir: "/home/u", stateDir: "/state", storeIO: memStoreIO(), configPaths: [], configReader: async () => null },
      });
      expect(r.isError ?? false).toBe(false);
      const texts = r.content.map((x) => (x.type === "text" ? x.text : ""));
      expect(texts).toContain(NOTE);
      expect(texts[0]).not.toContain("without a known price");
    });
  }
});
