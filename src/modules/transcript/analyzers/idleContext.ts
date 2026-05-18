/**
 * Idle-context analyzer — M009.
 * Pure.
 *
 * Heuristic: a file is "idle" if it was Read once, then was not referenced
 * (by Read again, by Edit, by Write, by Bash) for >= IDLE_TURN_THRESHOLD
 * subsequent assistant turns through end-of-session.
 *
 * Cost: per-turn input-tokens-while-in-context, roughly = file's
 * first-read input_tokens × idle_turn_count. We use the per-call
 * cache_read cost as the in-context "drag" since after the first read
 * the file lives in cache; tokens × cache_read_per_mtok is the actual
 * recurring cost.
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
      const cost = first.cost * idleTurns;
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
