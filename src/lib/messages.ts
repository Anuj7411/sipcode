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
} as const;
