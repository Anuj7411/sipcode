/**
 * `sipcode impact` — A/B comparison of token spend before vs after Sipcode's
 * optimizers were installed.
 *
 * Resolves the pivot timestamp in this order:
 *   1. --since YYYY-MM-DD flag (manual override)
 *   2. .sipcode/install-state.json rules timestamp
 *   3. .sipcode/install-state.json hygiene timestamp
 *
 * If none of the above resolve, prints a friendly "no marker found" report
 * with hints. Never crashes on missing data.
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import { resolveAgentFromOpts } from "../modules/agents/cli.js";
import { resolveProjectsDir } from "../modules/transcript/discover.js";
import {
  analyzeTokens,
  isEmptySession,
} from "../modules/transcript/analyzers/tokens.js";
import { analyzeDuplicateReads } from "../modules/transcript/analyzers/duplicateReads.js";
import { analyzeIdleContext } from "../modules/transcript/analyzers/idleContext.js";
import { loadPricingForDate } from "../lib/pricing/load.js";
import { aggregateSession } from "../modules/stats/aggregate.js";
import type { AggregatedSession } from "../modules/stats/types.js";
import { runImpact } from "../modules/impact/runImpact.js";
import { formatTerminal } from "../modules/impact/format-terminal.js";
import { formatJson } from "../modules/impact/format-json.js";
import { readInstallState, pickMarker } from "../lib/install-state.js";
import type { ImpactReport } from "../modules/impact/types.js";

export interface ImpactOptions {
  since?: string;
  json?: boolean;
  agent?: string;
  cwd?: string;
}

export interface ImpactDeps {
  fs?: FileSystem;
  clock?: Clock;
  env?: ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

export interface ImpactResult {
  exitCode: 0 | 1;
}

function parseSinceFlag(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

export async function runImpactCommand(
  opts: ImpactOptions = {},
  deps: ImpactDeps = {},
): Promise<ImpactResult> {
  const fileSys = deps.fs ?? new RealFileSystem();
  const clock = deps.clock ?? new RealClock();
  const env = deps.env ?? new RealProcessEnv();
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s + "\n"));
  const cwd = opts.cwd ?? process.cwd();

  const agentResolve = await resolveAgentFromOpts({
    agent: opts.agent,
    fs: fileSys,
    env,
    cwd,
    stdout: opts.json ? () => {} : stdout,
    stderr,
    quiet: opts.json ?? false,
  });
  if (!agentResolve.ok) return { exitCode: 1 };
  const agent = agentResolve.agent;
  if (!agent.transcriptParsingSupported) {
    stderr("Impact requires Claude Code transcripts. Cursor adapter doesn't yet parse transcripts.");
    return { exitCode: 1 };
  }
  const projectsDir = resolveProjectsDir(env);
  const projectsExists = await fileSys.exists(projectsDir);

  const sinceIso = parseSinceFlag(opts.since);
  if (opts.since && !sinceIso) {
    stderr(`Invalid --since "${opts.since}". Expected YYYY-MM-DD.`);
    return { exitCode: 1 };
  }
  const installState = await readInstallState(cwd);
  const stateMarker = pickMarker(installState);
  const installedAtIso = sinceIso ?? stateMarker?.iso ?? null;
  const markerSource: ImpactReport["markerSource"] = sinceIso
    ? "--since flag"
    : stateMarker?.source ?? "none";

  const aggregated: AggregatedSession[] = [];
  if (projectsExists) {
    const discovery = await agent.discoverSessions({ fs: fileSys, env, clock });
    if (!discovery.ok) {
      for (const i of discovery.error) stderr(i.message);
      return { exitCode: 1 };
    }
    const metas = discovery.value;
    const pricing = loadPricingForDate(clock.now());
    for (const meta of metas) {
      let content: string;
      try {
        content = await fileSys.readFile(meta.filePath);
      } catch {
        continue;
      }
      const parseResult = agent.parseTranscript(content);
      if (!parseResult.ok) continue;
      const parsed = parseResult.value;
      const totals = analyzeTokens(parsed, pricing);
      if (isEmptySession(totals)) continue;
      const dups = analyzeDuplicateReads(parsed);
      const idle = analyzeIdleContext(parsed);
      aggregated.push(
        aggregateSession({
          sessionId: meta.sessionId,
          projectHash: meta.projectHash,
          fallbackStartedAtMs: meta.mtimeMs,
          parsed,
          totals,
          duplicates: dups,
          idle,
        }),
      );
    }
  }

  const report = runImpact({
    sessions: aggregated,
    installedAtIso,
    markerSource,
    nowIso: clock.now().toISOString(),
  });

  if (opts.json) {
    stdout(formatJson(report));
  } else {
    stdout(formatTerminal(report));
  }
  return { exitCode: 0 };
}

export { runImpactCommand as default };
