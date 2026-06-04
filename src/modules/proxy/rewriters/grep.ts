/**
 * grep (Bash) rewriter.
 *
 * For recursive grep without -c (count-only) or -l (file-list-only), add -c.
 * This collapses dozens of repeated match lines into "file: N" per file.
 *
 * For non-recursive grep without an output limit, pipe to `| head -50`.
 */
import type { RewriterFn } from "../types.js";
import { commandStartsWith, hasFlag, hasOutputLimit } from "./base.js";

const HEAD_LIMIT = 50;

export const rewriteGrep: RewriterFn = (input) => {
  const cmd = String(input.command ?? "").trim();
  const isGrep = commandStartsWith(cmd, "grep") || commandStartsWith(cmd, "rg");
  if (!isGrep) return null;

  const recursive = hasFlag(cmd, "-r", "-R", "--recursive");
  const countMode = hasFlag(cmd, "-c", "--count");
  const listMode = hasFlag(cmd, "-l", "--files-with-matches");
  const summaryMode = countMode || listMode;

  if (recursive && !summaryMode) {
    // Switch recursive grep to count mode (1 line per file).
    const updated = cmd.replace(/^(\s*(?:grep|rg))/, "$1 -c");
    return {
      updatedInput: { ...input, command: updated },
      savedTokensEstimate: 4000,
      rewriterName: "grep",
    };
  }

  // Non-recursive grep without an output cap → pipe to head.
  if (!recursive && !hasOutputLimit(cmd) && !cmd.includes("|")) {
    return {
      updatedInput: { ...input, command: `${cmd} | head -${HEAD_LIMIT}` },
      savedTokensEstimate: 1500,
      rewriterName: "grep",
    };
  }
  return null;
};
