/**
 * `sipcode why` — past-tense session auditor.
 * Reads ~/.claude/projects/<hash>/*.jsonl and reports where tokens went.
 *
 * Implementation lives across src/modules/transcript/* and src/modules/why/*.
 * This file is the thin command orchestrator only.
 *
 * See docs/SESSION-HANDOFF.md §2–§3 for the full spec.
 */
export interface WhyOptions {
  session?: string;
  list?: boolean;
  json?: boolean;
}

export async function runWhy(_opts: WhyOptions): Promise<void> {
  // TODO(v0.1.0-alpha.1):
  //   1. discoverSessions() — src/modules/transcript/discover.ts
  //   2. parseTranscript() — src/modules/transcript/parse.ts
  //   3. run analyzers — src/modules/transcript/analyzers/*
  //   4. render — src/modules/why/render.ts + format-terminal.ts | format-json.ts
  //
  // The first PR for this milestone should land discoverSessions + a passing
  // snapshot test against a fixture transcript.
  console.log("sipcode why — not yet implemented. See docs/SESSION-HANDOFF.md.");
}
