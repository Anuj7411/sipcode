/**
 * cat command rewriter.
 *
 * For single-file `cat <file>` with no pipe and no shell chaining, wrap as
 *   head -200 <file> && echo "..." && tail -100 <file>
 *
 * Multi-file cats and piped cats are passthrough (v1 simplicity).
 */
import type { RewriterFn } from "../types.js";
import { commandStartsWith } from "./base.js";

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
  // Don't wrap when caller passed flags we don't recognize beyond a simple one.
  const updated = `head -200 ${file} && echo "... [sipcode-proxy elided middle] ..." && tail -100 ${file}`;
  return {
    updatedInput: { ...input, command: updated },
    savedTokensEstimate: 2000,
    rewriterName: "cat",
  };
};
