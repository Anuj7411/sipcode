/**
 * Claude Code `Grep` tool parameter injector.
 *
 * Grep accepts a `head_limit` parameter. When absent, inject `head_limit: 100`
 * to cap result volume. `count` output mode is already compact, so skip it.
 *
 * v1.6.16 (F-NATIVE-GREP): raised cap from 50 to 100. The 2026-06-17
 * dogfood session showed `native-grep` was the highest-volume rewriter
 * (30% of all proxy work) AND the lowest-integrity (65% kept). The 50-cap
 * was too aggressive for typical Claude Code grep workloads: symbol
 * lookups across larger codebases routinely returned 50-100 matches that
 * Claude then needed for follow-up reads. Doubling the cap captures the
 * vast majority of real queries while still bounding pathological greps.
 * Integrity declaration moves from 0.65 to 0.78 to reflect the new floor.
 */
import type { RewriterFn } from "../types.js";

const HEAD_LIMIT = 100;

export const rewriteNativeGrep: RewriterFn = (input) => {
  const pattern = input.pattern;
  if (typeof pattern !== "string" || pattern.length === 0) return null;
  if (input.head_limit !== undefined) return null;
  if (input.output_mode === "count") return null;

  return {
    updatedInput: { ...input, head_limit: HEAD_LIMIT },
    savedTokensEstimate: 2000,
    rewriterName: "native-grep",
    integrityScore: 0.78,
    integrityNote:
      "capped to 100 matches; covers most real Claude Code grep workloads",
  };
};
