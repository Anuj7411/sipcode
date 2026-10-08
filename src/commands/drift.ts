/**
 * `sipcode drift` (v2) — silent-unless-regression context/cost drift detector.
 *
 * v2 changes over v1:
 *   - persistent baseline cache at `~/.sipcode/drift/sessions-v3.jsonl`
 *     (cold-start parses up to PARSE_CAP transcripts; warm-cache runs only
 *     parse sessions that changed since they were cached).
 *   - per-project baselines: history is filtered to the latest session's
 *     `projectHash`. Falls back to a global baseline when per-project history
 *     is below `MIN_BASELINE`.
 *   - config-cause attribution: snapshots the user's MCP server list each
 *     run; when cache reuse regresses, the matching `DriftCause` carries a
 *     concrete attribution line if servers changed inside the baseline window.
 *
 * Across agents: the latest session is the newest across Claude Code and
 * Codex (pickFrom); the baseline is that agent's earlier sessions, loaded
 * with loadSessions so a request repeated in a resumed / forked file counts
 * once (dedupe covers the PARSE_CAP-session window).
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import path from "node:path";
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import { MESSAGES } from "../lib/messages.js";
import { loadPricingForDate } from "../lib/pricing/load.js";
import { resolveProjectsDir } from "../modules/transcript/discover.js";
import type { ParsedSession, SessionMeta } from "../modules/agents/shared.js";
import { loadSessions } from "../modules/agents/loadSessions.js";
import { resolveDisplayAgents, sectionHeader } from "../modules/agents/multi.js";
import {
  listAgentSessions,
  otherAgentHint,
  pickFrom,
  sessionPickError,
} from "../modules/agents/latest.js";
import { computeSessionMetrics } from "../modules/drift/metrics.js";
import { buildDriftReport } from "../modules/drift/runDrift.js";
import { renderDriftTerminal } from "../modules/drift/format-terminal.js";
import { renderDriftJson } from "../modules/drift/format-json.js";
import {
  loadCachedSessions,
  persistNewSessions,
  pruneIfLarge,
  realStoreIO,
  type StoreIO,
} from "../modules/drift/store.js";
import {
  captureConfigSnapshot,
  persistConfigSnapshot,
  loadConfigSnapshots,
  diffConfigs,
  attributionFromDiff,
  snapshotBefore,
  defaultConfigPaths,
} from "../modules/drift/config-snapshot.js";
import { MIN_BASELINE } from "../modules/drift/baseline.js";
import type { SessionMetrics } from "../modules/drift/types.js";

const WINDOW = 6; // baseline history size (per-project preferred, global fallback)
const PARSE_CAP = 30; // sessions considered per run (the latest + older ones)

/**
 * Cache file. v3 holds metrics from the per-request parser with cross-file
 * dedupe (Claude Code and Codex); the older sessions.jsonl was computed by an
 * earlier parser and is ignored.
 */
const CACHE_FILE = "sessions-v3.jsonl";

export interface DriftOptions {
  json?: boolean;
  /** Bypass the persistent cache (parse every transcript fresh). */
  noCache?: boolean;
  /** Which agent to read: claude-code | codex | auto (default). */
  agent?: string;
  /** Scope the latest session and the baseline to the current folder. */
  here?: boolean;
  /** Check a specific session (id prefix) instead of the latest. */
  session?: string;
  cwd?: string;
}

export interface DriftDeps {
  fs?: FileSystem;
  env?: ProcessEnv;
  clock?: Clock;
  homeDir?: string;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  /** "Now" for pricing and config snapshots. Default: clock.now(). */
  now?: Date;
  /** Override the directory holding the session cache + configs.jsonl. */
  stateDir?: string;
  storeIO?: StoreIO;
  /** Paths to consider for the user's Claude config (defaults: ~/.claude.json, ~/.claude/settings.json). */
  configPaths?: string[];
  /** Reader used both for config files and discovery via store. */
  configReader?: (p: string) => Promise<string | null>;
}

export interface DriftResult {
  readonly exitCode: 0 | 1;
}

export async function runDriftCommand(
  opts: DriftOptions = {},
  deps: DriftDeps = {},
): Promise<DriftResult> {
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s + "\n"));
  const fs = deps.fs ?? new RealFileSystem();
  const env = deps.env ?? new RealProcessEnv();
  const clock = deps.clock ?? new RealClock();
  const now = deps.now ?? clock.now();
  const cwd = opts.cwd ?? process.cwd();
  const pricing = loadPricingForDate(now);
  const homeDir = deps.homeDir ?? env.homeDir();
  const stateDir = deps.stateDir ?? path.join(homeDir, ".sipcode", "drift");
  const sessionsPath = path.join(stateDir, CACHE_FILE);
  const configsPath = path.join(stateDir, "configs.jsonl");
  const io = deps.storeIO ?? realStoreIO;
  const configPaths = deps.configPaths ?? defaultConfigPaths(homeDir);
  const configReader = deps.configReader ?? io.read;

  // 1. Which tools: Claude Code and/or Codex (JSON: one tool).
  const shown = await resolveDisplayAgents({
    agent: opts.agent,
    fs,
    env,
    clock,
    cwd,
    json: opts.json ?? false,
    stderr,
    singleSession: true,
  });
  if (!shown.ok) return { exitCode: 1 };
  const agents = shown.agents;
  if (agents.length === 1 && !agents[0]!.transcriptParsingSupported) {
    stderr(MESSAGES.cursorTranscriptNotSupported());
    return { exitCode: 1 };
  }

  // 2. The session to check: --session <prefix>, else the newest non-empty
  // session across the shown tools (never a subagent thread).
  const agentDeps = { fs, env, clock };
  const lists = await listAgentSessions({ agents, deps: agentDeps, cwd, here: opts.here });
  const picked = await pickFrom(lists, agentDeps, { sessionIdPrefix: opts.session });
  if (picked?.ambiguous || (!picked && opts.session)) {
    stderr(
      sessionPickError({
        command: "drift",
        picked,
        agents,
        sessionIdPrefix: opts.session,
        here: opts.here ?? false,
        projectsDir: resolveProjectsDir(env),
      }) ?? "",
    );
    return { exitCode: 1 };
  }
  if (!picked) return noData(opts, agents.map((a) => a.displayName), stdout);
  const agent = picked.chosen.agent;
  const list = lists.find((l) => l.agent === agent)!;
  const base = list.scoped.includes(picked.chosen.meta) ? list.scoped : list.all;
  const at = base.indexOf(picked.chosen.meta);
  // Newest first: the chosen session, then the older ones the baseline uses.
  const window = base.slice(at, at + PARSE_CAP);

  // 3. Hydrate cache. An entry is reused only while its file is unchanged
  // (an in-flight session keeps growing, so its metrics are recomputed).
  const cached = opts.noCache ? [] : await loadCachedSessions(sessionsPath, io);
  const cachedById = new Map(cached.map((m) => [m.sessionId, m]));
  const fresh = (m: SessionMeta): SessionMetrics | undefined => {
    const c = cachedById.get(m.sessionId);
    return c && c.endedAtMs === m.mtimeMs ? c : undefined;
  };

  // 4. Parse what is not cached. Cached sessions still claim their request
  // keys, so a newer resumed file does not count its copies of them.
  const parsed = new Map<SessionMeta, ParsedSession>();
  if (window.some((m) => !fresh(m))) {
    const r = await loadSessions({
      agent,
      deps: agentDeps,
      cwd,
      sessions: window,
      scanOnly: (m) => fresh(m) !== undefined,
    });
    if (r.ok) for (const s of r.value.sessions) parsed.set(s.meta, s.parsed);
  }

  const pool: SessionMetrics[] = [];
  const newlyComputed: SessionMetrics[] = [];
  let latestIdx = -1;
  for (const s of window) {
    let m = fresh(s);
    if (m && !m.projectHash) {
      // Older cache entry missing projectHash; retag from current meta.
      m = { ...m, projectHash: s.projectHash };
      newlyComputed.push(m);
    } else if (!m) {
      const p = parsed.get(s);
      if (!p) continue;
      // Helper threads are not your sessions: not in the baseline (an explicit
      // --session may still check one).
      if (p.isSubagent && s !== picked.chosen.meta) continue;
      m = computeSessionMetrics(
        { sessionId: s.sessionId, endedAtMs: s.mtimeMs, projectHash: s.projectHash },
        p,
        pricing,
      );
      if (!p.isSubagent) newlyComputed.push(m);
    }
    if (s === picked.chosen.meta) latestIdx = pool.length;
    pool.push(m);
  }

  // 5. Persist any new entries before computing — durability over perf.
  if (!opts.noCache && newlyComputed.length > 0) {
    await persistNewSessions(sessionsPath, new Set(), newlyComputed, io);
    await pruneIfLarge(sessionsPath, io);
  }

  // 6. The latest session. Empty (0 assistant turns) sessions are in-flight
  // or aborted; using them as `latest` raised v1.6.2 false alarms
  // (cacheHitRate=0, tokensPerTurn=0 ≈ catastrophic). Without --session the
  // newest non-empty one wins (a resumed file can be empty after dedupe).
  if (!opts.session) latestIdx = pool.findIndex((m) => m.assistantTurns > 0);
  const latest = latestIdx >= 0 ? pool[latestIdx] : undefined;
  if (!latest) return noData(opts, [agent.displayName], stdout);

  // 7. Per-project history, with global fallback when too sparse.
  const tail = pool.slice(latestIdx + 1).filter((m) => m.assistantTurns > 0);
  const projectHistory = latest.projectHash
    ? tail.filter((m) => m.projectHash === latest.projectHash).slice(0, WINDOW)
    : [];
  const useProject = projectHistory.length >= MIN_BASELINE;
  const history = useProject ? projectHistory : tail.slice(0, WINDOW);
  const baselineScope: "project" | "global" = useProject ? "project" : "global";

  // 8. Config-cause attribution (Claude Code config): snapshot now, diff vs
  // snapshot from before the baseline window's oldest session. Claude Code's
  // MCP servers say nothing about a Codex session, so Codex skips it.
  const attributions: Record<string, string> = {};
  if (!opts.noCache && agent.id === "claude-code") {
    const nowSnap = await captureConfigSnapshot(configPaths, now.getTime(), configReader);
    await persistConfigSnapshot(configsPath, nowSnap, io);
    const snapshots = await loadConfigSnapshots(configsPath, io);
    const baselineOldestMs = history.length > 0
      ? history[history.length - 1]!.endedAtMs
      : latest.endedAtMs;
    const before = snapshotBefore(snapshots, baselineOldestMs);
    const diff = diffConfigs(before, nowSnap);
    const attr = attributionFromDiff(diff);
    if (attr) attributions["Cache reuse"] = attr;
  }

  // 9. Build and emit.
  const report = buildDriftReport(latest, history, {
    ...(latest.projectHash !== undefined ? { projectHash: latest.projectHash } : {}),
    baselineScope,
    attributions,
    agent: { id: agent.id, displayName: agent.displayName },
  });
  if (opts.json) {
    stdout(renderDriftJson(report));
    return { exitCode: 0 };
  }
  // With both tools shown, name the tool the report is about.
  if (agents.length > 1) stdout(sectionHeader(agent.displayName));
  stdout(renderDriftTerminal(report, agent));
  if (picked.others.length > 0) {
    stdout("");
    for (const o of picked.others) stdout(otherAgentHint(o, opts.here ?? false));
  }
  return { exitCode: 0 };
}

/** Nothing to compare yet: a calm exit 0 (unchanged wording for Claude Code). */
function noData(
  opts: DriftOptions,
  agentNames: readonly string[],
  stdout: (s: string) => void,
): DriftResult {
  const msg = `no sessions found yet. Use ${agentNames.join(" or ")}, then re-run.`;
  stdout(
    opts.json
      ? JSON.stringify(
          { schemaVersion: "sipcode-drift/2", hasRegression: false, status: "no-data", summary: msg },
          null,
          2,
        )
      : `Sipcode drift: ${msg}`,
  );
  return { exitCode: 0 };
}
