/**
 * `sipcode why` — past-tense session auditor.
 * Thin orchestrator: discover → parse → analyze → render → print.
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import path from "node:path";
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import { MESSAGES } from "../lib/messages.js";
import { shortSessionId } from "../lib/session-id.js";
import type { SipcodeIssue } from "../lib/errors.js";
import { resolveProjectsDir } from "../modules/transcript/discover.js";
import { parseTranscriptVerbose, type ParsedSession } from "../modules/transcript/parse.js";
import { analyzeTokens, analyzeUnpriced } from "../modules/transcript/analyzers/tokens.js";
import { analyzeDuplicateReads } from "../modules/transcript/analyzers/duplicateReads.js";
import { analyzeIdleContext } from "../modules/transcript/analyzers/idleContext.js";
import { analyzeTopExpensive } from "../modules/transcript/analyzers/topExpensive.js";
import { analyzeCounterfactual } from "../modules/transcript/analyzers/counterfactual.js";
import { renderReport } from "../modules/why/render.js";
import { formatJson } from "../modules/why/format-json.js";
import { formatTerminal } from "../modules/why/format-terminal.js";
import {
  daysSinceAsOf,
  loadPricingForDate,
  newestPricingAsOf,
  pricingAsOf,
} from "../lib/pricing/load.js";
import { resolveDisplayAgents, sectionHeader } from "../modules/agents/multi.js";
import {
  listAgentSessions,
  otherAgentHint,
  parseIssues,
  pickFrom,
  priceProvider,
  sessionPickError,
} from "../modules/agents/latest.js";

export interface WhyOptions {
  session?: string;
  list?: boolean;
  json?: boolean;
  here?: boolean;
  allProjects?: boolean;
  verbose?: boolean;
  cwd?: string;
  /** Which agent to source transcripts from. Default: auto (Claude Code and/or Codex). */
  agent?: string;
}

export interface WhyDeps {
  fs?: FileSystem;
  clock?: Clock;
  env?: ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

export interface WhyResult {
  exitCode: 0 | 1;
}

export async function runWhy(
  opts: WhyOptions,
  deps: WhyDeps = {},
): Promise<WhyResult> {
  const fs = deps.fs ?? new RealFileSystem();
  const clock = deps.clock ?? new RealClock();
  const env = deps.env ?? new RealProcessEnv();
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s + "\n"));
  const cwd = opts.cwd ?? process.cwd();

  // Which tools to look at: Claude Code and/or Codex (JSON: one tool).
  // --agent cursor exits cleanly with E009 — no crash.
  const shown = await resolveDisplayAgents({
    agent: opts.agent,
    fs,
    env,
    clock,
    cwd,
    json: opts.json ?? false,
    stderr,
    singleSession: true,
    sessionLookup: opts.session !== undefined,
  });
  if (!shown.ok) return { exitCode: 1 };
  const agents = shown.agents;
  if (agents.length === 1 && !agents[0]!.transcriptParsingSupported) {
    stderr(MESSAGES.cursorTranscriptNotSupported());
    return { exitCode: 1 };
  }
  // Claude Code alone keeps its original messages, byte for byte.
  const claudeOnly = agents.length === 1 && agents[0]!.id === "claude-code";
  const projectsDir = resolveProjectsDir(env);

  if (claudeOnly && !(await fs.exists(projectsDir))) {
    stderr(MESSAGES.noTranscriptsDir(projectsDir));
    return { exitCode: 1 };
  }

  const agentDeps = { fs, env, clock };
  const lists = await listAgentSessions({ agents, deps: agentDeps, cwd, here: opts.here });
  const scopedCount = lists.reduce((n, l) => n + l.scoped.length, 0);

  if (opts.list) {
    if (claudeOnly && scopedCount === 0) {
      stdout(MESSAGES.noSessionsFound(projectsDir));
      return { exitCode: 0 };
    }
    if (!claudeOnly && scopedCount === 0) {
      stdout(MESSAGES.noAgentSessions("why", agents.map((a) => a.displayName), opts.here ?? false));
      return { exitCode: 0 };
    }
    for (const l of lists) {
      if (agents.length > 1) stdout(sectionHeader(l.agent.displayName));
      if (l.scoped.length === 0) stdout("  (no sessions)");
      for (const s of l.scoped.slice(0, 50)) {
        const when = new Date(s.mtimeMs).toISOString();
        stdout(
          `${shortSessionId(s.sessionId, l.agent.id)}  ${when}  ${s.projectHash}  ${humanSize(s.size)}`,
        );
      }
      if (agents.length > 1) stdout("");
    }
    return { exitCode: 0 };
  }

  if (scopedCount === 0) {
    stderr(
      claudeOnly
        ? MESSAGES.noSessionsFound(projectsDir)
        : MESSAGES.noAgentSessions("why", agents.map((a) => a.displayName), opts.here ?? false),
    );
    return { exitCode: 1 };
  }

  // Pick session: --session <prefix> in any shown tool, else the newest
  // NON-empty session (an empty/in-flight one would render an all-zero
  // report; drift guards the same way), falling back to the newest.
  // A resumed session (or a Codex fork) repeats requests another file holds:
  // the pick carries only this session's own, as the period commands count them.
  const picked = await pickFrom(lists, agentDeps, { sessionIdPrefix: opts.session, ownRequests: true });
  const pickError = sessionPickError({
    command: "why",
    picked,
    agents,
    sessionIdPrefix: opts.session,
    here: opts.here ?? false,
    projectsDir,
  });
  if (pickError !== undefined || !picked) {
    stderr(pickError ?? MESSAGES.noSessionsFound(projectsDir));
    return { exitCode: 1 };
  }
  const { agent, meta: chosen } = picked.chosen;

  // Claude Code: the verbose parse also lists malformed lines.
  const session: ParsedSession = picked.chosen.parsed;
  let issues: SipcodeIssue[];
  if (agent.id === "claude-code") {
    let contents: string;
    try {
      contents = await fs.readFile(chosen.filePath);
    } catch {
      stderr(
        MESSAGES.malformedTranscript(
          path.basename(chosen.filePath),
          0,
        ),
      );
      return { exitCode: 1 };
    }
    ({ issues } = parseTranscriptVerbose(contents));
  } else {
    issues = parseIssues(session);
  }

  // Pricing.
  const sessionDate = session.startedAt
    ? new Date(session.startedAt)
    : clock.now();
  const pricing = loadPricingForDate(sessionDate);
  const provider = priceProvider(agent);
  const asOf = pricingAsOf(pricing, provider);
  const ageDays = daysSinceAsOf(asOf, clock.now());

  // Analyze.
  const totals = analyzeTokens(session, pricing);
  // Tokens on a model with no known price are left out of the cost: say so.
  const unpriced = analyzeUnpriced(session, pricing);
  const unpricedNote = unpriced.requests > 0 ? MESSAGES.unpricedTokens(unpriced) : undefined;
  const dups = analyzeDuplicateReads(session);
  const idle = analyzeIdleContext(session);
  const topEx = analyzeTopExpensive(session);
  const counter = analyzeCounterfactual(session, dups);

  // Render.
  const report = renderReport({
    session,
    totals,
    duplicates: dups,
    idle,
    topExpensive: topEx,
    counterfactual: counter,
    issues,
    projectHash: chosen.projectHash,
    pricingMeta: { asOf, ageDays },
    agentId: agent.id,
  });

  // With both tools shown, name the tool the report is about.
  if (agents.length > 1 && !opts.json) stdout(sectionHeader(agent.displayName));

  // Print banner if showing a "latest" pick from outside cwd-scope.
  if (!opts.session && !opts.here && !opts.json) {
    stdout(MESSAGES.banner(report.header.sessionIdShort, chosen.projectHash));
    stdout("");
  }

  if (opts.json) {
    stdout(formatJson(report));
    if (unpricedNote) stderr(unpricedNote);
  } else {
    const useColor =
      env.get("NO_COLOR") === undefined && (process.stdout?.isTTY ?? false);
    stdout(
      formatTerminal(report, {
        useColor,
        verbose: opts.verbose ?? false,
        agentId: agent.id,
      }),
    );
    if (unpricedNote) {
      stdout("");
      stdout(unpricedNote);
    }
    if (picked.others.length > 0) {
      stdout("");
      for (const o of picked.others) stdout(otherAgentHint(o, opts.here ?? false));
    }
  }

  // Warn when Sipcode's newest table is old, not when an older session is
  // (correctly) priced with the table of its own date.
  const newestAsOf = newestPricingAsOf(provider);
  const newestAgeDays = daysSinceAsOf(newestAsOf, clock.now());
  if (newestAgeDays > 30) {
    stderr("");
    stderr(MESSAGES.pricingStale(newestAsOf, newestAgeDays, provider));
  }

  return { exitCode: 0 };
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
