/**
 * Top-5 most expensive tool calls. Pure.
 *
 * Each tool call inherits the cost of its parent assistant turn. Since
 * Claude Code can emit multiple tool_use blocks per assistant message,
 * we split the cost evenly across the same-turn calls.
 */
import type { ParsedSession, ToolCall } from "../parse.js";
import { normalizeFilePath } from "../../../lib/path-normalize.js";

export interface ExpensiveCall {
  readonly toolName: string;
  /** Short tag explaining why this turn cost a lot. */
  readonly reason:
    | "large-input"
    | "cache-creation"
    | "long-output"
    | "duplicate-read"
    | "ordinary";
  /** Token cost attributed to this single call. */
  readonly attributedTokens: number;
  /** Best-effort human label of what this call did (e.g. file path). */
  readonly label: string;
}

function inputFieldGuess(call: ToolCall): string | undefined {
  const input = call.input as Record<string, unknown> | undefined;
  if (!input || typeof input !== "object") return undefined;
  for (const key of ["file_path", "path", "command", "pattern", "url", "query"]) {
    const v = input[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

export function analyzeTopExpensive(
  session: ParsedSession,
): ReadonlyArray<ExpensiveCall> {
  // Count occurrences of each file path in Read calls — for "duplicate-read" tag.
  // v1.6.14 bug fix: key by NORMALIZED path so C:\foo and c:/foo collide
  // (same fix applied in hookReadDedup.ts and vsRtk.ts).
  const readCounts = new Map<string, number>();
  for (const c of session.toolCalls) {
    if (c.name !== "Read") continue;
    const p = inputFieldGuess(c);
    if (p) {
      const norm = normalizeFilePath(p);
      readCounts.set(norm, (readCounts.get(norm) ?? 0) + 1);
    }
  }

  // Group tool calls per assistant turn and split.
  const grouped = new Map<number, ToolCall[]>();
  for (const c of session.toolCalls) {
    const arr = grouped.get(c.assistantTurnIndex) ?? [];
    arr.push(c);
    grouped.set(c.assistantTurnIndex, arr);
  }

  const ranked: ExpensiveCall[] = [];
  for (const [turnIdx, calls] of grouped) {
    const turn = session.assistantTurns[turnIdx];
    if (!turn) continue;
    const total =
      turn.inputTokens +
      turn.outputTokens +
      turn.cacheReadTokens +
      turn.cacheCreationTokens;
    const perCall = total / Math.max(1, calls.length);
    for (const c of calls) {
      const reason: ExpensiveCall["reason"] =
        turn.cacheCreationTokens > turn.inputTokens
          ? "cache-creation"
          : turn.outputTokens > 1500
            ? "long-output"
            : turn.inputTokens > 10_000
              ? "large-input"
              : c.name === "Read" && (readCounts.get(inputFieldGuess(c) ?? "") ?? 0) > 1
                ? "duplicate-read"
                : "ordinary";
      ranked.push({
        toolName: c.name,
        reason,
        attributedTokens: Math.round(perCall),
        label: inputFieldGuess(c) ?? c.name,
      });
    }
  }

  ranked.sort((a, b) => b.attributedTokens - a.attributedTokens);
  return ranked.slice(0, 5);
}
