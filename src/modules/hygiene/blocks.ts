/**
 * Session Hygiene rule pack — the CLAUDE.md sub-block body.
 *
 * What hooks CAN do: emit warnings on stderr that Claude Code surfaces.
 * What hooks CANNOT do: force the model to compact, intercept Read
 * content, or guarantee any agent behavior. The rules below are
 * directive instructions the agent is asked to follow. We tell the
 * truth about the limit in the footer.
 *
 * Voice rules (mirror output-compression):
 *  - lowercase
 *  - directive imperatives
 *  - no jargon
 *  - tight: must stay ≤400 approx tokens (test enforces)
 *
 * The leading "Sipcode Session Hygiene" heading is the load-bearing
 * shape signal used by claudeMd.ts subBlockLooksOurs() — do not rename.
 */
import type { HygieneBlock, HygieneMode } from "./types.js";

const HEADER = (mode: HygieneMode, optimizesFor: string): string =>
  [
    "",
    "## Sipcode Session Hygiene",
    "",
    `mode: ${mode} — optimizes for: ${optimizesFor}`,
    "",
    "the rules below apply to your in-session behavior in this project.",
    "they exist so you re-read less and compact at the right moments.",
    "",
  ].join("\n");

const FOOTER = [
  "",
  "honest limit: sipcode hooks can warn — they can't force a compaction.",
  "you decide. these rules + the warnings together are the discipline.",
  "",
  "(installed by sipcode. inspect with `npx sipcode hygiene`. uninstall",
  "with `npx sipcode hygiene --uninstall`.)",
  "",
].join("\n");

const DEFAULT_RULES = [
  "### rules (default mode)",
  "",
  "1. **read once.** before reading a file, check if you already read it",
  "   in this session. if yes, recall what it said instead of re-reading.",
  "2. **grep for symbols, don't re-read files.** to verify one symbol in",
  "   a file you already read, use `Grep \"<symbol>\" <file>` — not Read.",
  "3. **partial reads when you know the line.** use `Read file=<path>",
  "   offset=<n> limit=<m>` instead of pulling the whole file again.",
  "4. **consolidate at 5 reads.** after five files in a session, pause",
  "   and summarize what you've learned before the sixth read.",
  "5. **act on pressure warnings.** when sipcode prints `context at ~70%`",
  "   on stderr, propose `/compact` at the next natural break.",
  "6. **pivot = compact.** when the user changes topic, the prior task's",
  "   context isn't earning its keep. suggest `/compact` first.",
  "",
  "token budget for this block: under 400 tokens.",
].join("\n");

export function renderHygieneBlock(mode: HygieneMode): HygieneBlock {
  const head = HEADER(mode, "read-once discipline, surgical re-reads");
  return {
    mode,
    body: `${head}${DEFAULT_RULES}\n${FOOTER}`,
  };
}
