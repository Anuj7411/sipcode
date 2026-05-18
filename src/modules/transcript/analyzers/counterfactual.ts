/**
 * Counterfactual savings — M012, M013, M014. Pure.
 *
 * Each is a conservative heuristic. We never claim more savings than there is
 * spend to save. Tunables live in this file so they're easy to revisit.
 */
import type { ParsedSession, ToolCall } from "../parse.js";
import type { DuplicateReadsResult } from "./duplicateReads.js";

export interface CounterfactualSavings {
  /** M012 — savings if S001 (Smart Manifest) were active. */
  readonly s001_manifest: number;
  /** M013 — savings if S030 (Read-Once Cache) were active. */
  readonly s030_readOnce: number;
  /** M014 — savings if S021 (Diff-Output Enforcement) were active. */
  readonly s021_diffOutput: number;
  /** Total estimated savings. */
  readonly total: number;
}

const MANIFEST_SAVINGS_RATE = 0.22; // 20–35% of input — conservative middle.

/** Tools whose output Claude would have written as a full-file replacement. */
const EDIT_LIKE_TOOLS = new Set(["Edit", "Write", "edit_file", "write_file"]);

const DIFF_OUTPUT_SAVINGS_RATE = 0.85; // 80–95% on edits.

function isExploratoryRead(call: ToolCall): boolean {
  // Heuristic: a Read with no Edit downstream is "exploratory."
  // For now, we just discount all Reads at a fixed rate.
  return call.name === "Read";
}

export function analyzeCounterfactual(
  session: ParsedSession,
  dupReads: DuplicateReadsResult,
): CounterfactualSavings {
  // M012: smart manifest reduces input-token bloat by some fraction.
  const totalInput = session.assistantTurns.reduce(
    (acc, t) => acc + t.inputTokens + t.cacheCreationTokens,
    0,
  );
  // Manifest can only save tokens that came from system/project context, not
  // user prompts or tool outputs. We approximate with cache_creation alone,
  // since system prompts and stable context get cached.
  const cacheCreationTotal = session.assistantTurns.reduce(
    (acc, t) => acc + t.cacheCreationTokens,
    0,
  );
  const s001 = Math.round(cacheCreationTotal * MANIFEST_SAVINGS_RATE);

  // M013: read-once cache exactly saves the duplicate-read cost.
  const s030 = dupReads.duplicateReadTokenCost;

  // M014: diff-output replaces full-file writes with diffs.
  let editTokens = 0;
  for (const call of session.toolCalls) {
    if (EDIT_LIKE_TOOLS.has(call.name)) {
      editTokens += call.outputTokens;
    }
  }
  const s021 = Math.round(editTokens * DIFF_OUTPUT_SAVINGS_RATE);

  // Defensive ceiling: total savings can't exceed total spend.
  const totalSpend =
    totalInput +
    session.assistantTurns.reduce((acc, t) => acc + t.outputTokens, 0);

  const raw = s001 + s030 + s021;
  const total = Math.min(raw, totalSpend);

  // Suppress unused-fn warning while keeping the heuristic available.
  void isExploratoryRead;

  return {
    s001_manifest: s001,
    s030_readOnce: s030,
    s021_diffOutput: s021,
    total,
  };
}
