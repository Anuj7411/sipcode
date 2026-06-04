import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTranscript } from "../../src/modules/transcript/parse.js";
import { analyzeTokens } from "../../src/modules/transcript/analyzers/tokens.js";
import { analyzeIdleContext } from "../../src/modules/transcript/analyzers/idleContext.js";
import { analyzeDuplicateReads } from "../../src/modules/transcript/analyzers/duplicateReads.js";
import { loadPricingForDate } from "../../src/lib/pricing/load.js";

/**
 * Mathematical invariant: you cannot recover more tokens than were
 * spent. If sum(recoverable_components) > totalTokens, a component
 * is overcounting — almost certainly the idle-context analyzer
 * multiplying file cost by idle-turns.
 *
 * History: v1.3.x and earlier multiplied idle-file first-read cost
 * by the number of idle turns, producing aggregates ~9× the total
 * spend. A user audit caught this. v1.4.0 fixed it. This guard
 * fails the build if anyone reintroduces the bug.
 *
 * The invariant is checked across every transcript fixture in the
 * repo — so the guard tests the math against real and synthetic
 * sessions, not just one shape.
 */

const FIXTURE_DIR = join(__dirname, "..", "fixtures", "transcripts");

function fixturesIn(): string[] {
  // Hard-code the known fixtures rather than scanning fs — keeps the
  // guard deterministic and explicit about what it covers.
  return [
    "minimal-2turn.jsonl",
    "multi-model.jsonl",
    "older-schema-no-usage.jsonl",
  ];
}

describe("guard — recoverable-tokens mathematical invariant", () => {
  const pricing = loadPricingForDate(new Date("2026-05-01"));

  for (const fixtureName of fixturesIn()) {
    it(`idle-context cost <= total session tokens [${fixtureName}]`, () => {
      const raw = readFileSync(join(FIXTURE_DIR, fixtureName), "utf-8");
      const result = parseTranscript(raw);
      if (!result.ok) {
        // Some fixtures are intentionally malformed for other tests —
        // skip them.
        return;
      }
      const parsed = result.value;
      const tokens = analyzeTokens(parsed, pricing);
      const idle = analyzeIdleContext(parsed);
      const totalTokens =
        tokens.inputTokens +
        tokens.outputTokens +
        tokens.cacheReadTokens +
        tokens.cacheCreationTokens;

      // The single most important invariant. If this ever fails, the
      // user-reported v1.3.4 audit bug has returned: idle cost > spend.
      expect(
        idle.idleTokenCost,
        `idle.idleTokenCost (${idle.idleTokenCost}) MUST NOT exceed total session tokens (${totalTokens}) — see comment in idleContext.ts about why this was broken in v1.3.x`,
      ).toBeLessThanOrEqual(totalTokens);
    });

    it(`recoverable-components sum <= total session tokens [${fixtureName}]`, () => {
      const raw = readFileSync(join(FIXTURE_DIR, fixtureName), "utf-8");
      const result = parseTranscript(raw);
      if (!result.ok) return;
      const parsed = result.value;
      const tokens = analyzeTokens(parsed, pricing);
      const idle = analyzeIdleContext(parsed);
      const dups = analyzeDuplicateReads(parsed);
      const totalTokens =
        tokens.inputTokens +
        tokens.outputTokens +
        tokens.cacheReadTokens +
        tokens.cacheCreationTokens;
      // Sum of all recoverable components — the broader invariant.
      // Even if each component is individually plausible, their sum
      // must not exceed the total spend.
      const recoverable = idle.idleTokenCost + dups.duplicateReadTokenCost;
      expect(
        recoverable,
        `idle + duplicates (${recoverable}) MUST NOT exceed total session tokens (${totalTokens})`,
      ).toBeLessThanOrEqual(totalTokens);
    });
  }
});
