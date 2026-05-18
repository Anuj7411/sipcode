/**
 * The Output Compression rule packs — raw CLAUDE.md content for each mode.
 *
 * These strings are the actual instructions an LLM reads from CLAUDE.md
 * when sipcode rules are installed. Voice rules:
 *  - lowercase (brand voice)
 *  - directive imperatives (LLMs follow direct instructions)
 *  - no jargon
 *  - tight: each mode must stay under 600 approx tokens
 *
 * The leading "Sipcode Output Compression" heading is the load-bearing
 * shape signal used by claudeMd.ts to recognize "this is our block, safe
 * to overwrite" — do not rename it.
 */
import type { RulesBlock, RulesMode } from "./types.js";

const HEADER = (
  mode: RulesMode,
  optimizesFor: string,
): string =>
  [
    "",
    "## Sipcode Output Compression",
    "",
    `mode: ${mode} — optimizes for: ${optimizesFor}`,
    "",
    "the rules below apply to your responses in this project. follow them.",
    "they exist so the user pays for code, not for ceremony.",
    "",
  ].join("\n");

const FOOTER = [
  "",
  "(installed by sipcode. switch modes with `npx sipcode rules --mode <m>`.",
  "uninstall with `npx sipcode rules --uninstall`.)",
  "",
].join("\n");

const DEFAULT_RULES = [
  "### rules (default mode)",
  "",
  "1. **diff-only edits.** when editing a file, output only the changed",
  "   hunk plus three lines of context. never paste the full file back",
  "   when three lines changed. this is the single biggest win.",
  "2. **no preamble.** skip \"i'll help with that\", \"sure\", \"here's what",
  "   i did\". lead with the work. the user can see what you did.",
  "3. **no post-amble.** don't summarize what was just shown unless the",
  "   user explicitly asks for a summary.",
  "4. **code over prose.** when the answer is code, the code is the",
  "   answer. any explanation goes after the code block, not before.",
  "5. **bullets over paragraphs** for any list of options, steps, or",
  "   trade-offs. saves tokens versus flowing prose.",
  "6. **one canonical example, not three.** show one good example. skip",
  "   the exhaustive variants — the user will ask if they want more.",
  "7. **no filler verbs.** drop \"let me\", \"i'll go ahead and\", \"i'm",
  "   going to\". just do the thing.",
].join("\n");

const STRICT_EXTRA = [
  "",
  "### strict additions",
  "",
  "8. **drop sentence-leading articles.** \"user is logged in\", not \"the",
  "   user is logged in\". code voice; the article costs a token.",
  "9. **direct imperatives only.** \"use Read(file)\", not \"i would",
  "   suggest using the Read tool to look at the file\".",
  "10. **single-line answers when possible.** if a yes/no question has a",
  "    yes/no answer, that is the whole answer.",
  "11. **never restate the question.** \"sure, you'd like me to...\" is",
  "    banned. the question is in scrollback already.",
].join("\n");

const VERBOSE_EXTRA = [
  "",
  "### verbose additions (learning mode)",
  "",
  "12. **trade-offs after the code.** one short paragraph on why this",
  "    approach and what the alternatives look like. one paragraph, not",
  "    three.",
  "13. **cite sources for non-obvious decisions.** when a pattern comes",
  "    from a known library, RFC, or paper, name it inline.",
  "14. **annotate diffs for first-time concepts.** when teaching, a",
  "    two-line comment on the new concept is fine. only the new concept.",
].join("\n");

export function renderRulesBlock(mode: RulesMode): RulesBlock {
  const head =
    mode === "default"
      ? HEADER(mode, "diff edits, no ceremony")
      : mode === "strict"
      ? HEADER(mode, "telegraphic responses, code voice")
      : HEADER(mode, "learning, code review, onboarding");

  const core =
    mode === "default"
      ? DEFAULT_RULES
      : mode === "strict"
      ? `${DEFAULT_RULES}\n${STRICT_EXTRA}`
      : `${DEFAULT_RULES}\n${VERBOSE_EXTRA}`;

  return {
    mode,
    body: `${head}${core}\n${FOOTER}`,
  };
}
