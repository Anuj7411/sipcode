/**
 * ls / dir command rewriter.
 * Appends `| head -50` when output is not already length-limited.
 */
import type { RewriterFn } from "../types.js";
import { commandStartsWith, hasOutputLimit } from "./base.js";

const HEAD_LIMIT = 50;

export const rewriteLs: RewriterFn = (input) => {
  const cmd = String(input.command ?? "").trim();
  const isLs = commandStartsWith(cmd, "ls") || commandStartsWith(cmd, "dir");
  if (!isLs) return null;
  if (hasOutputLimit(cmd)) return null;
  // Don't append a pipe when there's already shell glue we don't understand.
  if (cmd.includes("&&") || cmd.includes("||") || cmd.includes(";") || cmd.includes("|")) {
    return null;
  }
  const updated = `${cmd} | head -${HEAD_LIMIT}`;
  return {
    updatedInput: { ...input, command: updated },
    savedTokensEstimate: 1500,
    rewriterName: "ls",
    integrityScore: 0.6,
    integrityNote: "kept first 50 entries via head pipe; tail entries dropped",
  };
};
