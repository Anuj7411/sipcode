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
import type { Agent, AgentDeps, KeyScan, SessionDiscovery } from "./types.js";

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
  /**
   * Load exactly these sessions (already discovered by the caller) instead of
   * running discovery and --here. Dedupe then covers only these sessions.
   */
  readonly sessions?: ReadonlyArray<SessionMeta> | undefined;
  /**
   * Sessions that only claim their request keys for dedupe and are not
   * returned (drift: sessions whose metrics are cached). Scanned when the agent
   * has scanRequestKeys, otherwise fully parsed.
   */
  readonly scanOnly?: ((meta: SessionMeta) => boolean) | undefined;
}

export interface LoadSessionsOutput {
  readonly sessions: LoadedSession[];
  /** Files discovered before any filtering (tells a brand-new user from an empty window). */
  readonly discovered: number;
  /** Session files that could not be read. */
  readonly unreadable: number;
  /** Folders discovery could not list. */
  readonly unreadableFolders: number;
  /** Compressed logs skipped on purpose (Codex `.jsonl.zst`). */
  readonly skippedCompressed: number;
  /** Files read for dedupe only (older than windowSinceMs, or scanOnly), not returned. */
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

/** SessionDiscovery with every count filled in. */
export type AgentDiscovery = Required<SessionDiscovery>;

/**
 * The one way to run an agent's discovery: adapters may return a bare
 * SessionMeta[] or a full SessionDiscovery; callers always get the full shape.
 */
export async function discoverAgentSessions(
  agent: Agent,
  deps: AgentDeps,
): Promise<Result<AgentDiscovery, SipcodeIssue[]>> {
  const discovery = await agent.discoverSessions(deps);
  if (!discovery.ok) return discovery;
  const d = Array.isArray(discovery.value)
    ? { sessions: discovery.value, unreadable: 0, issues: [] }
    : discovery.value;
  return ok({
    sessions: d.sessions,
    unreadable: d.unreadable,
    unreadableFolders: d.unreadableFolders ?? 0,
    skippedCompressed: d.skippedCompressed ?? 0,
    issues: d.issues,
  });
}

/**
 * The stderr notes every period command prints about logs it could not use:
 * unreadable or unparseable files, unreadable folders, skipped compressed logs.
 */
export function discoveryNotes(o: LoadSessionsOutput): string[] {
  const notes: string[] = [];
  const files = o.unreadable + o.issues.length;
  if (files > 0) {
    notes.push(`note: ${files} transcript file(s) could not be read or parsed; totals exclude them.`);
  }
  if (o.unreadableFolders > 0) {
    notes.push(`note: ${o.unreadableFolders} log folder(s) could not be read; totals exclude them.`);
  }
  if (o.skippedCompressed > 0) notes.push(`note: ${compressedSkippedMessage(o.skippedCompressed)}`);
  return notes;
}

export function compressedSkippedMessage(n: number): string {
  return `${n} compressed Codex log(s) (.jsonl.zst) skipped: Sipcode cannot read compressed logs yet.`;
}

export async function loadSessions(
  input: LoadSessionsInput,
): Promise<Result<LoadSessionsOutput, SipcodeIssue[]>> {
  const { agent, deps, cwd } = input;
  let found: AgentDiscovery;
  let metas: SessionMeta[];
  if (input.sessions) {
    metas = [...input.sessions];
    found = { sessions: metas, unreadable: 0, unreadableFolders: 0, skippedCompressed: 0, issues: [] };
  } else {
    const discovery = await discoverAgentSessions(agent, deps);
    if (!discovery.ok) return discovery;
    found = discovery.value;
    metas = found.sessions;
    // --here before dedupe is safe: a resumed session stays in its project.
    if (input.here) metas = metas.filter((m) => agent.matchesCwd(m, cwd));
  }
  const discovered = found.sessions.length;
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
    const keysOnly = input.scanOnly?.(meta) ?? false;
    if (scan && (keysOnly || (since !== undefined && meta.mtimeMs < since))) {
      loaded.push({ meta, parsed: stubSession(agent, meta, scan(content)), stub: true });
      scannedOnly++;
      continue;
    }
    const parsed = agent.parseTranscript(content);
    if (!parsed.ok) {
      issues.push(...parsed.error);
      continue;
    }
    if (keysOnly) scannedOnly++;
    loaded.push({ meta, parsed: parsed.value, stub: keysOnly });
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
    unreadableFolders: found.unreadableFolders,
    skippedCompressed: found.skippedCompressed,
    scannedOnly,
    droppedDuplicateRequests: d.droppedRequests,
    issues,
  });
}
