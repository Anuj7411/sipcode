/**
 * `sipcode forecast` — projected month-end spend.
 * Mirrors `today.ts` orchestration.
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import { discoveryNotes, loadSessions } from "../modules/agents/loadSessions.js";
import { defaultUsageCaches, type UsageCaches } from "../modules/agents/usageSessions.js";
import {
  agentLabel,
  resolveDisplayAgents,
  runSections,
  SectionOutput,
  type SectionResult,
} from "../modules/agents/multi.js";
import type { Agent } from "../modules/agents/types.js";
import { MESSAGES } from "../lib/messages.js";
import { loadPricingForDate } from "../lib/pricing/load.js";
import {
  addUnpriced,
  analyzeTokens,
  analyzeUnpriced,
  isEmptySession,
  NO_UNPRICED,
  type UnpricedUsage,
} from "../modules/transcript/analyzers/tokens.js";
import { runForecast, type ForecastSession } from "../modules/forecast/runForecast.js";
import { formatForecastTerminal } from "../modules/forecast/format-terminal.js";
import { formatForecastJson } from "../modules/forecast/format-json.js";

export interface ForecastOptions {
  json?: boolean;
  agent?: string;
  cwd?: string;
  here?: boolean;
}

export interface ForecastDeps {
  fs?: FileSystem;
  clock?: Clock;
  env?: ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  /** Usage cache per agent (modules/agents/usageSessions.ts). Default: defaultUsageCaches. */
  usageCaches?: UsageCaches;
}

export interface ForecastExit {
  readonly exitCode: 0 | 1;
}

export async function runForecastCmd(
  opts: ForecastOptions = {},
  deps: ForecastDeps = {},
): Promise<ForecastExit> {
  const fs = deps.fs ?? new RealFileSystem();
  const clock = deps.clock ?? new RealClock();
  const env = deps.env ?? new RealProcessEnv();
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s + "\n"));

  const cwd = opts.cwd ?? process.cwd();
  const shown = await resolveDisplayAgents({
    agent: opts.agent,
    fs,
    env,
    clock,
    cwd,
    json: opts.json ?? false,
    stderr,
  });
  if (!shown.ok) return { exitCode: 1 };
  const exitCode = await runSections({
    agents: shown.agents,
    detect: shown.detect,
    banner: false,
    combined: true,
    stdout,
    stderr,
    run: (agent) =>
      forecastForAgent(agent, {
        opts,
        fs,
        env,
        clock,
        cwd,
        usageCaches: deps.usageCaches ?? defaultUsageCaches(fs, env),
      }),
  });
  return { exitCode };
}

interface ForecastContext {
  readonly opts: ForecastOptions;
  readonly fs: FileSystem;
  readonly env: ProcessEnv;
  readonly clock: Clock;
  readonly cwd: string;
  readonly usageCaches: UsageCaches;
}

/** One agent's forecast, returned as ordered output instead of printed. */
async function forecastForAgent(agent: Agent, ctx: ForecastContext): Promise<SectionResult> {
  const { opts, fs, env, clock } = ctx;
  const o = new SectionOutput();
  const stdout = o.out;
  const stderr = o.err;
  if (!agent.transcriptParsingSupported) {
    stderr(MESSAGES.cursorTranscriptNotSupported());
    return o.result(1);
  }
  const now = clock.now();
  const pricing = loadPricingForDate(now);

  // Every session counts (forecast eligibility comes from the EARLIEST one),
  // but only its token usage: unchanged files come from the usage cache.
  const loaded = await loadSessions({
    agent,
    deps: { fs, env, clock },
    cwd: ctx.cwd,
    here: opts.here,
    cache: ctx.usageCaches(agent.id),
    analyze: ({ meta, parsed }) => {
      const startedAt = parsed.startedAt ?? new Date(meta.mtimeMs).toISOString();
      const tokens = analyzeTokens(parsed, pricing);
      if (isEmptySession(tokens)) return null;
      return { startedAt, estCostUSD: tokens.estCostUSD, unpriced: analyzeUnpriced(parsed, pricing) };
    },
  });
  if (!loaded.ok) {
    stderr(loaded.error.map((e: { message: string }) => e.message).join("\n"));
    return o.result(1);
  }
  if (!opts.json) for (const n of discoveryNotes(loaded.value)) stderr(n);

  const sessions: ForecastSession[] = [];
  const unpricedBySession: { startedAt: string; unpriced: UnpricedUsage }[] = [];
  for (const { value } of loaded.value.sessions) {
    if (!value) continue;
    sessions.push({ startedAt: value.startedAt, estCostUSD: value.estCostUSD });
    unpricedBySession.push({ startedAt: value.startedAt, unpriced: value.unpriced });
  }

  const report = runForecast({ sessions, now, agent: agentLabel(agent) });
  // Unpriced tokens behind the projection: this month's spend and the pace window.
  let unpriced = NO_UNPRICED;
  if (report.status === "ok" && report.trajectoryInput !== null) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); // local, as runForecast
    const from = Math.min(monthStart, now.getTime() - report.trajectoryInput.windowDays * 86_400_000);
    for (const s of unpricedBySession) {
      if (Date.parse(s.startedAt) >= from) unpriced = addUnpriced(unpriced, s.unpriced);
    }
  }
  const hasUnpriced = unpriced.requests > 0;
  if (opts.json) {
    stdout(formatForecastJson(report));
  } else {
    stdout(
      formatForecastTerminal(report, {
        unpricedNote: hasUnpriced ? MESSAGES.unpricedTokens(unpriced) : undefined,
      }),
    );
  }
  return o.result(0, {
    totals:
      report.monthEnd === null
        ? undefined
        : { tokens: 0, usd: report.monthEnd.projectedSpendUSD, unpriced: hasUnpriced },
  });
}
