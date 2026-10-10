/**
 * Logs Sipcode skipped (compressed, unreadable) are reported in --json mode
 * too: on stderr, as stats does, so the JSON on stdout stays unchanged.
 */
import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import { runTodayCmd } from "../../src/commands/today.js";
import { runForecastCmd } from "../../src/commands/forecast.js";
import { runTrend } from "../../src/commands/trend.js";
import { runImpactCommand } from "../../src/commands/impact.js";
import { addCodexRollout, CODEX_SESSIONS, solTurn } from "./codex-fixtures.js";

const NOTE = "note: 1 compressed Codex log(s) (.jsonl.zst) skipped: Sipcode cannot read compressed logs yet.";

function logs(): InMemoryFs {
  const fs = new InMemoryFs();
  addCodexRollout(fs, "cx1", [solTurn("2026-05-19T10:00:00Z")]);
  fs.writeFile(`${CODEX_SESSIONS}/2026/05/09/rollout-a.jsonl.zst`, "z", 1);
  return fs;
}

type Cmd = (fs: InMemoryFs, d: object) => Promise<{ exitCode: number }>;
const cmds: Array<[string, Cmd]> = [
  ["today", (fs, d) => runTodayCmd({ json: true, agent: "codex", cwd: "/w" }, { fs, ...d })],
  ["forecast", (fs, d) => runForecastCmd({ json: true, agent: "codex", cwd: "/w" }, { fs, ...d })],
  ["trend", (fs, d) => runTrend({ json: true, agent: "codex", cwd: "/w" }, { fs, ...d })],
  ["impact", (fs, d) => runImpactCommand({ json: true, agent: "codex", cwd: "/nonexistent-sipcode-notes" }, { fs, ...d })],
];

describe("--json: discovery notes go to stderr", () => {
  for (const [name, run] of cmds) {
    it(name, async () => {
      const out: string[] = [];
      const err: string[] = [];
      const r = await run(logs(), {
        env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
        clock: new FakeClock(new Date("2026-05-20T12:00:00Z")),
        stdout: (s: string) => out.push(s),
        stderr: (s: string) => err.push(s),
      });
      expect(r.exitCode).toBe(0);
      expect(err).toContain(NOTE);
      expect(() => JSON.parse(out.join("\n"))).not.toThrow();
    });
  }
});
