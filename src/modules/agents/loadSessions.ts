/**
 * Shared session loading for every period command and every agent:
 * discover → --here → read → parse → cross-file dedupe (commands window afterwards).
 * Unreadable files are counted, never silently dropped.
 *
 * Speed: with `windowSinceMs`, files last written before the window cannot
 * contribute turns to it, but they still must claim their request keys so a
 * newer resumed file does not count copies of them. Those files are scanned
 * (no JSON.parse, see Agent.scanRequestKeys) into stub sessions that take part
 * in dedupe and are then dropped from the result.
 */
import { ok, type Result } from "../../lib/result.js";
import type { SipcodeIssue } from "../../lib/errors.js";
import { dedupeAcrossSessions } from "../transcript/dedupe.js";
import type { AssistantTurn } from "../transcript/parse.js";
import type { ParsedSession, SessionMeta } from "./shared.js";
import type { Agent, AgentDeps, KeyScan } from "./types.js";

export interface LoadedSession {
  readonly meta: SessionMeta;
  readonly parsed: ParsedSession;
}

export interface LoadSessionsInput {
  readonly agent: Agent;
  readonly deps: AgentDeps;
  readonly cwd: string;
  readonly here?: boolean | undefined;
  /**
   * Start of the caller's time window (epoch ms). Sessions with an older mtime
   * are only scanned for dedupe and not returned. Omit to load everything.
   */
  readonly windowSinceMs?: number | undefined;
}

export interface LoadSessionsOutput {
  readonly sessions: LoadedSession[];
  /** Files discovered before any filtering (tells a brand-new user from an empty window). */
  readonly discovered: number;
  readonly unreadable: number;
  /** Files scanned for dedupe only (older than windowSinceMs), not returned. */
  readonly scannedOnly: number;
  readonly droppedDuplicateRequests: number;
  readonly issues: SipcodeIssue[];
}

function stubTurn(index: number, requestKey: string | undefined): AssistantTurn {
  return {
    index,
    model: undefined,
    timestamp: undefined,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheCreation1hTokens: 0,
    requestKey,
    toolCalls: [],
    missingUsage: true,
  };
}

/** A session that only carries what dedupe needs: request keys, turn count, time span. */
function stubSession(agent: Agent, meta: SessionMeta, scan: KeyScan): ParsedSession {
  const turns: AssistantTurn[] = scan.keys.map((k, i) => stubTurn(i, k));
  for (let i = 0; i < scan.keylessTurns; i++) {
    turns.push(stubTurn(turns.length, undefined));
  }
  return {
    sessionId: meta.sessionId,
    cwd: undefined,
    primaryModel: undefined,
    models: new Set<string>(),
    startedAt: scan.startedAt,
    endedAt: scan.endedAt,
    durationSec: 0,
    assistantTurns: turns,
    toolCalls: [],
    userTurnCount: 0,
    linesParsed: 0,
    linesSkipped: 0,
    agent: agent.id,
  };
}

export async function loadSessions(
  input: LoadSessionsInput,
): Promise<Result<LoadSessionsOutput, SipcodeIssue[]>> {
  const { agent, deps, cwd } = input;
  const discovery = await agent.discoverSessions(deps);
  if (!discovery.ok) return discovery;
  const found = Array.isArray(discovery.value)
    ? { sessions: discovery.value, unreadable: 0, issues: [] }
    : discovery.value;
  let metas = found.sessions;
  const discovered = metas.length;
  // --here before dedupe is safe: a resumed session stays in its project.
  if (input.here) metas = metas.filter((m) => agent.matchesCwd(m, cwd));
  const scan = agent.scanRequestKeys?.bind(agent);
  const since = input.windowSinceMs;
  const loaded: { meta: SessionMeta; parsed: ParsedSession; stub: boolean }[] = [];
  const issues: SipcodeIssue[] = [...found.issues];
  let unreadable = found.unreadable;
  let scannedOnly = 0;
  for (const meta of metas) {
    let content: string;
    try {
      content = await deps.fs.readFile(meta.filePath);
    } catch {
      unreadable++;
      continue;
    }
    if (scan && since !== undefined && meta.mtimeMs < since) {
      loaded.push({ meta, parsed: stubSession(agent, meta, scan(content)), stub: true });
      scannedOnly++;
      continue;
    }
    const parsed = agent.parseTranscript(content);
    if (!parsed.ok) {
      issues.push(...parsed.error);
      continue;
    }
    loaded.push({ meta, parsed: parsed.value, stub: false });
  }
  // Dedupe runs over stubs and parsed sessions together, so an out-of-window
  // original still removes its copies from a newer resumed file.
  const d = dedupeAcrossSessions(loaded.map((l) => l.parsed));
  const sessions: LoadedSession[] = [];
  loaded.forEach((l, i) => {
    if (!l.stub) sessions.push({ meta: l.meta, parsed: d.sessions[i]! });
  });
  return ok({
    sessions,
    discovered,
    unreadable,
    scannedOnly,
    droppedDuplicateRequests: d.droppedRequests,
    issues,
  });
}
