/**
 * `sipcode stats` — cross-session analytics dashboard.
 * Thin orchestrator: agent.discoverSessions → filter window → parse + analyze
 * → aggregate → render → format → print (+ optionally write HTML / JSON).
 *
 * Routes through the Agent abstraction so future agents are first-class.
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import path from "node:path";
import { promises as nodeFs } from "node:fs";
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import { MESSAGES } from "../lib/messages.js";
import { resolveAgentFromOpts } from "../modules/agents/cli.js";
import {
  resolveProjectsDir,
  cwdToProjectHash,
} from "../modules/transcript/discover.js";
import { analyzeTokens, isEmptySession } from "../modules/transcript/analyzers/tokens.js";
import { analyzeDuplicateReads } from "../modules/transcript/analyzers/duplicateReads.js";
import { analyzeIdleContext } from "../modules/transcript/analyzers/idleContext.js";
import {
  loadPricingForDate,
  pricingAgeDays,
} from "../lib/pricing/load.js";
import { parseSince, isInWindow } from "../modules/stats/window.js";
import { aggregateSession } from "../modules/stats/aggregate.js";
import { renderStats } from "../modules/stats/render.js";
import { formatTerminal } from "../modules/stats/format-terminal.js";
import { formatJson } from "../modules/stats/format-json.js";
import { formatHtml } from "../modules/stats/format-html.js";
import type {
  AggregatedSession,
  GroupBy,
} from "../modules/stats/types.js";

export interface StatsOptions {
  since?: string;
  here?: boolean;
  html?: boolean;
  json?: boolean;
  groupBy?: string;
  top?: string | number;
  agent?: string;
  cwd?: string;
}

export interface StatsDeps {
  fs?: FileSystem;
  clock?: Clock;
  env?: ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  /** Pluggable writeFile so InMemoryFs tests don't hit the disk. */
  writeFile?: (absPath: string, content: string) => Promise<void>;
}

export interface StatsResult {
  exitCode: 0 | 1;
}

async function defaultWriteFile(p: string, c: string): Promise<void> {
  await nodeFs.mkdir(path.dirname(p), { recursive: true });
  await nodeFs.writeFile(p, c, "utf-8");
}

function parseTopN(raw: string | number | undefined): number | { error: string } {
  if (raw === undefined || raw === "") return 5;
  const n = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 100) {
    return { error: MESSAGES.statsBadTopN(String(raw)) };
  }
  return Math.floor(n);
}

function parseGroupBy(raw: string | undefined): GroupBy | { error: string } {
  if (raw === undefined || raw === "" || raw === "none") return "none";
  if (raw === "project") return "project";
  return { error: MESSAGES.statsBadGroupBy(raw) };
}

export async function runStats(
  opts: StatsOptions = {},
  deps: StatsDeps = {},
): Promise<StatsResult> {
  const fs = deps.fs ?? new RealFileSystem();
  const clock = deps.clock ?? new RealClock();
  const env = deps.env ?? new RealProcessEnv();
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s + "\n"));
  const writeFile = deps.writeFile ?? defaultWriteFile;
  const cwd = opts.cwd ?? process.cwd();

  // --since.
  const windowResult = parseSince(opts.since, clock.now());
  if (!windowResult.ok) {
    stderr(windowResult.error.message);
    return { exitCode: 1 };
  }
  const window = windowResult.value;

  // --top.
  const topN = parseTopN(opts.top);
  if (typeof topN !== "number") {
    stderr(topN.error);
    return { exitCode: 1 };
  }

  // --group-by.
  const groupBy = parseGroupBy(opts.groupBy);
  if (typeof groupBy !== "string") {
    stderr(groupBy.error);
    return { exitCode: 1 };
  }

  // Resolve agent.
  const agentResolve = await resolveAgentFromOpts({
    agent: opts.agent,
    fs,
    env,
    cwd,
    stdout: opts.json ? () => {} : stdout,
    stderr,
    quiet: opts.json ?? false,
  });
  if (!agentResolve.ok) return { exitCode: 1 };
  const agent = agentResolve.agent;

  // Cursor's transcripts aren't parseable in this milestone — bail clean.
  if (!agent.transcriptParsingSupported) {
    stderr(MESSAGES.cursorTranscriptNotSupported());
    return { exitCode: 1 };
  }

  // Sanity check: projects dir must exist for claude-code path.
  const projectsDir = resolveProjectsDir(env);
  if (!(await fs.exists(projectsDir))) {
    stderr(MESSAGES.noTranscriptsDir(projectsDir));
    return { exitCode: 1 };
  }

  // Discover.
  const discovery = await agent.discoverSessions({ fs, env, clock });
  if (!discovery.ok) {
    for (const i of discovery.error) stderr(i.message);
    return { exitCode: 1 };
  }
  let metas = discovery.value;
  // Raw count before any --here scoping — lets us tell a brand-new user
  // (zero transcripts anywhere) from "none in this window/cwd".
  const totalDiscovered = discovery.value.length;

  // --here filter: scope to the cwd's projectHash.
  if (opts.here) {
    const cwdHash = cwdToProjectHash(cwd);
    metas = metas.filter(
      (m) => m.projectHash === cwdHash || cwdHash.endsWith(m.projectHash),
    );
  }

  // Pricing — keyed off the window's upper-bound (best snapshot of "today").
  const pricing = loadPricingForDate(new Date(window.untilIso));
  const ageDays = pricingAgeDays(pricing, clock.now());

  // Walk each session: read → parse → analyze → aggregate. Skip out-of-window
  // entries early via mtime, then refine after parse with the assistant ts.
  const aggregated: AggregatedSession[] = [];
  const warnings: { code: string; message: string }[] = [];

  for (const meta of metas) {
    // Pre-filter by file mtime — cheap. If the file's mtime is before the
    // window's lower bound by more than a day, skip outright.
    const mtimeIso = new Date(meta.mtimeMs).toISOString();
    if (mtimeIso < window.sinceIso) continue;

    let content: string;
    try {
      content = await fs.readFile(meta.filePath);
    } catch {
      warnings.push({
        code: "E003",
        message: `couldn't read ${path.basename(meta.filePath)}.`,
      });
      continue;
    }
    const parseResult = agent.parseTranscript(content);
    if (!parseResult.ok) {
      for (const i of parseResult.error) warnings.push({ code: i.code, message: i.message });
      continue;
    }
    const parsed = parseResult.value;
    const startedAt = parsed.startedAt ?? mtimeIso;
    if (!isInWindow(window, startedAt)) continue;

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

  // Stable sort: most recent first.
  aggregated.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  if (aggregated.length === 0) {
    if (opts.json) {
      // Still emit a valid empty-window JSON envelope.
      const empty = renderStats({
        window,
        agent: agent.id,
        sessions: [],
        topN,
        groupBy,
        pricing,
        pricingAgeDays: ageDays,
        warnings,
      });
      stdout(formatJson(empty));
      return { exitCode: 0 };
    }
    if (totalDiscovered === 0) {
      // Brand-new user: no transcripts exist anywhere. Don't claim they do.
      stdout(MESSAGES.statsNoSessionsYet());
      return { exitCode: 0 };
    }
    stderr(MESSAGES.statsNoSessionsInWindow(window.raw));
    return { exitCode: 1 };
  }

  const report = renderStats({
    window,
    agent: agent.id,
    sessions: aggregated,
    topN,
    groupBy,
    pricing,
    pricingAgeDays: ageDays,
    warnings,
  });

  // Emit chosen format. JSON is exclusive (machine output); HTML is additive.
  if (opts.json) {
    stdout(formatJson(report));
  } else {
    const useColor =
      env.get("NO_COLOR") === undefined && (process.stdout?.isTTY ?? false);
    stdout(formatTerminal(report, { useColor }));
  }

  if (opts.html) {
    const htmlPath = path.join(cwd, ".sipcode", "stats.html");
    const html = formatHtml(report);
    await writeFile(htmlPath, html);
    if (!opts.json) {
      stdout("");
      stdout(MESSAGES.statsHtmlWrote(htmlPath));
    }
  }

  if (ageDays > 30 && !opts.json) {
    stderr("");
    stderr(MESSAGES.pricingStale(pricing.as_of, ageDays));
  }

  return { exitCode: 0 };
}
