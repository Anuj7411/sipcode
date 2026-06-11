/**
 * Claude Code `Glob` tool parameter injector.
 *
 * Glob accepts a `head_limit` parameter. When absent, inject `head_limit: 100`.
 * Paths are short, so a higher cap than Grep is affordable.
 */
import type { RewriterFn } from "../types.js";

const HEAD_LIMIT = 100;

export const rewriteNativeGlob: RewriterFn = (input) => {
  const pattern = input.pattern;
  if (typeof pattern !== "string" || pattern.length === 0) return null;
  if (input.head_limit !== undefined) return null;

  return {
    updatedInput: { ...input, head_limit: HEAD_LIMIT },
    savedTokensEstimate: 1500,
    rewriterName: "native-glob",
    integrityScore: 0.75,
    integrityNote: "capped to 100 matches; most globs return well under that",
  };
};
