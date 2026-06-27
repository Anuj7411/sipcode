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
import { resolveAgentFromOpts } from "../modules/agents/cli.js";
import { MESSAGES } from "../lib/messages.js";
import { loadPricingForDate } from "../lib/pricing/load.js";
import { analyzeTokens, isEmptySession } from "../modules/transcript/analyzers/tokens.js";
import { analyzeDuplicateReads } from "../modules/transcript/analyzers/duplicateReads.js";
import { runToday, type TodaySession } from "../modules/today/runToday.js";
import { formatTodayTerminal } from "../modules/today/format-terminal.js";
import { formatTodayJson } from "../modules/today/format-json.js";

export interface TodayOptions {
  json?: boolean;
  agent?: string;
  cwd?: string;
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

  const agentResolve = await resolveAgentFromOpts({
    agent: opts.agent,
    fs,
    env,
    cwd: opts.cwd ?? process.cwd(),
    stdout,
    stderr,
    quiet: true,
  });
  if (!agentResolve.ok) return { exitCode: 1 };
  const agent = agentResolve.agent;
  if (!agent.transcriptParsingSupported) {
    stderr(MESSAGES.cursorTranscriptNotSupported());
    return { exitCode: 1 };
  }
  const now = clock.now();
  const pricing = loadPricingForDate(now);

  const discovery = await agent.discoverSessions({ fs, env, clock });
  if (!discovery.ok) {
    stderr(discovery.error.map((e: { message: string }) => e.message).join("\n"));
    return { exitCode: 1 };
  }

  const sessions: TodaySession[] = [];
  for (const meta of discovery.value) {
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

    const tokens = analyzeTokens(parsed, pricing);
    if (isEmptySession(tokens)) continue;
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

  const report = runToday({ sessions, now });
  if (opts.json) {
    stdout(formatTodayJson(report));
  } else {
    stdout(formatTodayTerminal(report));
  }
  return { exitCode: 0 };
}
