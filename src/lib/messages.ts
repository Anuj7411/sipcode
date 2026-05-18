/**
 * All user-facing strings live here.
 *
 * Voice: lowercase, no jargon, structured as (a) what happened (b) why
 * (c) how to fix (d) suggested next command.
 */
export const MESSAGES = {
  tagline: "sip your tokens. don't gulp them.",

  notImplemented: (cmd: string, milestone: string) =>
    `sipcode ${cmd} — not yet implemented (planned for ${milestone}).`,

  noTranscriptsDir: (path: string) =>
    [
      `[E003] no claude code transcripts found at ${path}`,
      ``,
      `why: sipcode looks here for past session logs that claude code writes itself. either claude code isn't installed, you haven't used it yet, or transcripts live somewhere custom.`,
      ``,
      `fix: open claude code and run any prompt — it'll create the folder. or point sipcode at a custom path: SIPCODE_PROJECTS_DIR=/your/path npx sipcode why`,
      ``,
      `next: npx sipcode why --list`,
    ].join("\n"),

  noSessionsFound: (path: string) =>
    [
      `[E003] no session files inside ${path}`,
      ``,
      `why: the folder exists but no .jsonl transcripts live in it. claude code writes a transcript per session — none have run here yet, or they've been cleaned out.`,
      ``,
      `fix: open claude code, run any prompt, then come back.`,
      ``,
      `next: npx sipcode why --list`,
    ].join("\n"),

  sessionNotFound: (id: string) =>
    [
      `[E003] no session matches "${id}"`,
      ``,
      `why: sipcode couldn't find a .jsonl whose name starts with that id.`,
      ``,
      `fix: list available sessions and pick a real id.`,
      ``,
      `next: npx sipcode why --list`,
    ].join("\n"),

  malformedTranscript: (file: string, badLines: number) =>
    [
      `[E003] one of your session files looks corrupted: ${file}`,
      ``,
      `why: claude code sometimes writes partial json when it crashes. sipcode read what it could and skipped ${badLines} bad line(s).`,
      ``,
      `fix: you can ignore this — the report shows partial numbers, flagged below. to audit a different session: sipcode why --list and pick another.`,
      ``,
      `next: sipcode why --list`,
    ].join("\n"),

  pricingStale: (asOf: string, days: number) =>
    [
      `[E004] pricing is ${days} days old (file dated ${asOf})`,
      ``,
      `why: anthropic's pricing may have changed since this pricing file shipped. cost numbers below are an estimate, not a guarantee.`,
      ``,
      `fix: update sipcode (npm i -g @sipcode/cli@latest) for the freshest pricing.`,
      ``,
      `next: npx sipcode why`,
    ].join("\n"),

  noUsageBlocks:
    "[E003] this session has no token-usage data (older claude code version). showing structural numbers only.",

  banner: (sessionId: string, projectHash: string) =>
    `(showing latest session ${sessionId} from ${projectHash}; pass --here to scope to this directory)`,

  // ---- manifest milestone (v0.1.0-alpha.2) ----

  manifestOverBudget: (actual: number, budget: number) =>
    [
      `[E001] manifest is ${actual} tokens — over the ${budget}-token budget.`,
      ``,
      `why: sipcode's whole point is keeping context small. a manifest that doesn't fit in budget defeats the purpose — your agent will read it AND still grep for more.`,
      ``,
      `fix: drop low-signal sections automatically with --tighten, or bypass once with --no-budget if you know what you're doing.`,
      ``,
      `next: npx sipcode manifest --tighten`,
    ].join("\n"),

  manifestParseSkipped: (file: string, reason: string) =>
    [
      `[E002] couldn't parse ${file}`,
      ``,
      `why: ${reason}`,
      ``,
      `fix: skipped — the manifest will still ship without this file's import graph entry. if many files are skipped, the grammar package may not be installed for your platform.`,
      ``,
      `next: npx sipcode manifest --explain ${file}`,
    ].join("\n"),

  claudeMdUnsafe: (path: string) =>
    [
      `[E005] ${path} has hand-edited content inside the sipcode markers.`,
      ``,
      `why: sipcode injects a fixed block between <!-- sipcode:start --> and <!-- sipcode:end -->. anything inside those markers is sipcode's territory. if you've edited it, sipcode won't blow your changes away.`,
      ``,
      `fix: pull your edits out of the markers (move them above or below), then re-run init. or delete the entire marker block to start fresh.`,
      ``,
      `next: npx sipcode init`,
    ].join("\n"),

  gitUnavailable:
    [
      `[E006] git not available — hot-files index disabled.`,
      ``,
      `why: sipcode reads git history to find your hottest files (top 20 by change frequency in the last 90 days). without git on PATH, that section gets skipped.`,
      ``,
      `fix: install git, or ignore — the manifest still ships, just without hot-files.`,
      ``,
      `next: npx sipcode manifest`,
    ].join("\n"),

  unsupportedLanguage: (file: string, ext: string) =>
    [
      `[E007] ${file} uses an unsupported language (${ext}) — skipped from manifest.`,
      ``,
      `why: v1.0 ships grammars for typescript, javascript, python, and go. other languages are listed in the file tree but skipped for import graph and pattern detection.`,
      ``,
      `fix: open an issue at https://github.com/Anuj7411/sipcode if you want this language prioritized.`,
      ``,
      `next: npx sipcode manifest`,
    ].join("\n"),

  manifestBudgetWarn: (actual: number, budget: number) =>
    [
      `[R001] manifest is ${actual} tokens (budget ${budget}). sipcode trimmed low-signal sections to fit.`,
      ``,
      `why: large repos hit the budget naturally. --tighten dropped the lowest-signal entries first (long files in deep test dirs, then long imports).`,
      ``,
      `fix: review the manifest and consider adding skip patterns in .sipcodeignore for generated code or vendored libraries.`,
      ``,
      `next: cat .sipcode/manifest.md`,
    ].join("\n"),

  claudeMdBloated: (tokens: number) =>
    [
      `[R007] CLAUDE.md is ${tokens} tokens — getting bloated.`,
      ``,
      `why: every prompt pays for CLAUDE.md. anything past ~4000 tokens is taxing every turn forever.`,
      ``,
      `fix: trim down. a CLAUDE.md compressor ships in a later milestone.`,
      ``,
      `next: cat CLAUDE.md | wc -c`,
    ].join("\n"),

  manifestDeltaNotImplemented:
    "[planned] --delta is stubbed for v1.1+. for now, re-run `sipcode manifest` to regenerate from scratch — it's idempotent on unchanged trees, so diffs against the prior version are easy to read.",

  manifestExplainNotImplemented: (file: string) =>
    `[planned] --explain ${file} lands in v1.1+. for now, the [E002] line printed during generation tells you why a file was skipped.`,
} as const;
