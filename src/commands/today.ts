/**
 * `sipcode today` — daily dashboard.
 *
 * Thin orchestrator: discover sessions → parse → analyze → aggregate → runToday.
 * Mirrors the pattern in `stats.ts` and `trend.ts`.
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import { discoveryNotes, loadSessions } from "../modules/agents/loadSessions.js";
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
} from "../modules/transcript/analyzers/tokens.js";
import { analyzeDuplicateReads } from "../modules/transcript/analyzers/duplicateReads.js";
import { runToday, toLocalDay, type TodaySession } from "../modules/today/runToday.js";
import { formatTodayTerminal } from "../modules/today/format-terminal.js";
import { formatTodayJson } from "../modules/today/format-json.js";

export interface TodayOptions {
  json?: boolean;
  agent?: string;
  cwd?: string;
  here?: boolean;
}

export interface TodayDeps {
  fs?: FileSystem;
  clock?: Clock;
  env?: ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

export interface TodayExit {
  readonly exitCode: 0 | 1;
}

export async function runTodayCmd(
  opts: TodayOptions = {},
  deps: TodayDeps = {},
): Promise<TodayExit> {
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
    run: (agent) => todayForAgent(agent, { opts, fs, env, clock, cwd }),
  });
  return { exitCode };
}

interface TodayContext {
  readonly opts: TodayOptions;
  readonly fs: FileSystem;
  readonly env: ProcessEnv;
  readonly clock: Clock;
  readonly cwd: string;
}

/** One agent's today report, returned as ordered output instead of printed. */
async function todayForAgent(agent: Agent, ctx: TodayContext): Promise<SectionResult> {
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

  // No windowSinceMs here on purpose: the runners derive "days of history"
  // (baseline tier, forecast eligibility) from the EARLIEST session, so dropping
  // old files would change the report status, not just speed it up.
  const loaded = await loadSessions({
    agent,
    deps: { fs, env, clock },
    cwd: ctx.cwd,
    here: opts.here,
  });
  if (!loaded.ok) {
    stderr(loaded.error.map((e: { message: string }) => e.message).join("\n"));
    return o.result(1);
  }
  if (!opts.json) for (const n of discoveryNotes(loaded.value)) stderr(n);

  const sessions: TodaySession[] = [];
  // Unpriced tokens behind "spend so far": today's sessions only.
  let unpriced = NO_UNPRICED;
  const todayLocal = toLocalDay(now);
  for (const { meta, parsed } of loaded.value.sessions) {
    const startedAt = parsed.startedAt ?? new Date(meta.mtimeMs).toISOString();

    const tokens = analyzeTokens(parsed, pricing);
    if (isEmptySession(tokens)) continue;
    if (toLocalDay(new Date(startedAt)) === todayLocal) {
      unpriced = addUnpriced(unpriced, analyzeUnpriced(parsed, pricing));
    }
    const dups = analyzeDuplicateReads(parsed);
    const totalTokens =
      tokens.inputTokens +
      tokens.outputTokens +
      tokens.cacheReadTokens +
      tokens.cacheCreationTokens;
    const top = dups.topOffenders[0];
    const session: TodaySession = {
      sessionId: meta.sessionId,
      startedAt,
      totalTokens,
      outputTokens: tokens.outputTokens,
      estCostUSD: tokens.estCostUSD,
      duplicateReadTokenCost: dups.duplicateReadTokenCost,
      topDuplicateReadFile: top
        ? {
            path: top.filePath,
            count: top.readCount,
            // Convert tokens to USD using session's average $/token (rough but fine for a "top leak" headline).
            costUSD: totalTokens > 0 ? (top.duplicateTokenCost / totalTokens) * tokens.estCostUSD : 0,
          }
        : undefined,
    };
    sessions.push(session);
  }

  const report = runToday({ sessions, now, agent: agentLabel(agent) });
  const hasUnpriced = unpriced.requests > 0;
  if (opts.json) {
    stdout(formatTodayJson(report));
  } else {
    stdout(
      formatTodayTerminal(report, {
        unpricedNote: hasUnpriced ? MESSAGES.unpricedTokens(unpriced) : undefined,
      }),
    );
  }
  return o.result(0, {
    totals:
      report.today === null
        ? undefined
        : { tokens: report.today.totalTokens, usd: report.today.totalSpendUSD, unpriced: hasUnpriced },
  });
}
