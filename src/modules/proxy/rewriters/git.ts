/**
 * git command rewriters.
 *
 * Strategy: at PreToolUse, modify `tool_input.command` to a shorter-output
 * equivalent of the same intent. Never block, never see output, never invent
 * fields. This is the only documented Claude Code mechanic for shrinking
 * tool I/O at the hook layer.
 */
import type { RewriterFn } from "../types.js";
import {
  commandStartsWith,
  hasFlag,
  hasOutputLimit,
  capLines,
} from "./base.js";

const DIFF_HEAD = 200;

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
    integrityScore: 0.8,
    integrityNote: "--short keeps every file, just less verbose",
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
    integrityScore: 0.3,
    integrityNote: "capped to 20 most recent commits; older history dropped",
  };
};

/**
 * git diff / git show: cap unbounded diff output with `| head -200`. Diffs are
 * one of the largest token sinks in coding sessions. Skipped when the diff is
 * already in a compact summary mode (--stat/--numstat/--name-only/--name-status),
 * already length-limited, or part of a compound shell command (we'd misplace the
 * pipe). The agent can always re-run for a specific file to see the full diff.
 */
export const rewriteGitDiff: RewriterFn = (input) => {
  const cmd = String(input.command ?? "").trim();
  if (!commandStartsWith(cmd, "git diff") && !commandStartsWith(cmd, "git show")) {
    return null;
  }
  if (hasFlag(cmd, "--stat", "--numstat", "--name-only", "--name-status", "--shortstat")) {
    return null;
  }
  if (hasOutputLimit(cmd)) return null;
  // Don't append a pipe to a command that already has shell glue.
  if (cmd.includes("|") || cmd.includes("&&") || cmd.includes("||") || cmd.includes(";")) {
    return null;
  }
  return {
    updatedInput: { ...input, command: capLines(cmd, DIFF_HEAD) },
    savedTokensEstimate: 3500,
    rewriterName: "git-diff",
    integrityScore: 0.5,
    integrityNote: "kept first ~150 lines of diff; later hunks may be elided",
  };
};
