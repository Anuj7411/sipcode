/**
 * find command rewriter — same pattern as ls but with head -100.
 * find typically returns more entries than ls so the cap is higher.
 */
import type { RewriterFn } from "../types.js";
import { commandStartsWith, hasOutputLimit, capLines } from "./base.js";

const HEAD_LIMIT = 100;

export const rewriteFind: RewriterFn = (input) => {
  const cmd = String(input.command ?? "").trim();
  if (!commandStartsWith(cmd, "find") && !commandStartsWith(cmd, "fd")) return null;
  if (hasOutputLimit(cmd)) return null;
  if (cmd.includes("&&") || cmd.includes("||") || cmd.includes(";") || cmd.includes("|")) {
    return null;
  }
  const updated = capLines(cmd, HEAD_LIMIT);
  return {
    updatedInput: { ...input, command: updated },
    savedTokensEstimate: 2500,
    rewriterName: "find",
    integrityScore: 0.5,
    integrityNote: "kept first 100 entries via head pipe; tail entries dropped",
  };
};
