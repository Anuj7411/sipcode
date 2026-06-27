/**
 * grep (Bash) rewriter.
 *
 * For recursive grep without -c (count-only) or -l (file-list-only), add -c.
 * This collapses dozens of repeated match lines into "file: N" per file.
 *
 * For non-recursive grep without an output limit, pipe to `| head -50`.
 */
import type { RewriterFn } from "../types.js";
import { commandStartsWith, hasFlag, hasOutputLimit, hasShortFlag } from "./base.js";

const HEAD_LIMIT = 50;

export const rewriteGrep: RewriterFn = (input) => {
  const cmd = String(input.command ?? "").trim();
  const isGrep = commandStartsWith(cmd, "grep") || commandStartsWith(cmd, "rg");
  if (!isGrep) return null;

  const recursive =
    hasShortFlag(cmd, "r") || hasShortFlag(cmd, "R") || hasFlag(cmd, "--recursive");
  const countMode = hasShortFlag(cmd, "c") || hasFlag(cmd, "--count");
  const listMode = hasShortFlag(cmd, "l") || hasFlag(cmd, "--files-with-matches");
  const summaryMode = countMode || listMode;

  if (recursive && !summaryMode) {
    // If the caller explicitly asked for matching lines, line numbers, or
    // context, collapsing to -c (per-file counts) would throw away exactly that
    // content. Cap volume with head instead so the requested lines survive.
    const wantsLines =
      hasShortFlag(cmd, "n") ||
      hasShortFlag(cmd, "o") ||
      hasShortFlag(cmd, "A") ||
      hasShortFlag(cmd, "B") ||
      hasShortFlag(cmd, "C") ||
      hasFlag(cmd, "--line-number", "--only-matching", "--context");
    if (wantsLines) {
      if (!hasOutputLimit(cmd) && !cmd.includes("|")) {
        return {
          updatedInput: { ...input, command: `${cmd} | head -${HEAD_LIMIT}` },
          savedTokensEstimate: 1500,
          rewriterName: "grep",
          integrityScore: 0.6,
          integrityNote:
            "kept first 50 matching lines via head; later matches dropped",
        };
      }
      return null;
    }
    // Plain recursive grep (no line/context flags): collapse to per-file counts.
    const updated = cmd.replace(/^(\s*(?:grep|rg))/, "$1 -c");
    return {
      updatedInput: { ...input, command: updated },
      savedTokensEstimate: 4000,
      rewriterName: "grep",
      integrityScore: 0.8,
      integrityNote: "-c counts matches per file; every file with a match is still listed",
    };
  }

  // Non-recursive grep without an output cap → pipe to head.
  if (!recursive && !hasOutputLimit(cmd) && !cmd.includes("|")) {
    return {
      updatedInput: { ...input, command: `${cmd} | head -${HEAD_LIMIT}` },
      savedTokensEstimate: 1500,
      rewriterName: "grep",
      integrityScore: 0.6,
      integrityNote: "kept first 50 matches via head pipe; tail matches dropped",
    };
  }
  return null;
};
