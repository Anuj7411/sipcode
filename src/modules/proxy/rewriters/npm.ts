/**
 * npm command rewriters.
 *
 * `npm ls` / `npm list` → add `--depth=0` to flatten to direct deps.
 * Skips rewrite when caller specified depth, --all, --json, or --parseable.
 */
import type { RewriterFn } from "../types.js";
import { commandStartsWith, hasFlag } from "./base.js";

export const rewriteNpmLs: RewriterFn = (input) => {
  const cmd = String(input.command ?? "");
  const isLs =
    commandStartsWith(cmd, "npm ls") || commandStartsWith(cmd, "npm list");
  if (!isLs) return null;
  if (hasFlag(cmd, "--depth", "-a", "--all", "--json", "--parseable")) {
    return null;
  }
  const updated = cmd.replace(/^(\s*npm (?:ls|list))/, "$1 --depth=0");
  return {
    updatedInput: { ...input, command: updated },
    savedTokensEstimate: 5000,
    rewriterName: "npm-ls",
  };
};
