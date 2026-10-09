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
  const discovery = await discoverAgentSessions(agent, deps);
  if (!discovery.ok) return discovery;
  const found = discovery.value;
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
    unreadableFolders: found.unreadableFolders,
    skippedCompressed: found.skippedCompressed,
    scannedOnly,
    droppedDuplicateRequests: d.droppedRequests,
    issues,
  });
}

/** Clock and write-order jitter allowed by Claude Code's copy-window rule (copyCandidates). */
const COPY_WINDOW_SLACK_MS = 60 * 60 * 1000;

/**
 * Codex families: logs joined by the fork / subagent / root links line 1
 * names (SessionMeta.lineage). A request is copied only from a thread into
 * the threads forked or spawned from it, so two logs holding the same
 * request are in one family. A family is open (null) when a link names a
 * thread with no readable log (deleted, compressed): the logs on its other
 * side cannot be told apart, so an open log is a candidate for every target.
 * A log without lineage is open too.
 */
function codexFamilies(all: ReadonlyArray<SessionMeta>): (m: SessionMeta) => string | null {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    for (let p = parent.get(r); p !== undefined && p !== r; p = parent.get(r)) r = p;
    for (let y = x; y !== r; ) {
      const next = parent.get(y)!;
      parent.set(y, r);
      y = next;
    }
    return r;
  };
  const union = (a: string, b: string): void => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const known = new Set<string>();
  for (const m of all) {
    if (!m.lineage) continue;
    known.add(m.lineage.id);
    union(m.lineage.id, m.lineage.id);
    for (const l of m.lineage.linkedIds) union(m.lineage.id, l);
  }
  const open = new Set<string>();
  for (const id of parent.keys()) if (!known.has(id)) open.add(find(id));
  return (m) => {
    if (!m.lineage) return null;
    const root = find(m.lineage.id);
    return open.has(root) ? null : root;
  };
}

/**
 * Which logs can hold a copy of one of the targets' requests (the rest
 * cannot change what the targets keep, so they are never read).
 * Claude Code: a resumed session stays in its project folder, and copied
 * lines keep their original timestamps, so every request in a target is
 * logged at or after the target's (as logged) start; a file holding the same
 * request was written at or after that moment too. A file in another folder,
 * or last written before the target started, holds none of its requests.
 * Codex: forks may restamp copied history and run in another folder, so only
 * the family links decide (codexFamilies).
 * Other agents: every log.
 */
export function copyCandidates(
  agent: Agent,
  all: ReadonlyArray<SessionMeta>,
  targets: ReadonlyArray<{ readonly meta: SessionMeta; readonly startedAt: string | undefined }>,
): (other: SessionMeta) => boolean {
  if (agent.id === "claude-code") {
    const since = new Map<string, number>();
    for (const t of targets) {
      const start = t.startedAt ? Date.parse(t.startedAt) : NaN;
      const s = Number.isFinite(start) ? start - COPY_WINDOW_SLACK_MS : Number.NEGATIVE_INFINITY;
      const cur = since.get(t.meta.projectHash);
      if (cur === undefined || s < cur) since.set(t.meta.projectHash, s);
    }
    return (o) => {
      const s = since.get(o.projectHash);
      return s !== undefined && o.mtimeMs >= s;
    };
  }
  if (agent.id === "codex") {
    const family = codexFamilies(all);
    const families = new Set<string>();
    let anyOpen = false;
    for (const t of targets) {
      const f = family(t.meta);
      if (f === null) anyOpen = true;
      else families.add(f);
    }
    return (o) => {
      if (anyOpen) return true;
      const f = family(o);
      return f === null || families.has(f);
    };
  }
  return () => true;
}

/**
 * Single-session commands (why / receipt): drop from each target the
 * requests another file of the same agent also holds and that file keeps,
 * by the period commands' rule (dedupeAcrossSessions: the session that
 * started first keeps a request). A resumed Claude Code session or a Codex
 * fork then reports only its own requests; reads in the dropped history
 * become priorReads, so a later read of the same file still counts as a
 * re-read. Only files that can hold a copy (copyCandidates) are read, and
 * only their request keys (scanRequestKeys) when the agent has a scanner.
 * Unreadable or unparseable candidates are skipped.
 */
export async function dropCopiedRequests(i: {
  agent: Agent;
  deps: AgentDeps;
  targets: ReadonlyArray<LoadedSession>;
  /** The agent's discovered sessions (targets may be among them). */
  all: ReadonlyArray<SessionMeta>;
}): Promise<{ sessions: ParsedSession[]; candidatesRead: number; droppedRequests: number }> {
  const { agent, deps, targets } = i;
  const targetFiles = new Set(targets.map((t) => t.meta.filePath));
  const scan = agent.scanRequestKeys?.bind(agent);
  const others: ParsedSession[] = [];
  const candidate = copyCandidates(
    agent,
    i.all,
    targets.map((t) => ({ meta: t.meta, startedAt: t.parsed.startedAt })),
  );
  for (const meta of i.all) {
    if (targetFiles.has(meta.filePath)) continue;
    if (!candidate(meta)) continue;
    let content: string;
    try {
      content = await deps.fs.readFile(meta.filePath);
    } catch {
      continue;
    }
    if (scan) {
      others.push(stubSession(agent, meta, scan(content)));
      continue;
    }
    const parsed = agent.parseTranscript(content);
    if (parsed.ok) others.push(parsed.value);
  }
  const sessions = dedupeAcrossSessions([...targets.map((t) => t.parsed), ...others])
    .sessions.slice(0, targets.length);
  const droppedRequests = targets.reduce(
    (n, t, k) => n + t.parsed.assistantTurns.length - sessions[k]!.assistantTurns.length,
    0,
  );
  return { sessions, candidatesRead: others.length, droppedRequests };
}
