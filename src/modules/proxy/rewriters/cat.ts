/**
 * cat command rewriter.
 *
 * For single-file `cat <file>` with no pipe and no shell chaining, rewrite to a
 * SIZE-AWARE single-pass awk that:
 *   - prints the file unchanged when it has <= 300 lines (no behavior change for
 *     the common case — small files are not touched), and
 *   - prints the first 200 + an "[N lines elided]" marker + the last 100 only
 *     when the file is genuinely large.
 *
 * This avoids the head+tail duplication bug: a naive `head -200 && tail -100`
 * prints a small file's contents TWICE (head and tail overlap), producing more
 * tokens than plain `cat`. The awk buffers once and decides based on real size.
 *
 * Multi-file cats and piped/chained cats are passthrough (v1 simplicity).
 */
import type { RewriterFn } from "../types.js";
import { commandStartsWith } from "./base.js";

const HEAD = 200;
const TAIL = 100;
const THRESHOLD = HEAD + TAIL; // only elide when the file exceeds this

export const rewriteCat: RewriterFn = (input) => {
  const cmd = String(input.command ?? "").trim();
  if (!commandStartsWith(cmd, "cat") && !commandStartsWith(cmd, "type")) return null;
  if (cmd.includes("|") || cmd.includes("&&") || cmd.includes("||") || cmd.includes(";")) {
    return null;
  }
  // Match: `cat <single-token>` or `cat -<flag> <single-token>`. Multi-file → skip.
  const m = cmd.match(/^(?:cat|type)(?:\s+-[^\s]+)?\s+(\S+)\s*$/);
  if (!m) return null;
  const file = m[1]!;
  // Single-pass, size-aware. Buffers lines, then prints full content for small
  // files or head/elision-marker/tail for large ones. No duplication.
  const prog =
    `{a[NR]=$0} END{n=NR; if(n>${THRESHOLD}){for(i=1;i<=${HEAD};i++)print a[i]; ` +
    `print "... ["n-${HEAD}-${TAIL}" lines elided by sipcode-proxy] ..."; ` +
    `for(i=n-${TAIL}+1;i<=n;i++)print a[i]} else {for(i=1;i<=n;i++)print a[i]}}`;
  const updated = `awk '${prog}' ${file}`;
  return {
    updatedInput: { ...input, command: updated },
    savedTokensEstimate: 2000,
    rewriterName: "cat",
    integrityScore: 0.55,
    integrityNote: "head/tail elide for >300-line files; small files unchanged",
  };
};
