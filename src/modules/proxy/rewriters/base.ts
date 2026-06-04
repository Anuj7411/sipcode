/**
 * Shared rewriter helpers. Pure functions only.
 *
 * Purity contract: this module MUST NOT import from node:fs, node:http,
 * node:https, node:net, node:dns, node:tls, or node:child_process. Enforced
 * by tests/guards/proxy-rewriter-purity.test.ts.
 */

/**
 * Does `cmd` start with a target prefix AT A WORD BOUNDARY?
 *
 * Prevents `git statusbar` from incorrectly matching `git status`.
 * The next character after the prefix must be whitespace or end-of-string.
 */
export function commandStartsWith(cmd: string, prefix: string): boolean {
  const trimmed = cmd.trim();
  if (!trimmed.startsWith(prefix)) return false;
  const next = trimmed[prefix.length];
  if (next === undefined) return true;
  return next === " " || next === "\t" || next === "\n";
}

/** Is a particular flag/argument already present in the command? */
export function hasFlag(cmd: string, ...flags: string[]): boolean {
  for (const f of flags) {
    const escaped = escapeRegex(f);
    const re = new RegExp(`(^|\\s)${escaped}(\\s|$|=)`);
    if (re.test(cmd)) return true;
  }
  return false;
}

/**
 * Is a single-letter short flag present, including inside a combined cluster?
 *
 * `hasFlag` uses word boundaries, so it misses `-c` in `grep -rc` (the `c` is
 * preceded by `r`, not whitespace). This detects a short-flag cluster like
 * `-r`, `-rc`, `-abc` that contains `letter`, while ignoring long flags (`--count`).
 */
export function hasShortFlag(cmd: string, letter: string): boolean {
  const re = new RegExp(`(^|\\s)-[a-zA-Z]*${escapeRegex(letter)}[a-zA-Z]*(\\s|$)`);
  return re.test(cmd);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Is the command already piped to a length-limiting tool? */
export function hasOutputLimit(cmd: string): boolean {
  return /\|\s*(head|tail|less|more)\b/.test(cmd);
}
