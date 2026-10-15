/**
 * Codex limit inputs from disk: readings, scanned from every rollout Codex
 * discovery lists, and requests, from the shared session loader (so dedupe
 * and the usage cache are reused unchanged). Files that cannot be read are
 * skipped here and counted (`unread`); once sessions are loaded, the session
 * loader's counts report them.
 */
import { readLogText } from "../../lib/fs.js";
import { scanCodexRateLimits, type LimitReading } from "../agents/codex/rateLimits.js";
import { discoverAgentSessions, type LoadedSession, type UnreadCounts } from "../agents/loadSessions.js";
import { getAgentById } from "../agents/registry.js";
import type { AgentDeps } from "../agents/types.js";
import type { LimitRequest } from "./attribute.js";
import { formatTodayLimitLine } from "./format-terminal.js";
import { buildPeriods } from "./periods.js";
import { pickTodayWindow } from "./report.js";

export interface CodexReadings {
  readonly readings: LimitReading[];
  /** Lines or windows that could not be read (MESSAGES.limitsMalformed). */
  readonly malformed: number;
  /** Rollouts the scan could not read: discovery's counts plus files that failed to read. */
  readonly unread: UnreadCounts;
}

/** Rollouts read at once. Small, so a few large logs never sit in memory together. */
const READ_AHEAD = 4;

export async function loadCodexReadings(deps: AgentDeps): Promise<CodexReadings> {
  const readings: LimitReading[] = [];
  let malformed = 0;
  const found = await discoverAgentSessions(getAgentById("codex"), deps);
  if (!found.ok) return { readings, malformed, unread: { unreadable: 0, unreadableFolders: 0, skippedCompressed: 0, issues: [] } };
  let unreadable = found.value.unreadable;
  // Up to READ_AHEAD files are read at once (`today` waits on this scan);
  // they are scanned in discovery order, so the result never depends on timing.
  const sessions = found.value.sessions;
  for (let i = 0; i < sessions.length; i += READ_AHEAD) {
    const batch = sessions.slice(i, i + READ_AHEAD);
    const texts = await Promise.all(batch.map((m) => readLogText(deps.fs, m.filePath).catch(() => undefined)));
    batch.forEach((meta, j) => {
      const text = texts[j];
      if (text === undefined) {
        unreadable++;
        return;
      }
      const scan = scanCodexRateLimits(text, { sessionId: meta.sessionId });
      for (const r of scan.readings) readings.push(r);
      malformed += scan.malformed;
    });
  }
  const { unreadableFolders, skippedCompressed, issues } = found.value;
  return { readings, malformed, unread: { unreadable, unreadableFolders, skippedCompressed, issues } };
}

/** A loaded Codex session's requests with tokens and a time (loadSessions `analyze`). */
export function limitRequests({ meta, parsed }: LoadedSession): LimitRequest[] {
  const cwd = meta.cwd ?? parsed.cwd;
  const out: LimitRequest[] = [];
  for (const t of parsed.assistantTurns) {
    const at = t.timestamp === undefined ? Number.NaN : Date.parse(t.timestamp);
    const tokens = t.inputTokens + t.cacheReadTokens + t.cacheCreationTokens + t.outputTokens;
    if (!Number.isFinite(at) || tokens <= 0) continue;
    out.push({ at, sessionId: meta.sessionId, cwd, model: t.model, tokens });
  }
  return out;
}

/** The line `today` adds for the Codex limit closest to running out; undefined without limit data. */
export async function todayLimitLine(deps: AgentDeps, now: Date): Promise<string | undefined> {
  const { readings } = await loadCodexReadings(deps);
  const w = pickTodayWindow(buildPeriods(readings), now);
  return w ? formatTodayLimitLine(w, now) : undefined;
}
