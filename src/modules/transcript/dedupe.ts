/**
 * Cross-session request dedupe. Pure.
 *
 * Claude Code copies earlier requests into the new file when a session is
 * resumed, and Codex copies a parent's history into fork / subagent rollouts.
 * Summing each file on its own counts those requests twice (11.4% on one real
 * machine). The session with the oldest start time keeps each request; later
 * copies are dropped. The kept copy carries the largest usage per field across
 * ALL copies, so the result does not depend on which copy wins the ordering.
 * Ordering: see dedupeAcrossSessions.
 */
import type { AssistantTurn, ParsedSession } from "./parse.js";
import { extractReadPath } from "./readPaths.js";
import { normalizeFilePath } from "../../lib/path-normalize.js";

export interface DedupeResult {
  /** Same order as the input. */
  readonly sessions: ParsedSession[];
  readonly droppedRequests: number;
}

/**
 * Order: parsed startedAt ascending (undated last), then endedAt ascending
 * (undated last), then fewer assistant turns first, then input index. A
 * resumed file copies its parent's lines with their original timestamps, so
 * equal startedAt is the normal case; the parent ends earlier / is shorter and
 * therefore keeps the shared requests. Request keys repeated inside one
 * session are also dropped (relevant for Codex).
 */
export function dedupeAcrossSessions(
  sessions: ReadonlyArray<ParsedSession>,
): DedupeResult {
  const ix = new DedupeIndex(sessions.length);
  sessions.forEach((s, i) => ix.add(i, s));
  let dropped = 0;
  const out = sessions.map((s, i) => {
    const r = ix.apply(i, s);
    dropped += r.dropped;
    return r.session;
  });
  return { sessions: out, droppedRequests: dropped };
}

/** What ordering needs from a session: its time span (as parsed) and turn count. */
export interface DedupeOrder {
  readonly startedAt: string | undefined;
  readonly endedAt: string | undefined;
  readonly turns: number;
}

/**
 * dedupeAcrossSessions without holding the sessions: each session is added
 * once (its request keys, usage and order) and can be passed to apply() at
 * any time to get its deduped form given the sessions added so far. Memory is
 * per request key (owner, largest usage), not per session, so callers can
 * read, add, analyze and drop one file at a time. Session numbers are the
 * input index of dedupeAcrossSessions (the order tie-break); they need not be
 * added in order.
 *
 * Exact by construction: the owner of a key is the first of its holders in
 * the order above (a running minimum), the kept turn is the owner's first
 * turn with that key, and it carries the largest value per field across all
 * copies. Once every session is added, apply(i) is what dedupeAcrossSessions
 * returns for i, and changed(i) is true exactly when apply(i) rewrites it.
 *
 * settle(i) records that the caller used apply(i) now; isSettled(i) stays
 * true while later additions leave that result as it is (they take none of
 * i's keys and raise none of the copies i keeps). Callers that add files
 * oldest first rarely see a settled session unsettle.
 */
export class DedupeIndex {
  private readonly slots = new KeyTable();
  /** Per key: the session that keeps it. */
  private owner = new Int32Array(1024);
  /** Per key: the largest value per USAGE_FIELDS field across all copies (5 numbers per key). */
  private max = new Float64Array(1024 * 5);
  private readonly start: Float64Array;
  private readonly end: Float64Array;
  private readonly turns: Float64Array;
  private readonly rewritten: Uint8Array;
  private readonly settled: Uint8Array;
  /** The session being added (its own claims never unsettle it). */
  private adding = -1;

  constructor(sessions: number) {
    this.start = new Float64Array(sessions);
    this.end = new Float64Array(sessions);
    this.turns = new Float64Array(sessions);
    this.rewritten = new Uint8Array(sessions);
    this.settled = new Uint8Array(sessions);
  }

  /** Session i with every turn (its usage counts toward each key's largest value). */
  add(i: number, s: ParsedSession): void {
    this.order(i, { startedAt: s.startedAt, endedAt: s.endedAt, turns: s.assistantTurns.length });
    const local = new Set<string>();
    this.adding = i;
    for (const t of s.assistantTurns) {
      if (t.requestKey) this.claim(i, t.requestKey, t, local);
    }
    this.adding = -1;
  }

  /** Session i known only by its request keys (a key scan): it claims them with zero usage. */
  addKeys(i: number, order: DedupeOrder, keys: Iterable<string>): void {
    this.order(i, order);
    const local = new Set<string>();
    this.adding = i;
    for (const k of keys) if (k) this.claim(i, k, ZERO, local);
    this.adding = -1;
  }

  /** Does dedupe rewrite session i (drop or raise any of its turns), given the sessions added so far? */
  changed(i: number): boolean {
    return this.rewritten[i] === 1;
  }

  /** The caller used apply(i) as of now. */
  settle(i: number): void {
    this.settled[i] = 1;
  }

  /** Is apply(i) still what it was at settle(i)? */
  isSettled(i: number): boolean {
    return this.settled[i] === 1;
  }

  /**
   * Session i deduped: the same object when nothing changes. `s` must be the
   * session added as i (a key this index never saw is kept as is).
   */
  apply(i: number, s: ParsedSession): { session: ParsedSession; dropped: number } {
    if (!this.changed(i)) return { session: s, dropped: 0 };
    const keep: number[] = [];
    const maxed = new Map<number, AssistantTurn>();
    const local = new Set<string>();
    s.assistantTurns.forEach((t, idx) => {
      const k = t.requestKey;
      if (k) {
        if (local.has(k)) return;
        local.add(k);
        const slot = this.slots.get(k);
        if (slot !== undefined) {
          if (this.owner[slot] !== i) return;
          const at = slot * 5;
          if (USAGE_FIELDS.some((f, n) => t[f] < this.max[at + n]!)) {
            const m = {} as Usage;
            USAGE_FIELDS.forEach((f, n) => (m[f] = this.max[at + n]!));
            maxed.set(idx, withUsage(t, m));
          }
        }
      }
      keep.push(idx);
    });
    const dropped = s.assistantTurns.length - keep.length;
    const session =
      keep.length === s.assistantTurns.length && maxed.size === 0 ? s : rebuild(s, keep, maxed);
    return { session, dropped };
  }

  private order(i: number, o: DedupeOrder): void {
    this.start[i] = parseTime(o.startedAt) ?? Number.POSITIVE_INFINITY;
    this.end[i] = parseTime(o.endedAt) ?? Number.POSITIVE_INFINITY;
    this.turns[i] = o.turns;
  }

  /** Does session a come before session b in the dedupe order? */
  private before(a: number, b: number): boolean {
    return (
      (cmp(this.start[a]!, this.start[b]!) ||
        cmp(this.end[a]!, this.end[b]!) ||
        cmp(this.turns[a]!, this.turns[b]!) ||
        a - b) < 0
    );
  }

  /** Session o's result changes (it loses a key, or a copy it keeps is raised). */
  private touch(o: number): void {
    this.rewritten[o] = 1;
    if (o !== this.adding) this.settled[o] = 0;
  }

  private claim(i: number, k: string, u: Usage, local: Set<string>): void {
    let slot = this.slots.get(k);
    if (slot === undefined) {
      slot = this.slots.add(k);
      if (slot === this.owner.length) {
        const owner = new Int32Array(slot * 2);
        owner.set(this.owner);
        this.owner = owner;
        const max = new Float64Array(slot * 2 * 5);
        max.set(this.max);
        this.max = max;
      }
      this.owner[slot] = i;
      USAGE_FIELDS.forEach((f, n) => (this.max[slot! * 5 + n] = u[f]));
      local.add(k);
      return;
    }
    const at = slot * 5;
    const exceedsMax = USAGE_FIELDS.some((f, n) => u[f] > this.max[at + n]!);
    if (local.has(k)) {
      // Repeated inside session i: the repeat is dropped; a larger value raises the kept copy.
      this.rewritten[i] = 1;
      if (exceedsMax) this.touch(this.owner[slot]!);
    } else {
      local.add(k);
      const o = this.owner[slot]!;
      if (this.before(i, o)) {
        // i keeps the key now: o drops its copy; i's copy is raised if an earlier copy was larger.
        this.touch(o);
        this.owner[slot] = i;
        if (USAGE_FIELDS.some((f, n) => this.max[at + n]! > u[f])) this.rewritten[i] = 1;
      } else {
        this.rewritten[i] = 1;
        if (exceedsMax) this.touch(o);
      }
    }
    USAGE_FIELDS.forEach((f, n) => {
      if (u[f] > this.max[at + n]!) this.max[at + n] = u[f];
    });
  }
}

const USAGE_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheCreationTokens",
  "cacheCreation1hTokens",
] as const;
type Usage = { -readonly [K in (typeof USAGE_FIELDS)[number]]: number };
const ZERO: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, cacheCreation1hTokens: 0 };

/** Copy of the turn carrying `u`; its tool calls mirror the turn's usage like parseTranscript stamps them. */
function withUsage(t: AssistantTurn, u: Usage): AssistantTurn {
  const totalTokens = u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheCreationTokens;
  return {
    ...t,
    ...u,
    missingUsage: t.missingUsage && totalTokens === 0,
    toolCalls: t.toolCalls.map((c) => ({
      ...c,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheCreationTokens: u.cacheCreationTokens,
      totalTokens,
    })),
  };
}

function cmp(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function parseTime(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : undefined;
}

function rebuild(
  s: ParsedSession,
  keep: number[],
  maxed: ReadonlyMap<number, AssistantTurn>,
): ParsedSession {
  const kept = new Set(keep);
  // Copied history is assumed to precede a file's own requests (true for
  // Claude resume and Codex forks on all observed data), so every read of a
  // prior-read path is a re-read.
  const priorReads = new Set<string>(s.priorReads ?? []);
  s.assistantTurns.forEach((t, idx) => {
    if (kept.has(idx)) return;
    for (const c of t.toolCalls) {
      const p = extractReadPath(c);
      if (p) priorReads.add(normalizeFilePath(p));
    }
  });
  const assistantTurns: AssistantTurn[] = keep.map((oldIdx, newIdx) => {
    const t = maxed.get(oldIdx) ?? s.assistantTurns[oldIdx]!;
    return {
      ...t,
      index: newIdx,
      toolCalls: t.toolCalls.map((c) => ({ ...c, assistantTurnIndex: newIdx })),
    };
  });
  const counts = new Map<string, number>();
  for (const t of assistantTurns) if (t.model) counts.set(t.model, (counts.get(t.model) ?? 0) + 1);
  let primaryModel: string | undefined;
  let best = -1;
  for (const [m, c] of counts) {
    if (c > best) {
      best = c;
      primaryModel = m;
    }
  }
  // Recompute the time span from the kept turns so a resumed file does not
  // keep the (older) times of the copied history. Only when turns were dropped:
  // the parsed span also covers user-line timestamps, which a raise-only
  // session (usage maxed, nothing dropped) must keep.
  let startMs: number | undefined;
  let endMs: number | undefined;
  let startedAt = s.startedAt;
  let endedAt = s.endedAt;
  const droppedTurns = keep.length < s.assistantTurns.length;
  for (const t of droppedTurns ? assistantTurns : []) {
    const ms = parseTime(t.timestamp);
    if (ms === undefined) continue;
    if (startMs === undefined || ms < startMs) {
      startMs = ms;
      startedAt = t.timestamp;
    }
    if (endMs === undefined || ms > endMs) {
      endMs = ms;
      endedAt = t.timestamp;
    }
  }
  const durationSec =
    droppedTurns && startMs !== undefined && endMs !== undefined
      ? Math.max(0, Math.floor((endMs - startMs) / 1000))
      : s.durationSec;
  return {
    ...s,
    assistantTurns,
    toolCalls: assistantTurns.flatMap((t) => t.toolCalls),
    models: new Set(counts.keys()),
    primaryModel,
    startedAt,
    endedAt,
    durationSec,
    priorReads,
  };
}

/**
 * Request key → slot number (0, 1, 2, … in insertion order). Keys are kept
 * as UTF-8 bytes in one growing buffer with an open-addressing table over
 * them: about a third of the memory of a Map of strings, which matters with
 * hundreds of thousands of keys held while every log is read.
 */
export class KeyTable {
  private bytes = new Uint8Array(1 << 16);
  private used = 0;
  private offs = new Int32Array(1024);
  private lens = new Int32Array(1024);
  /** slot + 1 per bucket; 0 = empty. Size is a power of two, at most half full. */
  private buckets = new Int32Array(2048);
  private count = 0;
  private scratch = Buffer.alloc(256);

  get size(): number {
    return this.count;
  }

  /** The key's slot, or undefined. */
  get(k: string): number | undefined {
    const len = this.encode(k);
    const mask = this.buckets.length - 1;
    for (let b = hash(this.scratch, len) & mask; ; b = (b + 1) & mask) {
      const v = this.buckets[b]!;
      if (v === 0) return undefined;
      if (this.equals(v - 1, len)) return v - 1;
    }
  }

  /** Adds a key not in the table; returns its slot. */
  add(k: string): number {
    const len = this.encode(k);
    const slot = this.count++;
    if (slot === this.offs.length) {
      this.offs = grow(this.offs, slot * 2);
      this.lens = grow(this.lens, slot * 2);
    }
    if (this.used + len > this.bytes.length) {
      const next = new Uint8Array(Math.max(this.bytes.length * 2, this.used + len));
      next.set(this.bytes.subarray(0, this.used));
      this.bytes = next;
    }
    this.bytes.set(this.scratch.subarray(0, len), this.used);
    this.offs[slot] = this.used;
    this.lens[slot] = len;
    this.used += len;
    if (this.count * 2 > this.buckets.length) this.rehash(this.buckets.length * 2);
    else this.place(slot, hash(this.scratch, len));
    return slot;
  }

  /** UTF-8 bytes of k into scratch; returns their count. */
  private encode(k: string): number {
    if (k.length * 3 > this.scratch.length) this.scratch = Buffer.alloc(k.length * 3);
    return this.scratch.write(k, 0, "utf8");
  }

  private equals(slot: number, len: number): boolean {
    if (this.lens[slot] !== len) return false;
    const off = this.offs[slot]!;
    for (let j = 0; j < len; j++) if (this.bytes[off + j] !== this.scratch[j]) return false;
    return true;
  }

  private place(slot: number, h: number): void {
    const mask = this.buckets.length - 1;
    let b = h & mask;
    while (this.buckets[b] !== 0) b = (b + 1) & mask;
    this.buckets[b] = slot + 1;
  }

  private rehash(size: number): void {
    this.buckets = new Int32Array(size);
    for (let s = 0; s < this.count; s++) {
      const off = this.offs[s]!;
      this.place(s, hash(this.bytes.subarray(off, off + this.lens[s]!), this.lens[s]!));
    }
  }
}

function grow(a: Int32Array<ArrayBuffer>, size: number): Int32Array<ArrayBuffer> {
  const next = new Int32Array(size);
  next.set(a);
  return next;
}

/** FNV-1a over the first `len` bytes. */
function hash(b: Uint8Array, len: number): number {
  let h = 0x811c9dc5;
  for (let j = 0; j < len; j++) {
    h ^= b[j]!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
