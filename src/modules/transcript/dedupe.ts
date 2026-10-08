/**
 * Cross-session request dedupe. Pure.
 *
 * Claude Code copies earlier requests into the new file when a session is
 * resumed, and Codex copies a parent's history into fork / subagent rollouts.
 * Summing each file on its own counts those requests twice (11.4% on one real
 * machine). The session with the oldest start time keeps each request; later
 * copies are dropped. Ordering: see dedupeAcrossSessions.
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
  const order = sessions
    .map((s, i) => ({
      s,
      i,
      start: parseTime(s.startedAt) ?? Number.POSITIVE_INFINITY,
      end: parseTime(s.endedAt) ?? Number.POSITIVE_INFINITY,
    }))
    .sort(
      (a, b) =>
        cmp(a.start, b.start) ||
        cmp(a.end, b.end) ||
        cmp(a.s.assistantTurns.length, b.s.assistantTurns.length) ||
        a.i - b.i,
    );
  // Resumed files re-log some copied requests with the top-level usage zeroed.
  // Whichever copy wins the ordering must carry the largest value per field
  // across all copies (same rule as the within-file merge in parseTranscript).
  const maxUsage = new Map<string, Usage>();
  for (const s of sessions) {
    for (const t of s.assistantTurns) {
      if (!t.requestKey) continue;
      const m = maxUsage.get(t.requestKey);
      if (!m) maxUsage.set(t.requestKey, usageOf(t));
      else
        for (const f of USAGE_FIELDS) if (t[f] > m[f]) m[f] = t[f];
    }
  }
  const seen = new Set<string>();
  const out: ParsedSession[] = sessions.slice();
  let dropped = 0;
  for (const { s, i } of order) {
    const keep: number[] = [];
    const maxed = new Map<number, AssistantTurn>();
    s.assistantTurns.forEach((t, idx) => {
      if (t.requestKey) {
        if (seen.has(t.requestKey)) {
          dropped++;
          return;
        }
        seen.add(t.requestKey);
        const m = maxUsage.get(t.requestKey)!;
        if (USAGE_FIELDS.some((f) => t[f] < m[f])) maxed.set(idx, withUsage(t, m));
      }
      keep.push(idx);
    });
    out[i] =
      keep.length === s.assistantTurns.length && maxed.size === 0 ? s : rebuild(s, keep, maxed);
  }
  return { sessions: out, droppedRequests: dropped };
}

const USAGE_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheCreationTokens",
  "cacheCreation1hTokens",
] as const;
type Usage = { -readonly [K in (typeof USAGE_FIELDS)[number]]: number };

function usageOf(t: AssistantTurn): Usage {
  return {
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    cacheReadTokens: t.cacheReadTokens,
    cacheCreationTokens: t.cacheCreationTokens,
    cacheCreation1hTokens: t.cacheCreation1hTokens,
  };
}

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
  // keep the (older) times of the copied history.
  let startMs: number | undefined;
  let endMs: number | undefined;
  let startedAt = s.startedAt;
  let endedAt = s.endedAt;
  for (const t of assistantTurns) {
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
    startMs !== undefined && endMs !== undefined
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
