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
import { discoveryNotes, loadSessions, type LoadedSession } from "../modules/agents/loadSessions.js";
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
import { analyzeDuplicateReads } from "../modules/transcript/analyzers/duplicateReads.js";
import { runToday, toLocalDay, type TodaySession } from "../modules/today/runToday.js";
import { formatTodayTerminal } from "../modules/today/format-terminal.js";
import { formatTodayJson } from "../modules/today/format-json.js";

const NO_DUPLICATES = { duplicateReadTokenCost: 0, topOffenders: [] } as const;

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
  /** Usage cache per agent (modules/agents/usageSessions.ts). Default: defaultUsageCaches. */
  usageCaches?: UsageCaches;
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
    run: (agent) =>
      todayForAgent(agent, {
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

interface TodayContext {
  readonly opts: TodayOptions;
  readonly fs: FileSystem;
  readonly env: ProcessEnv;
  readonly clock: Clock;
  readonly cwd: string;
  readonly usageCaches: UsageCaches;
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

  // Every session counts (the baseline tier comes from the EARLIEST one), but
  // only its token usage; tool calls (duplicate reads) only for today's
  // sessions. Unchanged files come from the usage cache.
  const todayLocal = toLocalDay(now);
  const isToday = (s: LoadedSession): boolean =>
    toLocalDay(new Date(s.parsed.startedAt ?? new Date(s.meta.mtimeMs).toISOString())) === todayLocal;
  const loaded = await loadSessions({
    agent,
    deps: { fs, env, clock },
    cwd: ctx.cwd,
    here: opts.here,
    cache: ctx.usageCaches(agent.id),
    needsToolCalls: isToday,
    analyze: (s) => todaySession(s, isToday(s), pricing),
  });
  if (!loaded.ok) {
    stderr(loaded.error.map((e: { message: string }) => e.message).join("\n"));
    return o.result(1);
  }
  // JSON too (on stderr, as stats does): the totals leave these logs out.
  for (const n of discoveryNotes(loaded.value)) stderr(n);

  const sessions: TodaySession[] = [];
  // Unpriced tokens behind "spend so far": today's sessions only.
  let unpriced = NO_UNPRICED;
  for (const { value } of loaded.value.sessions) {
    if (!value) continue;
    if (value.unpriced) unpriced = addUnpriced(unpriced, value.unpriced);
    sessions.push(value.session);
  }

  const report = runToday({ sessions, now, agent: agentLabel(agent) });
  const hasUnpriced = unpriced.requests > 0;
  if (opts.json) {
    stdout(formatTodayJson(report));
    // JSON has no field for it: say on stderr that the spend leaves tokens out.
    if (hasUnpriced) stderr(MESSAGES.unpricedTokens(unpriced));
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

/** One session's row for runToday; null when it has no usage. Unpriced tokens only for today's sessions. */
function todaySession(
  { meta, parsed }: LoadedSession,
  startedToday: boolean,
  pricing: ReturnType<typeof loadPricingForDate>,
): { session: TodaySession; unpriced: UnpricedUsage | undefined } | null {
  const startedAt = parsed.startedAt ?? new Date(meta.mtimeMs).toISOString();
  const tokens = analyzeTokens(parsed, pricing);
  if (isEmptySession(tokens)) return null;
  // Duplicate reads feed only today's top leak; earlier sessions are
  // usage-only (no tool calls), so they are not analyzed.
  const dups = startedToday ? analyzeDuplicateReads(parsed) : NO_DUPLICATES;
  const totalTokens =
    tokens.inputTokens +
    tokens.outputTokens +
    tokens.cacheReadTokens +
    tokens.cacheCreationTokens;
  const top = dups.topOffenders[0];
  return {
    unpriced: startedToday ? analyzeUnpriced(parsed, pricing) : undefined,
    session: {
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
    },
  };
}
