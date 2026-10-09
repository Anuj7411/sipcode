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
 * Codex (pickFrom, or the cache alone when it can tell); the baseline is that
 * agent's earlier sessions. Each session parsed counts only its own requests
 * (dropCopiedRequests), so a request repeated in a resumed / forked file
 * counts once, even when the file that keeps it is outside the window.
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
import { dropCopiedRequests, type LoadedSession } from "../modules/agents/loadSessions.js";
import type { Agent } from "../modules/agents/types.js";
import { resolveDisplayAgents, sectionHeader } from "../modules/agents/multi.js";
import {
  listAgentSessions,
  type AgentSessions,
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
    sessionLookup: opts.session !== undefined,
  });
  if (!shown.ok) return { exitCode: 1 };
  const agents = shown.agents;
  if (agents.length === 1 && !agents[0]!.transcriptParsingSupported) {
    stderr(MESSAGES.cursorTranscriptNotSupported());
    return { exitCode: 1 };
  }

  // 2. Cache. An entry is reused only while its file is unchanged (an
  // in-flight session keeps growing, so its metrics are recomputed).
  const cached = opts.noCache ? [] : await loadCachedSessions(sessionsPath, io);
  const cachedById = new Map(cached.map((m) => [m.sessionId, m]));
  const fresh = (m: SessionMeta): SessionMetrics | undefined => {
    const c = cachedById.get(m.sessionId);
    return c && c.endedAtMs === m.mtimeMs ? c : undefined;
  };

  // 3. The session to check: --session <prefix>, else the newest session
  // across the shown tools that has requests of its own (never a subagent
  // thread). When the cache already answers that, nothing is parsed.
  const agentDeps = { fs, env, clock };
  const lists = await listAgentSessions({ agents, deps: agentDeps, cwd, here: opts.here });
  let picked: DriftPick | undefined = opts.session ? undefined : pickFromCache(lists, fresh);
  /** The chosen session's own requests, when the pick parsed it. */
  let chosenParsed: ParsedSession | undefined;
  if (!picked) {
    const r = await pickFrom(lists, agentDeps, { sessionIdPrefix: opts.session, ownRequests: true });
    if (r?.ambiguous || (!r && opts.session)) {
      stderr(
        sessionPickError({
          command: "drift",
          picked: r,
          agents,
          sessionIdPrefix: opts.session,
          here: opts.here ?? false,
          projectsDir: resolveProjectsDir(env),
        }) ?? "",
      );
      return { exitCode: 1 };
    }
    if (!r) {
      const names = agents.map((a) => a.displayName);
      // --here with sessions elsewhere: say it is this folder that has none.
      const elsewhere = opts.here && lists.some((l) => l.all.length > 0);
      return noData(opts, names, stdout, elsewhere ? MESSAGES.driftNothingHere(names) : undefined);
    }
    picked = r;
    chosenParsed = r.chosen.parsed;
  }
  const chosen = picked.chosen.meta;
  const agent = picked.chosen.agent;
  const list = lists.find((l) => l.agent === agent)!;
  const base = list.scoped.includes(chosen) ? list.scoped : list.all;
  const at = base.indexOf(chosen);
  // Newest first: the chosen session, then the older ones the baseline uses.
  const window = base.slice(at, at + PARSE_CAP);

  // 4. Metrics, only for the sessions the report uses: the latest, then up to
  // WINDOW earlier ones of its project and WINDOW of any project. A cached
  // entry is reused while its file is unchanged; the rest are parsed, each
  // keeping only its own requests: a request another file also holds (a
  // resumed session's copied history, a Codex fork's parent) counts in the
  // file that keeps it, wherever that file is (dropCopiedRequests reads only
  // the files that can hold a copy, and only their request keys). The chosen
  // session was already parsed this way by the pick.
  /** Sessions looked at so far: their metrics, or null when unusable (unreadable, a helper thread). */
  const metrics = new Map<SessionMeta, SessionMetrics | null>();
  const newlyComputed: SessionMetrics[] = [];
  const record = (s: SessionMeta, p: ParsedSession): void => {
    const m = computeSessionMetrics(
      { sessionId: s.sessionId, endedAtMs: s.mtimeMs, projectHash: s.projectHash },
      p,
      pricing,
    );
    metrics.set(s, m);
    if (!p.isSubagent) newlyComputed.push(m);
  };
  const evaluate = async (metas: ReadonlyArray<SessionMeta>): Promise<void> => {
    const targets: LoadedSession[] = [];
    for (const s of metas) {
      const c = fresh(s);
      if (c && !c.projectHash) {
        // Older cache entry missing projectHash; retag from current meta.
        const m = { ...c, projectHash: s.projectHash };
        metrics.set(s, m);
        newlyComputed.push(m);
        continue;
      }
      if (c) {
        metrics.set(s, c);
        continue;
      }
      if (s === chosen && chosenParsed) {
        record(s, chosenParsed);
        continue;
      }
      // Helper threads are not your sessions: not in the baseline (an explicit
      // --session may still check one). Discovery can tell for Codex.
      if (s.isSubagent && s !== chosen) {
        metrics.set(s, null);
        continue;
      }
      let content: string;
      try {
        content = await fs.readFile(s.filePath);
      } catch {
        metrics.set(s, null);
        continue;
      }
      const p = agent.parseTranscript(content);
      if (!p.ok || (p.value.isSubagent && s !== chosen)) {
        metrics.set(s, null);
        continue;
      }
      targets.push({ meta: s, parsed: p.value });
    }
    if (targets.length === 0) return;
    const own = await dropCopiedRequests({ agent, deps: agentDeps, targets, all: list.all });
    targets.forEach((t, k) => record(t.meta, own.sessions[k]!));
  };
  /**
   * The sessions still to look at before the latest and its history are
   * known, by the rules of steps 6 and 7. One not yet looked at counts as
   * usable, so the common case needs a single batch.
   */
  const pending = (): SessionMeta[] => {
    const need: SessionMeta[] = [];
    let latestAt = -1;
    for (let i = 0; i < window.length && latestAt < 0; i++) {
      const s = window[i]!;
      const known = metrics.has(s);
      if (!known) need.push(s);
      const m = metrics.get(s);
      if (opts.session || !known || (m && m.assistantTurns > 0)) latestAt = i;
    }
    if (latestAt < 0) return need;
    const hash = window[latestAt]!.projectHash;
    let any = 0;
    let inProject = 0;
    for (let i = latestAt + 1; i < window.length && (any < WINDOW || inProject < WINDOW); i++) {
      const s = window[i]!;
      const same = s.projectHash === hash;
      if (any >= WINDOW && !same) continue;
      const known = metrics.has(s);
      if (!known) need.push(s);
      const m = metrics.get(s);
      if (!known || (m && m.assistantTurns > 0)) {
        any++;
        if (same) inProject++;
      }
    }
    return need;
  };
  for (let need = pending(); need.length > 0; need = pending()) await evaluate(need);

  const pool: SessionMetrics[] = [];
  let latestIdx = -1;
  for (const s of window) {
    const m = metrics.get(s);
    if (!m) continue;
    if (s === chosen) latestIdx = pool.length;
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
  message?: string,
): DriftResult {
  const msg = message ?? `no sessions found yet. Use ${agentNames.join(" or ")}, then re-run.`;
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

/** Drift's pick: the session to check, and each other tool's newest (for the hint). */
interface DriftPick {
  readonly chosen: { readonly agent: Agent; readonly meta: SessionMeta };
  readonly others: ReadonlyArray<{ readonly agent: Agent; readonly meta: SessionMeta }>;
}

/**
 * The pick from the cache alone, when it can tell: each tool's newest session
 * in scope (helper threads skipped) is cached, unchanged, and has requests of
 * its own (an entry with none is passed over, as pickFrom passes over an empty
 * or all-copied session). Undefined when any tool's answer needs a parse.
 */
function pickFromCache(
  lists: ReadonlyArray<AgentSessions>,
  fresh: (m: SessionMeta) => SessionMetrics | undefined,
): DriftPick | undefined {
  const found: { agent: Agent; meta: SessionMeta }[] = [];
  for (const { agent, scoped } of lists) {
    for (const meta of scoped) {
      if (meta.isSubagent) continue;
      const c = fresh(meta);
      if (!c) return undefined;
      if (c.assistantTurns > 0) {
        found.push({ agent, meta });
        break;
      }
    }
  }
  if (found.length === 0) return undefined;
  found.sort((a, b) => b.meta.mtimeMs - a.meta.mtimeMs);
  return { chosen: found[0]!, others: found.slice(1) };
}
