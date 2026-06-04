/**
 * Rewriter registry — dispatch (toolName, toolInput) → RewriterResult.
 *
 * `resolveRewriter(toolName)` returns a single RewriterFn (or null). For Bash,
 * the returned function tries every Bash-command rewriter in order and returns
 * the first non-null result; native tools map to their single injector.
 */
import type { RewriterFn } from "./types.js";
import { rewriteGitStatus, rewriteGitLog, rewriteGitDiff } from "./rewriters/git.js";
import { rewriteNpmLs } from "./rewriters/npm.js";
import { rewriteCargoBuild } from "./rewriters/cargo.js";
import { rewriteLs } from "./rewriters/ls.js";
import { rewriteFind } from "./rewriters/find.js";
import { rewriteGrep } from "./rewriters/grep.js";
import { rewriteCat } from "./rewriters/cat.js";
import { rewriteNativeGrep } from "./rewriters/nativeGrep.js";
import { rewriteNativeGlob } from "./rewriters/nativeGlob.js";

/** Ordered Bash rewriters. First non-null result wins. */
const BASH_REWRITERS: readonly RewriterFn[] = [
  rewriteGitStatus,
  rewriteGitLog,
  rewriteGitDiff,
  rewriteNpmLs,
  rewriteCargoBuild,
  rewriteLs,
  rewriteFind,
  rewriteGrep,
  rewriteCat,
];

const bashRewriter: RewriterFn = (input) => {
  for (const fn of BASH_REWRITERS) {
    const result = fn(input);
    if (result) return result;
  }
  return null;
};

export function resolveRewriter(toolName: string): RewriterFn | null {
  switch (toolName) {
    case "Bash":
      return bashRewriter;
    // NOTE: no "Read" rewriter. Claude Code's Read tool already defaults to a
    // 2000-line cap, so injecting limit=2000 would be a no-op — we don't claim
    // a saving we don't deliver. Reads are bounded by the platform default.
    case "Grep":
      return rewriteNativeGrep;
    case "Glob":
      return rewriteNativeGlob;
    default:
      return null;
  }
}
