/**
 * cargo command rewriter.
 * Adds --quiet to suppress the verbose "Compiling X v1.2.3" stderr noise.
 */
import type { RewriterFn } from "../types.js";
import { commandStartsWith, hasFlag } from "./base.js";

export const rewriteCargoBuild: RewriterFn = (input) => {
  const cmd = String(input.command ?? "");
  const isCargo =
    commandStartsWith(cmd, "cargo build") ||
    commandStartsWith(cmd, "cargo check") ||
    commandStartsWith(cmd, "cargo test");
  if (!isCargo) return null;
  if (hasFlag(cmd, "--quiet", "-q", "--verbose", "-v", "-vv")) return null;
  const updated = cmd.replace(/^(\s*cargo (?:build|check|test))/, "$1 --quiet");
  return {
    updatedInput: { ...input, command: updated },
    savedTokensEstimate: 2500,
    rewriterName: "cargo",
  };
};
