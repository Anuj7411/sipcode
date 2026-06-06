/**
 * `sipcode drift` — silent-unless-regression context/cost drift detector.
 * Lists the most recent N+1 sessions, computes metrics; newest = latest,
 * the rest = baseline history.
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
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
import type { SessionMetrics } from "../modules/drift/types.js";

const WINDOW = 6; // baseline history size

export interface DriftSessionMeta {
  readonly sessionId: string;
  readonly filePath: string;
  readonly projectHash: string;
  readonly mtimeMs: number;
  readonly size: number;
}

export interface DriftOptions {
  json?: boolean;
}

export interface DriftDeps {
  homeDir?: string;
  stdout?: (s: string) => void;
  listSessions?: () => Promise<DriftSessionMeta[]>;
  readFile?: (absPath: string) => Promise<string>;
  now?: Date;
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

  const candidates = await listSessions(); // newest-first
  let latest: SessionMetrics | undefined;
  const history: SessionMetrics[] = [];
  for (const s of candidates) {
    if (latest && history.length >= WINDOW) break;
    const contents = await readFile(s.filePath);
    if (!contents) continue;
    const parsed = parseTranscript(contents);
    if (!parsed.ok) continue;
    const m = computeSessionMetrics(
      { sessionId: s.sessionId, endedAtMs: s.mtimeMs },
      parsed.value,
      pricing,
    );
    // Skip sessions with no assistant activity (empty / in-flight): their
    // cacheHitRate=0 and tokensPerTurn=0 would otherwise masquerade as a
    // catastrophic regression — a FALSE ALARM (found via dogfooding 1.6.2).
    // Drift only compares sessions that actually did work.
    if (m.assistantTurns === 0) continue;
    if (!latest) latest = m;
    else history.push(m);
  }

  if (!latest) {
    const msg = "no sessions found yet. Use Claude Code, then re-run.";
    stdout(
      opts.json
        ? JSON.stringify(
            { schemaVersion: "sipcode-drift/1", hasRegression: false, status: "no-data", summary: msg },
            null,
            2,
          )
        : `Sipcode drift: ${msg}`,
    );
    return { exitCode: 0 };
  }

  const report = buildDriftReport(latest, history);
  stdout(opts.json ? renderDriftJson(report) : renderDriftTerminal(report));
  return { exitCode: 0 };
}
