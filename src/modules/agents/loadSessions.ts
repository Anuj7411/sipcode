/**
 * Shared session loading for every period command and every agent:
 * discover → read → parse → cross-file dedupe → the caller's per-session
 * analysis. Unreadable files are counted, never silently dropped.
 *
 * Memory: sessions are never held all at once. Each file is read, parsed,
 * added to a dedupe index (DedupeIndex: per request key, its owner and
 * largest usage) and analyzed as deduped over the files added so far, then
 * dropped; only the caller's per-session result is kept. Files are read
 * oldest first, and a session's copy candidates are added before it, so a
 * later file rarely changes a result already taken; when one does
 * (DedupeIndex.isSettled), that session is read and analyzed again at the
 * end. Results are exactly those of deduping all sessions in memory.
 *
 * Speed: with `windowSinceMs`, files last written before the window cannot
 * contribute turns to it. They are read only when they can hold a copy of a
 * request of a session in the window (claimerQueue), and then only their
 * request keys (Agent.scanRequestKeys, no JSON.parse), which they claim with
 * zero usage. With a usage cache (today / forecast), unchanged files are
 * served from it instead of being read.
 */
import { ok, type Result } from "../../lib/result.js";
import type { SipcodeIssue } from "../../lib/errors.js";
import { dedupeAcrossSessions, DedupeIndex } from "../transcript/dedupe.js";
import type { AssistantTurn } from "../transcript/parse.js";
import type { ParsedSession, SessionMeta } from "./shared.js";
import type { Agent, AgentDeps, KeyScan, SessionDiscovery } from "./types.js";
import {
  cacheHeader,
  decodeEntry,
  encodeEntry,
  entryFile,
  type UsageCacheIO,
  type UsageCacheWriter,
} from "./usageSessions.js";

export interface LoadedSession {
  readonly meta: SessionMeta;
  readonly parsed: ParsedSession;
}

export interface LoadSessionsInput<R> {
  readonly agent: Agent;
  readonly deps: AgentDeps;
  readonly cwd: string;
  readonly here?: boolean | undefined;
  /**
   * Start of the caller's time window (epoch ms). Sessions with an older mtime
   * are not returned (they only claim their requests, see above). Omit to
   * load everything. Ignored for an agent without scanRequestKeys.
   */
  readonly windowSinceMs?: number | undefined;
  /**
   * Usage cache (today / forecast): sessions served from it have no tool
   * calls unless needsToolCalls asks for them. null / omitted: no cache.
   */
  readonly cache?: UsageCacheIO | null | undefined;
  /** With a cache: the (deduped) sessions whose tool calls `analyze` reads. */
  readonly needsToolCalls?: ((s: LoadedSession) => boolean) | undefined;
  /**
   * The caller's work on one deduped session; only its result is kept. Pure:
   * it may run more than once for a session (the last result counts).
   */
  readonly analyze: (s: LoadedSession) => R;
}

/** What loading found besides the sessions: the counts discoveryNotes reports. */
export interface LoadCounts {
  /** Files discovered before any filtering (tells a brand-new user from an empty window). */
  readonly discovered: number;
  /** Session files that could not be read. */
  readonly unreadable: number;
  /** Folders discovery could not list. */
  readonly unreadableFolders: number;
  /** Compressed logs skipped on purpose (Codex `.jsonl.zst`). */
  readonly skippedCompressed: number;
  /** Files read for their request keys only (they can hold copies), not returned. */
  readonly scannedOnly: number;
  /** Requests dropped from returned sessions as copies another file keeps. */
  readonly droppedDuplicateRequests: number;
  readonly issues: SipcodeIssue[];
}

export interface LoadSessionsOutput<R> extends LoadCounts {
  /** Each returned session's analysis, in discovery order (newest file first). */
  readonly sessions: Array<{ readonly meta: SessionMeta; readonly value: R }>;
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
export function discoveryNotes(o: LoadCounts): string[] {
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

type Read =
  | {
      readonly ok: true;
      readonly session: ParsedSession;
      /** Characters and UTF-8 bytes read (the text itself is not kept: a log can be hundreds of MB). */
      readonly chars: number;
      readonly bytes: number;
    }
  | { readonly ok: false; readonly unreadable: boolean; readonly issues: SipcodeIssue[] };

/** Read and parse one file; `maxChars` cuts text appended since an earlier read of it. */
async function readParse(agent: Agent, deps: AgentDeps, meta: SessionMeta, maxChars?: number): Promise<Read> {
  let text: string;
  try {
    text = await deps.fs.readFile(meta.filePath);
  } catch {
    return { ok: false, unreadable: true, issues: [] };
  }
  if (maxChars !== undefined && text.length > maxChars) text = text.slice(0, maxChars);
  const parsed = agent.parseTranscript(text);
  return parsed.ok
    ? { ok: true, session: parsed.value, chars: text.length, bytes: Buffer.byteLength(text, "utf8") }
    : { ok: false, unreadable: false, issues: parsed.error };
}

export async function loadSessions<R>(
  input: LoadSessionsInput<R>,
): Promise<Result<LoadSessionsOutput<R>, SipcodeIssue[]>> {
  const { agent, deps, cwd } = input;
  const discovery = await discoverAgentSessions(agent, deps);
  if (!discovery.ok) return discovery;
  const found = discovery.value;
  const all = found.sessions;
  const n = all.length;
  const scan = agent.scanRequestKeys?.bind(agent);
  const since = scan ? input.windowSinceMs : undefined;
  const cache = input.cache ?? null;
  const needs = input.needsToolCalls;

  // Returned: in --here scope and (with a window) written inside it.
  const reported = new Uint8Array(n);
  all.forEach((m, i) => {
    const inScope = !input.here || agent.matchesCwd(m, cwd);
    if (inScope && (since === undefined || m.mtimeMs >= since)) reported[i] = 1;
  });
  const byFile = new Map<string, number>();
  all.forEach((m, i) => {
    if (!byFile.has(m.filePath)) byFile.set(m.filePath, i);
  });

  const index = new DedupeIndex(n);
  const fromCache = new Uint8Array(n);
  /** Characters read from each parsed file (a re-read is cut there). */
  const textChars = new Map<number, number>();
  const results = new Map<number, R>();
  const dropped = new Map<number, number>();
  const issues: SipcodeIssue[] = [...found.issues];
  let unreadable = found.unreadable;
  let scannedOnly = 0;

  // Files not returned that can hold a copy of a returned session's request
  // claim their request keys (an older original keeps its requests). They are
  // added before that session is analyzed, so they never change its result.
  const claimers = claimerQueue(agent, all, (i) => !reported[i] && (!input.here || agent.matchesCwd(all[i]!, cwd)));
  const addClaimers = async (target: SessionMeta, startedAt: string | undefined): Promise<void> => {
    for (const i of claimers({ meta: target, startedAt })) {
      const meta = all[i]!;
      let text: string;
      try {
        text = await deps.fs.readFile(meta.filePath);
      } catch {
        unreadable++;
        continue;
      }
      if (scan) {
        const k = scan(text);
        index.addKeys(i, { startedAt: k.startedAt, endedAt: k.endedAt, turns: k.keys.length + k.keylessTurns }, k.keys);
      } else {
        const p = agent.parseTranscript(text);
        if (!p.ok) continue;
        const t = p.value.assistantTurns;
        index.addKeys(
          i,
          { startedAt: p.value.startedAt, endedAt: p.value.endedAt, turns: t.length },
          t.flatMap((x) => (x.requestKey ? [x.requestKey] : [])),
        );
      }
      scannedOnly++;
    }
  };

  /** Analyze session i deduped as of now; a usage-only one is read in full first when its tool calls are needed. */
  const analyze = async (i: number, s: ParsedSession, full: boolean): Promise<void> => {
    const meta = all[i]!;
    const d = index.apply(i, s);
    let session = d.session;
    if (!full && needs?.({ meta, parsed: session })) {
      const r = await readParse(agent, deps, meta);
      // Unreadable now: keep the usage-only session (totals stay right).
      if (r.ok) session = index.apply(i, r.session).session;
    }
    dropped.set(i, d.dropped);
    results.set(i, input.analyze({ meta, parsed: session }));
    index.settle(i);
  };

  /** Pass 1 for one returned session: its copy candidates, then index and analyze it. */
  const first = async (i: number, s: ParsedSession, full: boolean): Promise<void> => {
    await addClaimers(all[i]!, s.startedAt);
    index.add(i, s);
    await analyze(i, s, full);
  };

  // Pass 1a: returned sessions the cache holds unchanged.
  let cacheDirty = false;
  let writer: UsageCacheWriter | undefined;
  const parsedNow = new Uint8Array(n);
  const added = new Uint8Array(n);
  if (cache) {
    const header = cacheHeader();
    let lineNo = 0;
    try {
      for await (const line of cache.lines()) {
        if (lineNo++ === 0) {
          if (line !== header) {
            cacheDirty = true;
            break;
          }
          continue;
        }
        if (!line) continue;
        const file = entryFile(line);
        const i = file === undefined ? undefined : byFile.get(file);
        if (i === undefined) {
          cacheDirty = true; // a deleted file, or a damaged line
          continue;
        }
        if (!reported[i] || added[i]) continue;
        const e = decodeEntry(line);
        if (!e || e.mtimeMs !== all[i]!.mtimeMs || e.size !== all[i]!.size) continue; // parsed below
        fromCache[i] = 1;
        added[i] = 1;
        await first(i, e.session, false);
      }
    } catch {
      // The rest of the cache cannot be read: those files are parsed.
      cacheDirty = true;
    }
  }

  // Pass 1b: the other returned sessions, read and parsed, oldest file first
  // (an original before the files resumed from it, so they rarely need pass 2).
  // One file per call: nothing of a file outlives its call (a log can be
  // hundreds of MB; a loop body would keep the last one alive across the
  // next read).
  const parseOne = async (i: number): Promise<void> => {
    const meta = all[i]!;
    const r = await readParse(agent, deps, meta);
    if (cache) {
      parsedNow[i] = 1;
      cacheDirty = true;
    }
    if (!r.ok) {
      if (r.unreadable) unreadable++;
      issues.push(...r.issues);
      return;
    }
    added[i] = 1;
    textChars.set(i, r.chars);
    if (cache && r.bytes === meta.size) {
      if (!writer) {
        writer = cache.writer();
        await writer.add(cacheHeader());
      }
      await writer.add(encodeEntry(meta.filePath, meta.mtimeMs, meta.size, r.session));
    }
    await first(i, r.session, true);
  };
  for (let i = n - 1; i >= 0; i--) {
    if (reported[i] && !added[i]) await parseOne(i);
  }

  // Pass 2: sessions a later file changed after they were analyzed, read
  // again (from the cache when they came from it) and analyzed as deduped
  // over every file.
  const redo = new Set<number>();
  for (const i of results.keys()) if (!index.isSettled(i)) redo.add(i);
  const again = async (i: number, s: ParsedSession, full: boolean): Promise<void> => {
    await analyze(i, s, full);
    redo.delete(i);
  };
  if (cache && [...redo].some((i) => fromCache[i])) {
    let lineNo = 0;
    try {
      for await (const line of cache.lines()) {
        if (lineNo++ === 0) continue;
        const file = entryFile(line);
        const i = file === undefined ? undefined : byFile.get(file);
        if (i === undefined || !fromCache[i] || !redo.has(i)) continue;
        const e = decodeEntry(line);
        if (e && e.mtimeMs === all[i]!.mtimeMs && e.size === all[i]!.size) await again(i, e.session, false);
      }
    } catch {
      // Whatever is left is parsed below.
    }
  }
  for (const i of [...redo].sort((a, b) => b - a)) {
    const r = await readParse(agent, deps, all[i]!, textChars.get(i));
    if (!r.ok) {
      // Gone or changed since pass 1: counted like any unreadable file.
      results.delete(i);
      dropped.delete(i);
      if (r.unreadable) unreadable++;
      issues.push(...r.issues);
      continue;
    }
    await again(i, r.session, true);
  }

  // The new cache: entries parsed now, then the old entries still in use.
  if (cache && cacheDirty) {
    if (!writer) {
      writer = cache.writer();
      await writer.add(cacheHeader());
    }
    const header = cacheHeader();
    const kept = new Uint8Array(n);
    let lineNo = 0;
    try {
      for await (const line of cache.lines()) {
        if (lineNo++ === 0) {
          if (line !== header) break;
          continue;
        }
        const file = entryFile(line);
        const i = file === undefined ? undefined : byFile.get(file);
        // Entries of files this run did not look at (--here, a window) stay while the file exists.
        if (i === undefined || parsedNow[i] || kept[i]) continue;
        kept[i] = 1;
        await writer.add(line);
      }
    } catch {
      // Keep what was written: the rest is parsed next time.
    }
    await writer.commit();
  } else if (writer) {
    await writer.discard();
  }

  const sessions: Array<{ meta: SessionMeta; value: R }> = [];
  for (let i = 0; i < n; i++) {
    if (results.has(i)) sessions.push({ meta: all[i]!, value: results.get(i)! });
  }
  let droppedDuplicateRequests = 0;
  for (const d of dropped.values()) droppedDuplicateRequests += d;
  return ok({
    sessions,
    discovered: n,
    unreadable,
    unreadableFolders: found.unreadableFolders,
    skippedCompressed: found.skippedCompressed,
    scannedOnly,
    droppedDuplicateRequests,
    issues,
  });
}

/** Clock and write-order jitter allowed by Claude Code's copy-window rule (claimerQueue). */
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
 * Copy candidates, each handed out once: take(target) returns the files not
 * yet taken (among the `eligible` ones) that can hold a copy of one of the
 * target's requests. Files that cannot hold one cannot change what the
 * target keeps, so they are never read.
 * Claude Code: a resumed session stays in its project folder, and copied
 * lines keep their original timestamps, so every request in a target is
 * logged at or after the target's (as logged) start; a file holding the same
 * request was written at or after that moment too. A file in another folder,
 * or last written before the target started, holds none of its requests.
 * Codex: forks may restamp copied history and run in another folder, so only
 * the family links decide (codexFamilies).
 * Other agents: every log.
 */
export function claimerQueue(
  agent: Agent,
  all: ReadonlyArray<SessionMeta>,
  eligible: (i: number) => boolean,
): (target: { readonly meta: SessionMeta; readonly startedAt: string | undefined }) => number[] {
  // Groups of eligible files, each newest first (discovery order).
  const groups = new Map<string | null, number[]>();
  const family = agent.id === "codex" ? codexFamilies(all) : undefined;
  const groupOf = (m: SessionMeta): string | null =>
    agent.id === "claude-code" ? m.projectHash : family ? family(m) : "";
  all.forEach((m, i) => {
    if (!eligible(i)) return;
    const g = groupOf(m);
    const list = groups.get(g);
    if (list) list.push(i);
    else groups.set(g, [i]);
  });
  const takeAll = (g: string | null): number[] => {
    const list = groups.get(g) ?? [];
    groups.delete(g);
    return list;
  };
  return (t) => {
    if (agent.id === "claude-code") {
      const list = groups.get(t.meta.projectHash);
      if (!list) return [];
      const start = t.startedAt ? Date.parse(t.startedAt) : NaN;
      const since = Number.isFinite(start) ? start - COPY_WINDOW_SLACK_MS : Number.NEGATIVE_INFINITY;
      let k = 0;
      while (k < list.length && all[list[k]!]!.mtimeMs >= since) k++;
      return list.splice(0, k);
    }
    if (family) {
      const f = family(t.meta);
      // An open target can share requests with any log; an open log with any target.
      if (f === null) return [...groups.keys()].flatMap(takeAll);
      return [...takeAll(f), ...takeAll(null)];
    }
    return takeAll("");
  };
}

/**
 * Single-session commands (why / receipt): drop from each target the
 * requests another file of the same agent also holds and that file keeps,
 * by the period commands' rule (dedupeAcrossSessions: the session that
 * started first keeps a request). A resumed Claude Code session or a Codex
 * fork then reports only its own requests; reads in the dropped history
 * become priorReads, so a later read of the same file still counts as a
 * re-read. Only files that can hold a copy (claimerQueue) are read, and
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
  const take = claimerQueue(agent, i.all, (k) => !targetFiles.has(i.all[k]!.filePath));
  const candidates = targets
    .flatMap((t) => take({ meta: t.meta, startedAt: t.parsed.startedAt }))
    .sort((a, b) => a - b);
  for (const k of candidates) {
    const meta = i.all[k]!;
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
