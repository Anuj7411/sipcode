/**
 * `sipcode drift` (v2) — silent-unless-regression context/cost drift detector.
 *
 * v2 changes over v1:
 *   - persistent baseline cache at `~/.sipcode/drift/sessions.jsonl` (cold-start
 *     parses up to PARSE_CAP transcripts; warm-cache runs hit cache only).
 *   - per-project baselines: history is filtered to the latest session's
 *     `projectHash`. Falls back to a global baseline when per-project history
 *     is below `MIN_BASELINE`.
 *   - config-cause attribution: snapshots the user's MCP server list each
 *     run; when cache reuse regresses, the matching `DriftCause` carries a
 *     concrete attribution line if servers changed inside the baseline window.
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import path from "node:path";
import { promises as nodeFs } from "node:fs";
import { RealFileSystem } from "../lib/fs.js";
import { RealProcessEnv } from "../lib/process.js";
import { resolveProjectsDir, listAllSessions } from "../modules/transcript/discover.js";
import { parseTranscript } from "../modules/transcript/parse.js";
import { loadPricingForDate } from "../lib/pricing/load.js";
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
const PARSE_CAP = 30; // cold-cache safety cap on transcripts parsed per run

export interface DriftSessionMeta {
  readonly sessionId: string;
  readonly filePath: string;
  readonly projectHash: string;
  readonly mtimeMs: number;
  readonly size: number;
}

export interface DriftOptions {
  json?: boolean;
  /** Bypass the persistent cache (parse every transcript fresh). */
  noCache?: boolean;
}

export interface DriftDeps {
  homeDir?: string;
  stdout?: (s: string) => void;
  listSessions?: () => Promise<DriftSessionMeta[]>;
  readFile?: (absPath: string) => Promise<string>;
  now?: Date;
  /** Override the directory holding sessions.jsonl + configs.jsonl. */
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
  const now = deps.now ?? new Date();
  const pricing = loadPricingForDate(now);
  const homeDir = deps.homeDir ?? new RealProcessEnv().homeDir();
  const stateDir = deps.stateDir ?? path.join(homeDir, ".sipcode", "drift");
  const sessionsPath = path.join(stateDir, "sessions.jsonl");
  const configsPath = path.join(stateDir, "configs.jsonl");
  const io = deps.storeIO ?? realStoreIO;
  const configPaths = deps.configPaths ?? defaultConfigPaths(homeDir);
  const configReader = deps.configReader ?? io.read;

  const listSessions =
    deps.listSessions ??
    (async () => {
      const env = new RealProcessEnv();
      const fs = new RealFileSystem();
      const dir = resolveProjectsDir(env);
      return listAllSessions(fs, dir);
    });
  const readFile =
    deps.readFile ??
    (async (p: string) => {
      try {
        return await nodeFs.readFile(p, "utf-8");
      } catch {
        return "";
      }
    });

  // 1. Hydrate cache.
  const cached = opts.noCache ? [] : await loadCachedSessions(sessionsPath, io);
  const cachedById = new Map(cached.map((m) => [m.sessionId, m]));
  const knownIds = new Set(cachedById.keys());

  // 2. Walk recent transcripts (newest first), use cache where possible.
  const candidates = await listSessions();
  const pool: SessionMetrics[] = [];
  const newlyComputed: SessionMetrics[] = [];

  for (const s of candidates.slice(0, PARSE_CAP)) {
    let m: SessionMetrics | undefined = cachedById.get(s.sessionId);
    if (m && !m.projectHash) {
      // Older cache entry missing projectHash; retag from current meta.
      m = { ...m, projectHash: s.projectHash };
      newlyComputed.push(m);
    } else if (!m) {
      const contents = await readFile(s.filePath);
      if (!contents) continue;
      const parsed = parseTranscript(contents);
      if (!parsed.ok) continue;
      m = computeSessionMetrics(
        {
          sessionId: s.sessionId,
          endedAtMs: s.mtimeMs,
          projectHash: s.projectHash,
        },
        parsed.value,
        pricing,
      );
      newlyComputed.push(m);
    }
    pool.push(m);
  }

  // 3. Persist any new entries before computing — durability over perf.
  if (!opts.noCache && newlyComputed.length > 0) {
    await persistNewSessions(sessionsPath, knownIds, newlyComputed, io);
    await pruneIfLarge(sessionsPath, io);
  }

  // 4. Find newest non-empty session as `latest`. Empty (0 assistant turns)
  // sessions are in-flight or aborted; using them as `latest` raised v1.6.2
  // false alarms (cacheHitRate=0, tokensPerTurn=0 ≈ catastrophic).
  const nonEmpty = pool.filter((m) => m.assistantTurns > 0);
  const latest = nonEmpty[0];

  if (!latest) {
    const msg = "no sessions found yet. Use Claude Code, then re-run.";
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

  // 5. Per-project history, with global fallback when too sparse.
  const tail = nonEmpty.slice(1);
  const projectHistory = latest.projectHash
    ? tail.filter((m) => m.projectHash === latest.projectHash).slice(0, WINDOW)
    : [];
  const useProject = projectHistory.length >= MIN_BASELINE;
  const history = useProject ? projectHistory : tail.slice(0, WINDOW);
  const baselineScope: "project" | "global" = useProject ? "project" : "global";

  // 6. Config-cause attribution: snapshot now, diff vs snapshot from before
  // the baseline window's oldest session.
  let attributions: Record<string, string> = {};
  if (!opts.noCache) {
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

  // 7. Build and emit.
  const report = buildDriftReport(latest, history, {
    ...(latest.projectHash !== undefined ? { projectHash: latest.projectHash } : {}),
    baselineScope,
    attributions,
  });
  stdout(opts.json ? renderDriftJson(report) : renderDriftTerminal(report));
  return { exitCode: 0 };
}
