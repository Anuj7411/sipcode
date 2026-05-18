/**
 * Approximate token counter for budget enforcement.
 *
 * Heuristic: roughly 4 characters per token for English + code mix. This is
 * ±15% of the real Anthropic tokenizer in practice — fine for the manifest
 * budget guardrail (S006), which is about catching runaway output, not
 * billing-grade accuracy. If we ever need real numbers, swap for
 * `@anthropic-ai/tokenizer` in v1.1.
 *
 * Why not pull tiktoken now: extra native dep, extra cold-start cost, and
 * the budget is a coarse guardrail, not a billing metric.
 */
export function approxTokenCount(s: string): number {
  if (s.length === 0) return 0;
  return Math.ceil(s.length / 4);
}
