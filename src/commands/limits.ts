/**
 * `sipcode limits`: Codex usage limits, read from the readings Codex writes
 * into its own logs after each request. Zero network calls.
 *
 * Thin orchestrator: readings (loadCodexReadings) + requests (loadSessions)
 * → buildLimitsReport → terminal or JSON. Codex only: Claude Code's logs do
 * not record limits, so --agent claude-code (or cursor) is E009.
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import { MESSAGES } from "../lib/messages.js";
import { parseAgentFlag } from "../modules/agents/cli.js";
import { isWithinFolder } from "../modules/agents/codex/adapter.js";
import { discoveryNotes, loadSessions } from "../modules/agents/loadSessions.js";
import { getAgentById } from "../modules/agents/registry.js";
import { defaultUsageCaches, type UsageCaches } from "../modules/agents/usageSessions.js";
import { parseSince } from "../modules/stats/window.js";
import type { LimitRequest } from "../modules/limits/attribute.js";
import { formatLimitsJson } from "../modules/limits/format-json.js";
import { formatLimitsTerminal } from "../modules/limits/format-terminal.js";
import { limitRequests, loadCodexReadings } from "../modules/limits/load.js";
import { buildLimitsReport } from "../modules/limits/report.js";

export interface LimitsOptions {
  json?: boolean;
  /** How far back the tokens-per-1% history goes. Default 90d. */
  since?: string;
  /** Narrow only the "what used it" list to sessions in the current folder. */
  here?: boolean;
  agent?: string;
  cwd?: string;
}

export interface LimitsDeps {
  fs?: FileSystem;
  clock?: Clock;
  env?: ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  /** Usage cache per agent. Default: defaultUsageCaches. */
  usageCaches?: UsageCaches;
}

export interface LimitsExit {
  readonly exitCode: 0 | 1;
}

export async function runLimits(opts: LimitsOptions = {}, deps: LimitsDeps = {}): Promise<LimitsExit> {
  const fs = deps.fs ?? new RealFileSystem();
  const clock = deps.clock ?? new RealClock();
  const env = deps.env ?? new RealProcessEnv();
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s + "\n"));

  const agent = parseAgentFlag(opts.agent);
  if (!agent.ok) {
    stderr(agent.message);
    return { exitCode: 1 };
  }
  if (agent.selector !== "auto" && agent.selector !== "codex") {
    stderr(MESSAGES.limitsCodexOnly());
    return { exitCode: 1 };
  }
  const now = clock.now();
  const rawSince = opts.since ?? "90d";
  const since = parseSince(rawSince, now);
  if (!since.ok) {
    stderr(MESSAGES.statsBadSince(rawSince, "limits"));
    return { exitCode: 1 };
  }
  const empty = (): LimitsExit => {
    stdout(opts.json ? formatLimitsJson(null) : MESSAGES.limitsNoReadings);
    return { exitCode: 0 };
  };

  const agentDeps = { fs, env, clock };
  const scan = await loadCodexReadings(agentDeps);
  if (scan.malformed > 0) stderr(MESSAGES.limitsMalformed(scan.malformed));
  if (scan.readings.length === 0) return empty();

  const cwd = opts.cwd ?? process.cwd();
  const loaded = await loadSessions({
    agent: getAgentById("codex"),
    deps: agentDeps,
    cwd,
    cache: (deps.usageCaches ?? defaultUsageCaches(fs, env))("codex"),
    needsToolCalls: () => false,
    analyze: limitRequests,
  });
  if (!loaded.ok) {
    stderr(loaded.error.map((e) => e.message).join("\n"));
    return { exitCode: 1 };
  }
  for (const n of discoveryNotes(loaded.value)) stderr(n);
  const requests: LimitRequest[] = [];
  for (const s of loaded.value.sessions) for (const r of s.value) requests.push(r);

  const report = buildLimitsReport({
    readings: scan.readings,
    requests,
    now,
    sinceMs: Date.parse(since.value.sinceIso),
    include: opts.here ? (r) => r.cwd !== undefined && isWithinFolder(r.cwd, cwd) : undefined,
  });
  if (report === null) return empty();
  stdout(opts.json ? formatLimitsJson(report) : formatLimitsTerminal(report, now));
  return { exitCode: 0 };
}
