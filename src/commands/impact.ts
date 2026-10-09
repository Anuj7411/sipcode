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
import { discoveryNotes, loadSessions } from "../modules/agents/loadSessions.js";
import {
  agentLabel,
  resolveDisplayAgents,
  runSections,
  SectionOutput,
  type SectionResult,
} from "../modules/agents/multi.js";
import type { Agent } from "../modules/agents/types.js";
import { CODEX_IMPACT_LABEL, MESSAGES } from "../lib/messages.js";
import { resolveProjectsDir } from "../modules/transcript/discover.js";
import {
  addUnpriced,
  analyzeTokens,
  analyzeUnpriced,
  isEmptySession,
  NO_UNPRICED,
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
  here?: boolean;
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

  const shown = await resolveDisplayAgents({
    agent: opts.agent,
    fs: fileSys,
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
    banner: !opts.json,
    combined: false,
    stdout,
    stderr,
    run: (agent) => impactForAgent(agent, { opts, fs: fileSys, env, clock, cwd }),
  });
  return { exitCode };
}

interface ImpactContext {
  readonly opts: ImpactOptions;
  readonly fs: FileSystem;
  readonly env: ProcessEnv;
  readonly clock: Clock;
  readonly cwd: string;
}

/** One agent's before/after report, returned as ordered output instead of printed. */
async function impactForAgent(agent: Agent, ctx: ImpactContext): Promise<SectionResult> {
  const { opts, fs: fileSys, env, clock, cwd } = ctx;
  const o = new SectionOutput();
  const stdout = o.out;
  const stderr = o.err;
  if (!agent.transcriptParsingSupported) {
    stderr(MESSAGES.cursorTranscriptNotSupported());
    return o.result(1);
  }
  // Only Claude Code's logs live under the projects dir; other agents always load.
  const projectsExists =
    agent.id !== "claude-code" || (await fileSys.exists(resolveProjectsDir(env)));

  const sinceIso = parseSinceFlag(opts.since);
  if (opts.since && !sinceIso) {
    stderr(`Invalid --since "${opts.since}". Expected YYYY-MM-DD.`);
    return o.result(1);
  }
  const installState = await readInstallState(cwd);
  const stateMarker = pickMarker(installState);
  const installedAtIso = sinceIso ?? stateMarker?.iso ?? null;
  const markerSource: ImpactReport["markerSource"] = sinceIso
    ? "--since flag"
    : stateMarker?.source ?? "none";

  const aggregated: AggregatedSession[] = [];
  let unpriced = NO_UNPRICED;
  if (projectsExists) {
    const pricing = loadPricingForDate(clock.now());
    // No windowSinceMs: impact compares before/after install and needs all history.
    const loaded = await loadSessions({
      agent,
      deps: { fs: fileSys, env, clock },
      cwd,
      here: opts.here,
      analyze: ({ meta, parsed }) => {
        const totals = analyzeTokens(parsed, pricing);
        if (isEmptySession(totals)) return null;
        return {
          unpriced: analyzeUnpriced(parsed, pricing),
          session: aggregateSession({
            sessionId: meta.sessionId,
            projectHash: meta.projectHash,
            fallbackStartedAtMs: meta.mtimeMs,
            parsed,
            totals,
            duplicates: analyzeDuplicateReads(parsed),
            idle: analyzeIdleContext(parsed),
          }),
        };
      },
    });
    if (!loaded.ok) {
      for (const i of loaded.error) stderr(i.message);
      return o.result(1);
    }
    if (!opts.json) for (const n of discoveryNotes(loaded.value)) stderr(n);
    for (const { value } of loaded.value.sessions) {
      if (!value) continue;
      unpriced = addUnpriced(unpriced, value.unpriced);
      aggregated.push(value.session);
    }
  }

  const report = runImpact({
    sessions: aggregated,
    installedAtIso,
    markerSource,
    nowIso: clock.now().toISOString(),
    agent: agentLabel(agent),
    // rules --install returns E009 for Codex: never suggest it there.
    setupSupported: agent.id !== "codex",
  });

  // A Codex before/after is not Sipcode's doing: it does not act inside Codex.
  const beforeAfterLabel = agent.id === "codex" && report.installedAtIso ? CODEX_IMPACT_LABEL : undefined;
  if (opts.json) {
    stdout(formatJson(report));
    // JSON has no field for these: they go to stderr.
    if (beforeAfterLabel) stderr(beforeAfterLabel);
    if (unpriced.requests > 0) stderr(MESSAGES.unpricedTokens(unpriced));
  } else {
    stdout(
      formatTerminal(report, {
        beforeAfterLabel,
        agentName: agent.displayName,
        unpricedNote: unpriced.requests > 0 ? MESSAGES.unpricedTokens(unpriced) : undefined,
      }),
    );
  }
  return o.result(0);
}

export { runImpactCommand as default };
