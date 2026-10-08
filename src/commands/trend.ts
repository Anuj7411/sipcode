/**
 * `sipcode trend` — single-metric time-series across a window.
 *
 * Thin orchestrator: enumerate transcripts → parse → analyze → bucket per day
 * via the pure compute module → render.
 *
 * Uses the same transcript discovery + parse path as `sipcode stats`. Where
 * stats shows totals (cost, savings, top-N tasks), trend shows ONE metric
 * over time — the question is "is this getting better?", not "how much?".
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import { discoveryNotes, loadSessions } from "../modules/agents/loadSessions.js";
import {
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
import {
  computeTrend,
  type TrendMetric,
  type TrendSession,
} from "../modules/trend/compute.js";
import { formatTrendTerminal } from "../modules/trend/format-terminal.js";
import { formatTrendJson } from "../modules/trend/format-json.js";
import path from "node:path";

export interface TrendOptions {
  metric?: string;
  since?: string;
  json?: boolean;
  agent?: string;
  cwd?: string;
  here?: boolean;
}

export interface TrendDeps {
  fs?: FileSystem;
  clock?: Clock;
  env?: ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

export interface TrendResultExit {
  readonly exitCode: 0 | 1;
}

const VALID_METRICS: ReadonlySet<TrendMetric> = new Set([
  "output-ratio",
  "cost-per-session",
  "recoverable-tokens-per-session",
]);

export async function runTrend(
  opts: TrendOptions = {},
  deps: TrendDeps = {},
): Promise<TrendResultExit> {
  const fs = deps.fs ?? new RealFileSystem();
  const clock = deps.clock ?? new RealClock();
  const env = deps.env ?? new RealProcessEnv();
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s + "\n"));

  const metric = (opts.metric ?? "output-ratio") as TrendMetric;
  if (!VALID_METRICS.has(metric)) {
    stderr(
      `unknown metric '${metric}'. valid: output-ratio, cost-per-session, recoverable-tokens-per-session.`,
    );
    return { exitCode: 1 };
  }

  const sinceDays = parseSinceWindow(opts.since ?? "30d");
  if (sinceDays === null) {
    stderr(
      `unrecognized --since '${opts.since}'. use NNd / NNw / NNm (e.g. 30d, 4w, 3m).`,
    );
    return { exitCode: 1 };
  }
  const until = clock.now();
  const since = new Date(until.getTime() - sinceDays * 86_400_000);
  const sinceIso = since.toISOString().slice(0, 10);
  const untilIso = until.toISOString().slice(0, 10);

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
    combined: false,
    stdout,
    stderr,
    run: (agent) =>
      trendForAgent(agent, { opts, fs, env, clock, cwd, metric, until, sinceIso, untilIso }),
  });
  return { exitCode };
}

interface TrendContext {
  readonly opts: TrendOptions;
  readonly fs: FileSystem;
  readonly env: ProcessEnv;
  readonly clock: Clock;
  readonly cwd: string;
  readonly metric: TrendMetric;
  readonly until: Date;
  readonly sinceIso: string;
  readonly untilIso: string;
}

/** One agent's trend, returned as ordered output instead of printed. */
async function trendForAgent(agent: Agent, ctx: TrendContext): Promise<SectionResult> {
  const { opts, fs, env, clock, metric, until, sinceIso, untilIso } = ctx;
  const o = new SectionOutput();
  const stdout = o.out;
  const stderr = o.err;
  if (!agent.transcriptParsingSupported) {
    stderr(MESSAGES.cursorTranscriptNotSupported());
    return o.result(1);
  }

  // Pricing — keyed off the window upper bound.
  const pricing = loadPricingForDate(until);

  // Discover, scope (--here), parse and de-duplicate resumed-session copies.
  // Files last written before the window are key-scanned only (see loadSessions).
  const loaded = await loadSessions({
    agent,
    deps: { fs, env, clock },
    cwd: ctx.cwd,
    here: opts.here,
    windowSinceMs: Date.parse(sinceIso),
  });
  if (!loaded.ok) {
    stderr(loaded.error.map((e: { message: string }) => e.message).join("\n"));
    return o.result(1);
  }
  if (!opts.json) for (const n of discoveryNotes(loaded.value)) stderr(n);

  const sessions: TrendSession[] = [];
  let unpriced = NO_UNPRICED;
  for (const { meta, parsed } of loaded.value.sessions) {
    const startedAt = parsed.startedAt ?? new Date(meta.mtimeMs).toISOString();
    const startedDay = startedAt.slice(0, 10);
    if (startedDay < sinceIso || startedDay > untilIso) continue;

    const totals = analyzeTokens(parsed, pricing);
    if (isEmptySession(totals)) continue;
    unpriced = addUnpriced(unpriced, analyzeUnpriced(parsed, pricing));
    const dups = analyzeDuplicateReads(parsed);
    const totalTokens =
      totals.inputTokens +
      totals.outputTokens +
      totals.cacheReadTokens +
      totals.cacheCreationTokens;
    sessions.push({
      startedAt,
      totalTokens,
      outputTokens: totals.outputTokens,
      estCostUSD: totals.estCostUSD,
      duplicateReadTokens: dups.duplicateReadTokenCost,
    });
  }

  const result = computeTrend(sessions, metric, sinceIso, untilIso);
  if (opts.json) {
    stdout(formatTrendJson(result));
  } else {
    stdout(
      formatTrendTerminal(result, {
        unpricedNote: unpriced.requests > 0 ? MESSAGES.unpricedTokens(unpriced) : undefined,
      }),
    );
  }
  return o.result(0);
}

/** Parse "30d" / "4w" / "3m" into a day count. Returns null on invalid input. */
export function parseSinceWindow(s: string): number | null {
  const m = s.trim().toLowerCase().match(/^(\d+)([dwm])$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  switch (m[2]) {
    case "d":
      return n;
    case "w":
      return n * 7;
    case "m":
      return n * 30;
    default:
      return null;
  }
}

// Used so unused imports don't warn during the path-only build copy step.
void path;
