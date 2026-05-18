/**
 * All user-facing strings live here.
 *
 * Rationale: no scattered inline literals in commands/. Easier to audit tone,
 * keep voice consistent, and (eventually) localize.
 */
export const MESSAGES = {
  tagline: "Sip your tokens. Don't gulp them.",
  notImplemented: (cmd: string, milestone: string) =>
    `sipcode ${cmd} — not yet implemented (planned for ${milestone}).`,
  noTranscriptsDir: (path: string) =>
    `No Claude Code transcripts found at ${path}. Is Claude Code installed and have you run it at least once?`,
  pricingStale: (asOf: string) =>
    `Pricing file is from ${asOf} — costs may be inaccurate.`,
} as const;
