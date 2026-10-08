/**
 * `sipcode forecast` — projected month-end spend.
 * Mirrors `today.ts` orchestration.
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import { resolveAgentFromOpts } from "../modules/agents/cli.js";
import { loadSessions } from "../modules/agents/loadSessions.js";
import { MESSAGES } from "../lib/messages.js";
import { loadPricingForDate } from "../lib/pricing/load.js";
import { analyzeTokens, isEmptySession } from "../modules/transcript/analyzers/tokens.js";
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

  // No windowSinceMs here on purpose: the runners derive "days of history"
  // (baseline tier, forecast eligibility) from the EARLIEST session, so dropping
  // old files would change the report status, not just speed it up.
  const loaded = await loadSessions({
    agent,
    deps: { fs, env, clock },
    cwd: opts.cwd ?? process.cwd(),
    here: opts.here,
  });
  if (!loaded.ok) {
    stderr(loaded.error.map((e: { message: string }) => e.message).join("\n"));
    return { exitCode: 1 };
  }
  if (
    !opts.json &&
    (loaded.value.unreadable > 0 || loaded.value.issues.length > 0)
  ) {
    stderr(
      `note: ${loaded.value.unreadable + loaded.value.issues.length} transcript file(s) could not be read or parsed; totals exclude them.`,
    );
  }

  const sessions: ForecastSession[] = [];
  for (const { meta, parsed } of loaded.value.sessions) {
    const startedAt = parsed.startedAt ?? new Date(meta.mtimeMs).toISOString();
    const tokens = analyzeTokens(parsed, pricing);
    if (isEmptySession(tokens)) continue;
    sessions.push({ startedAt, estCostUSD: tokens.estCostUSD });
  }

  const report = runForecast({ sessions, now });
  if (opts.json) {
    stdout(formatForecastJson(report));
  } else {
    stdout(formatForecastTerminal(report));
  }
  return { exitCode: 0 };
}
