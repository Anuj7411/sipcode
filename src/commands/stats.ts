/**
 * `sipcode stats` — cross-session analytics dashboard.
 * Thin orchestrator: loadSessions → filter window → analyze → aggregate →
 * render → format → print (+ optionally write HTML / JSON).
 *
 * One section per shown agent (Claude Code, Codex); JSON is one agent per call.
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import path from "node:path";
import { promises as nodeFs } from "node:fs";
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import { MESSAGES } from "../lib/messages.js";
import {
  compressedSkippedMessage,
  loadSessions,
} from "../modules/agents/loadSessions.js";
import {
  resolveDisplayAgents,
  runSections,
  SectionOutput,
  type SectionResult,
} from "../modules/agents/multi.js";
import type { Agent } from "../modules/agents/types.js";
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
import {
  daysSinceAsOf,
  loadPricingForDate,
  newestPricingAsOf,
  pricingAgeDays,
} from "../lib/pricing/load.js";
import { priceProvider } from "../modules/agents/latest.js";
import { anchorAllWindow, parseSince, isInWindow } from "../modules/stats/window.js";
import { aggregateSession } from "../modules/stats/aggregate.js";
import { renderStats } from "../modules/stats/render.js";
import { formatTerminal } from "../modules/stats/format-terminal.js";
import { formatJson } from "../modules/stats/format-json.js";
import { formatHtml } from "../modules/stats/format-html.js";
import type {
  AggregatedSession,
  GroupBy,
  StatsWindow,
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
    banner: !opts.json,
    combined: true,
    stdout,
    stderr,
    run: (agent, index) =>
      statsForAgent(agent, {
        opts,
        fs,
        env,
        clock,
        cwd,
        window,
        topN,
        groupBy,
        writeFile,
        // A second section writes its own HTML file instead of overwriting the first.
        htmlName: index === 0 ? "stats.html" : `stats-${agent.id}.html`,
      }),
  });
  return { exitCode };
}

interface StatsContext {
  readonly opts: StatsOptions;
  readonly fs: FileSystem;
  readonly env: ProcessEnv;
  readonly clock: Clock;
  readonly cwd: string;
  readonly window: StatsWindow;
  readonly topN: number;
  readonly groupBy: GroupBy;
  readonly writeFile: (absPath: string, content: string) => Promise<void>;
  readonly htmlName: string;
}

/** One agent's stats, returned as ordered output instead of printed. */
async function statsForAgent(agent: Agent, ctx: StatsContext): Promise<SectionResult> {
  const { opts, fs, env, clock, cwd, topN, groupBy, writeFile } = ctx;
  let window = ctx.window;
  const o = new SectionOutput();
  const stdout = o.out;
  const stderr = o.err;

  // Cursor's transcripts aren't parseable in this milestone — bail clean.
  if (!agent.transcriptParsingSupported) {
    stderr(MESSAGES.cursorTranscriptNotSupported());
    return o.result(1);
  }

  // Sanity check: projects dir must exist for claude-code path.
  if (agent.id === "claude-code") {
    const projectsDir = resolveProjectsDir(env);
    if (!(await fs.exists(projectsDir))) {
      stderr(MESSAGES.noTranscriptsDir(projectsDir));
      return o.result(1);
    }
  }

  // Pricing — keyed off the window's upper-bound (best snapshot of "today").
  const pricing = loadPricingForDate(new Date(window.untilIso));
  const ageDays = pricingAgeDays(pricing, clock.now());

  // Discover, scope (--here), parse and de-duplicate requests that a resumed
  // session file repeats from its original; each session is analyzed as it is
  // loaded and only its summary kept.
  const loaded = await loadSessions({
    agent,
    deps: { fs, env, clock },
    cwd,
    here: opts.here,
    // Files last modified before the window are only key-scanned (those that
    // can hold copies): they still remove their copies from newer resumed
    // files, but are not parsed.
    windowSinceMs: Date.parse(window.sinceIso),
    analyze: ({ meta, parsed }) => {
      const startedAt = parsed.startedAt ?? new Date(meta.mtimeMs).toISOString();
      if (!isInWindow(window, startedAt)) return null;
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
  // Raw count before any --here scoping — lets us tell a brand-new user
  // (zero transcripts anywhere) from "none in this window/cwd".
  const totalDiscovered = loaded.value.discovered;

  // Sessions inside the window with usage.
  const aggregated: AggregatedSession[] = [];
  const warnings: { code: string; message: string }[] = [];
  if (loaded.value.unreadable > 0) {
    warnings.push({
      code: "E003",
      message: `couldn't read ${loaded.value.unreadable} transcript file(s); totals exclude them.`,
    });
  }
  if (loaded.value.unreadableFolders > 0) {
    warnings.push({
      code: "E003",
      message: `couldn't read ${loaded.value.unreadableFolders} log folder(s); totals exclude them.`,
    });
  }
  if (loaded.value.skippedCompressed > 0) {
    warnings.push({ code: "E009", message: compressedSkippedMessage(loaded.value.skippedCompressed) });
  }
  // Parse problems must surface (a Codex parse error would otherwise vanish).
  for (const i of loaded.value.issues) warnings.push({ code: i.code, message: i.message });

  let unpriced = NO_UNPRICED;
  for (const { value } of loaded.value.sessions) {
    if (!value) continue;
    unpriced = addUnpriced(unpriced, value.unpriced);
    aggregated.push(value.session);
  }

  // Stable sort: most recent first.
  aggregated.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  // "all": count days from the earliest session, not from 1970.
  window = anchorAllWindow(window, aggregated.at(-1)?.startedAt);
  const unpricedNote = unpriced.requests > 0 ? MESSAGES.unpricedTokens(unpriced) : undefined;

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
      return o.result(0);
    }
    if (totalDiscovered === 0) {
      // Brand-new user: no transcripts exist anywhere. Don't claim they do.
      stdout(MESSAGES.statsNoSessionsYet(agent));
      return o.result(0);
    }
    stderr(MESSAGES.statsNoSessionsInWindow(window.raw, agent));
    return o.result(1, { emptyWindow: true });
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
    // JSON has no field for it: say on stderr that the cost leaves tokens out.
    if (unpricedNote) stderr(unpricedNote);
  } else {
    const useColor =
      env.get("NO_COLOR") === undefined && (process.stdout?.isTTY ?? false);
    stdout(formatTerminal(report, { useColor, unpricedNote }));
  }

  if (opts.html) {
    const htmlPath = path.join(cwd, ".sipcode", ctx.htmlName);
    const html = formatHtml(report, { unpricedNote });
    await writeFile(htmlPath, html);
    if (!opts.json) {
      stdout("");
      stdout(MESSAGES.statsHtmlWrote(htmlPath));
    }
  }

  // The newest table of the provider this section is priced with (a Codex
  // section warns about the OpenAI table, not the Anthropic one).
  const provider = priceProvider(agent);
  const newestAsOf = newestPricingAsOf(provider);
  const newestAgeDays = daysSinceAsOf(newestAsOf, clock.now());
  if (newestAgeDays > 30 && !opts.json) {
    stderr("");
    stderr(MESSAGES.pricingStale(newestAsOf, newestAgeDays, provider));
  }

  return o.result(0, {
    totals: {
      tokens: report.totals.totalTokens,
      usd: report.totals.estCostUSD,
      unpriced: unpriced.requests > 0,
    },
  });
}
