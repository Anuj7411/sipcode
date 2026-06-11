/**
 * `tsc` (TypeScript compiler) command rewriter.
 *
 * `tsc` and `tsc --noEmit` outputs can be hundreds of lines on a project with
 * many errors. We append `2>&1 | head -100` to cap the volume. Claude almost
 * always wants the FIRST errors (which usually unblock the rest) — capping
 * preserves the actionable signal while dropping the noise.
 *
 * Skips when:
 *   - output is already piped/redirected by the caller (we never override intent)
 *   - --listFiles or --listEmittedFiles is set (caller wants the full file list)
 *   - --version is the only flag (already terse)
 */
import type { RewriterFn } from "../types.js";
import { commandStartsWith, hasFlag, hasOutputLimit } from "./base.js";

const HEAD_LIMIT = 100;

export const rewriteTsc: RewriterFn = (input) => {
  const cmd = String(input.command ?? "");
  if (!commandStartsWith(cmd, "tsc") && !commandStartsWith(cmd, "npx tsc")) {
    return null;
  }
  // Caller already capped or redirected — respect their intent.
  if (hasOutputLimit(cmd)) return null;
  if (/[>|]\s*\S+/.test(cmd)) return null;
  if (hasFlag(cmd, "--listFiles", "--listEmittedFiles", "--version", "-v")) {
    return null;
  }
  // Append a head cap. Stderr-to-stdout merge ensures we cap diagnostic output,
  // not just successful builds.
  const updated = `${cmd.trim()} 2>&1 | head -${HEAD_LIMIT}`;
  return {
    updatedInput: { ...input, command: updated },
    savedTokensEstimate: 3000,
    rewriterName: "tsc",
    integrityScore: 0.55,
    integrityNote: "kept first 100 lines of compile output; later errors may be hidden",
  };
};
