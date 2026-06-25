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
import { getAgentById } from "../modules/agents/registry.js";
import type { AgentId } from "../modules/agents/types.js";
import { loadPricingForDate } from "../lib/pricing/load.js";
import { analyzeTokens, isEmptySession } from "../modules/transcript/analyzers/tokens.js";
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

  const agent = getAgentById((opts.agent ?? "claude-code") as AgentId);

  // Pricing — keyed off the window upper bound.
  const pricing = loadPricingForDate(until);

  // Discover transcripts via the agent layer (mirrors stats).
  const metasResult = await agent.discoverSessions({ fs, env, clock });
  if (!metasResult.ok) {
    stderr(metasResult.error.map((e: { message: string }) => e.message).join("\n"));
    return { exitCode: 1 };
  }
  const metas = metasResult.value;

  // Pre-filter by mtime then parse and aggregate.
  const sessions: TrendSession[] = [];
  for (const meta of metas) {
    const mtimeIso = new Date(meta.mtimeMs).toISOString().slice(0, 10);
    if (mtimeIso < sinceIso) continue;

    let content: string;
    try {
      content = await fs.readFile(meta.filePath);
    } catch {
      continue;
    }
    const parseResult = agent.parseTranscript(content);
    if (!parseResult.ok) continue;
    const parsed = parseResult.value;
    const startedAt = parsed.startedAt ?? new Date(meta.mtimeMs).toISOString();
    const startedDay = startedAt.slice(0, 10);
    if (startedDay < sinceIso || startedDay > untilIso) continue;

    const totals = analyzeTokens(parsed, pricing);
    if (isEmptySession(totals)) continue;
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
    stdout(formatTrendTerminal(result));
  }
  return { exitCode: 0 };
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
