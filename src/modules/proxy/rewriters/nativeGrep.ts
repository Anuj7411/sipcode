/**
 * Claude Code `Grep` tool parameter injector.
 *
 * Grep accepts a `head_limit` parameter. When absent, inject `head_limit: 50`
 * to cap result volume. `count` output mode is already compact, so skip it.
 */
import type { RewriterFn } from "../types.js";

const HEAD_LIMIT = 50;

export const rewriteNativeGrep: RewriterFn = (input) => {
  const pattern = input.pattern;
  if (typeof pattern !== "string" || pattern.length === 0) return null;
  if (input.head_limit !== undefined) return null;
  if (input.output_mode === "count") return null;

  return {
    updatedInput: { ...input, head_limit: HEAD_LIMIT },
    savedTokensEstimate: 2000,
    rewriterName: "native-grep",
  };
};
