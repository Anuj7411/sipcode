/**
 * npm command rewriters.
 *
 * `npm ls` / `npm list` → add `--depth=0` to flatten to direct deps.
 * `npm install` / `npm i` / `npm add` → add `--no-audit --no-fund --loglevel=error`
 *   to drop progress noise, audit table, and fund banner.
 * `npm view` / `npm info` (no field arg) → cap to ~80 lines via head pipe.
 *
 * Each skips rewrite when the caller already specified the relevant flag,
 * piped output, or asked for json.
 */
import type { RewriterFn } from "../types.js";
import { commandStartsWith, hasFlag, hasOutputLimit } from "./base.js";

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

export const rewriteNpmInstall: RewriterFn = (input) => {
  const cmd = String(input.command ?? "");
  const isInstall =
    commandStartsWith(cmd, "npm install") ||
    commandStartsWith(cmd, "npm i") ||
    commandStartsWith(cmd, "npm add");
  if (!isInstall) return null;
  const additions: string[] = [];
  if (!hasFlag(cmd, "--no-audit", "--audit")) additions.push("--no-audit");
  if (!hasFlag(cmd, "--no-fund", "--fund")) additions.push("--no-fund");
  if (
    !hasFlag(
      cmd,
      "--loglevel",
      "--silent",
      "-s",
      "--quiet",
      "-q",
      "--verbose",
      "-d",
      "--ddd",
    )
  ) {
    additions.push("--loglevel=error");
  }
  if (additions.length === 0) return null;
  const updated = cmd.replace(
    /^(\s*npm (?:install|i|add)\b)/,
    "$1 " + additions.join(" "),
  );
  return {
    updatedInput: { ...input, command: updated },
    savedTokensEstimate: 3000,
    rewriterName: "npm-install",
  };
};

export const rewriteNpmView: RewriterFn = (input) => {
  const cmd = String(input.command ?? "");
  const isView =
    commandStartsWith(cmd, "npm view") || commandStartsWith(cmd, "npm info");
  if (!isView) return null;
  if (hasOutputLimit(cmd)) return null;
  if (/[>|]\s*\S+/.test(cmd)) return null;
  if (hasFlag(cmd, "--json")) return null;
  // Only cap when no field is specified (full dump is the verbose case).
  const tokens = cmd.trim().split(/\s+/).filter((t) => !t.startsWith("-"));
  if (tokens.length !== 3) return null;
  const updated = `${cmd.trim()} 2>&1 | head -80`;
  return {
    updatedInput: { ...input, command: updated },
    savedTokensEstimate: 2500,
    rewriterName: "npm-view",
  };
};
