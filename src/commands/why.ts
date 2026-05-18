/**
 * `sipcode why` — past-tense session auditor.
 * Thin orchestrator: discover → parse → analyze → render → print.
 */
import path from "node:path";
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import { MESSAGES } from "../lib/messages.js";
import {
  findSessionById,
  listAllSessions,
  listSessionsHere,
  resolveProjectsDir,
  type SessionMeta,
} from "../modules/transcript/discover.js";
import { parseTranscriptVerbose } from "../modules/transcript/parse.js";
import { analyzeTokens } from "../modules/transcript/analyzers/tokens.js";
import { analyzeDuplicateReads } from "../modules/transcript/analyzers/duplicateReads.js";
import { analyzeIdleContext } from "../modules/transcript/analyzers/idleContext.js";
import { analyzeTopExpensive } from "../modules/transcript/analyzers/topExpensive.js";
import { analyzeCounterfactual } from "../modules/transcript/analyzers/counterfactual.js";
import { renderReport } from "../modules/why/render.js";
import { formatJson } from "../modules/why/format-json.js";
import { formatTerminal } from "../modules/why/format-terminal.js";
import { loadPricingForDate, pricingAgeDays } from "../lib/pricing/load.js";

export interface WhyOptions {
  session?: string;
  list?: boolean;
  json?: boolean;
  here?: boolean;
  allProjects?: boolean;
  verbose?: boolean;
  cwd?: string;
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

  const projectsDir = resolveProjectsDir(env);

  if (!(await fs.exists(projectsDir))) {
    stderr(MESSAGES.noTranscriptsDir(projectsDir));
    return { exitCode: 1 };
  }

  const cwd = opts.cwd ?? process.cwd();
  let sessions: SessionMeta[];
  if (opts.here) {
    sessions = await listSessionsHere(fs, projectsDir, cwd);
  } else {
    sessions = await listAllSessions(fs, projectsDir);
  }

  if (opts.list) {
    if (sessions.length === 0) {
      stdout(MESSAGES.noSessionsFound(projectsDir));
      return { exitCode: 0 };
    }
    for (const s of sessions.slice(0, 50)) {
      const when = new Date(s.mtimeMs).toISOString();
      stdout(
        `${s.sessionId.slice(0, 8)}  ${when}  ${s.projectHash}  ${humanSize(s.size)}`,
      );
    }
    return { exitCode: 0 };
  }

  if (sessions.length === 0) {
    stderr(MESSAGES.noSessionsFound(projectsDir));
    return { exitCode: 1 };
  }

  // Pick session.
  let chosen: SessionMeta | undefined;
  if (opts.session) {
    chosen = await findSessionById(fs, projectsDir, opts.session);
    if (!chosen) {
      stderr(MESSAGES.sessionNotFound(opts.session));
      return { exitCode: 1 };
    }
  } else {
    chosen = sessions[0];
  }
  if (!chosen) {
    stderr(MESSAGES.noSessionsFound(projectsDir));
    return { exitCode: 1 };
  }

  // Parse.
  let contents: string;
  try {
    contents = await fs.readFile(chosen.filePath);
  } catch (e) {
    stderr(
      MESSAGES.malformedTranscript(
        path.basename(chosen.filePath),
        0,
      ),
    );
    return { exitCode: 1 };
  }
  const { session, issues } = parseTranscriptVerbose(contents);

  // Pricing.
  const sessionDate = session.startedAt
    ? new Date(session.startedAt)
    : clock.now();
  const pricing = loadPricingForDate(sessionDate);
  const ageDays = pricingAgeDays(pricing, clock.now());

  // Analyze.
  const totals = analyzeTokens(session, pricing);
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
    pricingMeta: { asOf: pricing.as_of, ageDays },
  });

  // Print banner if showing a "latest" pick from outside cwd-scope.
  if (!opts.session && !opts.here && !opts.json) {
    stdout(MESSAGES.banner(report.header.sessionIdShort, chosen.projectHash));
    stdout("");
  }

  if (opts.json) {
    stdout(formatJson(report));
  } else {
    const useColor =
      env.get("NO_COLOR") === undefined && (process.stdout?.isTTY ?? false);
    stdout(formatTerminal(report, { useColor, verbose: opts.verbose ?? false }));
  }

  if (ageDays > 30) {
    stderr("");
    stderr(MESSAGES.pricingStale(pricing.as_of, ageDays));
  }

  return { exitCode: 0 };
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
