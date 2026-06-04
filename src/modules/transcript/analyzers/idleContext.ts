/**
 * Idle-context analyzer — M009.
 * Pure.
 *
 * Heuristic: a file is "idle" if it was Read once, then was not referenced
 * (by Read again, by Edit, by Write, by Bash) for >= IDLE_TURN_THRESHOLD
 * subsequent assistant turns through end-of-session.
 *
 * Cost model (CORRECTNESS FIX, v1.4.0): the wasted token cost of an idle
 * file is the ONE-TIME read that brought it into context, not that cost
 * multiplied by the number of idle turns. The earlier per-turn
 * multiplication produced mathematically impossible aggregate numbers —
 * for example, a 363K-token file held idle for 451 turns reported 164M
 * "wasted" tokens in a session that totaled only 316M tokens. The
 * resident-cache cost is paid ONCE; the file simply sitting in cache on
 * subsequent turns doesn't re-bill its full size each turn (cache_read
 * pricing already counts the bytes we actually re-sent on each call,
 * which is already in the session totals as cacheReadTokens).
 *
 * Invariant guarded by tests: sum(idleTokenCost) <= session totalTokens.
 * If you see ">= totalTokens" anywhere downstream, this analyzer is the
 * bug to look at first.
 */
import path from "node:path";
import type { ParsedSession, ToolCall } from "../parse.js";

const IDLE_TURN_THRESHOLD = 5;

const READ_TOOLS: Record<string, string> = {
  Read: "file_path",
  read_file: "path",
};
const REFERENCE_TOOLS: Record<string, string[]> = {
  Read: ["file_path"],
  Edit: ["file_path"],
  Write: ["file_path"],
  read_file: ["path"],
  edit_file: ["path"],
};

function normalizeFilePath(p: string): string {
  let s = p.replace(/\\/g, "/");
  s = s.replace(/^([A-Z]):/, (_m, d: string) => d.toLowerCase() + ":");
  try {
    s = path.posix.normalize(s);
  } catch {
    /* ignore */
  }
  return s;
}

function pathFromCall(call: ToolCall, fields: string[]): string | undefined {
  const input = call.input as Record<string, unknown> | undefined;
  if (!input || typeof input !== "object") return undefined;
  for (const f of fields) {
    const v = input[f];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

export interface IdleFile {
  readonly filePath: string;
  readonly firstReadTurn: number;
  readonly idleTurns: number;
  readonly idleTokenCost: number;
}

export interface IdleContextResult {
  /** M009 */ readonly idleTokenCost: number;
  readonly idleFiles: ReadonlyArray<IdleFile>;
}

export function analyzeIdleContext(session: ParsedSession): IdleContextResult {
  // For each path, find first read turn and last reference turn.
  const firstRead = new Map<
    string,
    { displayPath: string; turn: number; cost: number }
  >();
  const lastRef = new Map<string, number>();

  for (const call of session.toolCalls) {
    const fields = REFERENCE_TOOLS[call.name];
    if (!fields) continue;
    const p = pathFromCall(call, fields);
    if (!p) continue;
    const norm = normalizeFilePath(p);
    lastRef.set(norm, call.assistantTurnIndex);

    if (READ_TOOLS[call.name]) {
      if (!firstRead.has(norm)) {
        firstRead.set(norm, {
          displayPath: p,
          turn: call.assistantTurnIndex,
          // Per-turn carry cost. Cache_read tokens are the cheap "in-context" tokens.
          cost: call.cacheReadTokens || call.inputTokens,
        });
      }
    }
  }

  const lastTurn = Math.max(0, session.assistantTurns.length - 1);
  const idle: IdleFile[] = [];
  let total = 0;
  for (const [norm, first] of firstRead) {
    const ref = lastRef.get(norm) ?? first.turn;
    const idleTurns = lastTurn - ref;
    if (idleTurns >= IDLE_TURN_THRESHOLD) {
      // Wasted one-time read. Do NOT multiply by idleTurns — that
      // produces > total-session-tokens values. The cost is what was
      // paid to bring this file into context, full stop. The idleTurns
      // count is retained in the result for diagnostic surfacing (so a
      // user can see "this file sat idle for 451 turns") but does NOT
      // scale the cost.
      const cost = first.cost;
      total += cost;
      idle.push({
        filePath: first.displayPath,
        firstReadTurn: first.turn,
        idleTurns,
        idleTokenCost: cost,
      });
    }
  }
  idle.sort((a, b) => b.idleTokenCost - a.idleTokenCost);
  return { idleTokenCost: total, idleFiles: idle.slice(0, 10) };
}
