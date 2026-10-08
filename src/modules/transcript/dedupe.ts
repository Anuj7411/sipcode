/**
 * Cross-session request dedupe. Pure.
 *
 * Claude Code copies earlier requests into the new file when a session is
 * resumed, and Codex copies a parent's history into fork / subagent rollouts.
 * Summing each file on its own counts those requests twice (11.4% on one real
 * machine). The session with the oldest start time keeps each request; later
 * copies are dropped. Undated sessions go last; ties keep input order.
 */
import type { AssistantTurn, ParsedSession } from "./parse.js";

export interface DedupeResult {
  /** Same order as the input. */
  readonly sessions: ParsedSession[];
  readonly droppedRequests: number;
}

export function dedupeAcrossSessions(
  sessions: ReadonlyArray<ParsedSession>,
): DedupeResult {
  const time = (s: ParsedSession): number => {
    const v = s.startedAt ? Date.parse(s.startedAt) : NaN;
    return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
  };
  const order = sessions
    .map((s, i) => ({ s, i, t: time(s) }))
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.i - b.i));
  const seen = new Set<string>();
  const out: ParsedSession[] = sessions.slice();
  let dropped = 0;
  for (const { s, i } of order) {
    const keep: number[] = [];
    s.assistantTurns.forEach((t, idx) => {
      if (t.requestKey) {
        if (seen.has(t.requestKey)) {
          dropped++;
          return;
        }
        seen.add(t.requestKey);
      }
      keep.push(idx);
    });
    out[i] = keep.length === s.assistantTurns.length ? s : rebuild(s, keep);
  }
  return { sessions: out, droppedRequests: dropped };
}

function rebuild(s: ParsedSession, keep: number[]): ParsedSession {
  const assistantTurns: AssistantTurn[] = keep.map((oldIdx, newIdx) => {
    const t = s.assistantTurns[oldIdx]!;
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
  return {
    ...s,
    assistantTurns,
    toolCalls: assistantTurns.flatMap((t) => t.toolCalls),
    models: new Set(counts.keys()),
    primaryModel,
  };
}
