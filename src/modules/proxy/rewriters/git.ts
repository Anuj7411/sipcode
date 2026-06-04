/**
 * git command rewriters.
 *
 * Strategy: at PreToolUse, modify `tool_input.command` to a shorter-output
 * equivalent of the same intent. Never block, never see output, never invent
 * fields. This is the only documented Claude Code mechanic for shrinking
 * tool I/O at the hook layer.
 */
import type { RewriterFn } from "../types.js";
import { commandStartsWith, hasFlag } from "./base.js";

/**
 * `git status` → `git status -s` (short format).
 *
 * Typical reduction: 85-95% on dirty trees (advisory verbose lines dropped),
 * ~50% on clean trees. Skips rewrite when the user already specified a
 * short/porcelain mode.
 */
export const rewriteGitStatus: RewriterFn = (input) => {
  const cmd = String(input.command ?? "");
  if (!commandStartsWith(cmd, "git status")) return null;
  if (hasFlag(cmd, "-s", "--short", "--porcelain")) return null;
  const updated = cmd.replace(/^(\s*git status)/, "$1 -s");
  return {
    updatedInput: { ...input, command: updated },
    savedTokensEstimate: 800,
    rewriterName: "git-status",
  };
};

/**
 * `git log` → `git log --oneline -n 20`.
 *
 * Typical reduction: 90-98% on repos with > 20 commits in history. Skips
 * rewrite when the caller already specified a format or count.
 */
export const rewriteGitLog: RewriterFn = (input) => {
  const cmd = String(input.command ?? "");
  if (!commandStartsWith(cmd, "git log")) return null;
  if (hasFlag(cmd, "--oneline", "--pretty", "--format", "-n")) return null;
  if (/--max-count/.test(cmd)) return null;
  const updated = cmd.replace(/^(\s*git log)/, "$1 --oneline -n 20");
  return {
    updatedInput: { ...input, command: updated },
    savedTokensEstimate: 3000,
    rewriterName: "git-log",
  };
};
