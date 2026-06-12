/**
 * Score extracted symbols against recent session signals.
 *
 * Pure. No I/O. Takes the symbols extracted from a file plus the signal
 * cache loaded by the orchestrator, returns each symbol with a 0-1
 * confidence score.
 *
 * Match types (highest score wins):
 *   - exact:        symbol name === signal pattern → 1.0
 *   - substring:    symbol name contains pattern (or vice versa) → 0.8
 *   - word-bdry:    pattern is a CamelCase / snake_case word in symbol → 0.7
 *   - regex-match:  pattern (as regex) matches symbol → 0.7
 *   - no match:     0.0
 *
 * The orchestrator's confidence gate (default 0.7) means only exact and
 * substring matches reliably trigger AST trim — word-boundary and regex
 * land right at the threshold so the orchestrator can still pass through
 * the full file if it wants extra caution.
 *
 * Glob patterns are explicitly NOT scored — they tell us file types of
 * interest, not symbol names. They're recorded for future use.
 */
import type { ExtractedSymbol } from "./ts-symbols.js";
import type { Signal } from "../signal-cache.js";

export interface ScoredSymbol {
  readonly symbol: ExtractedSymbol;
  /** Match confidence 0-1. */
  readonly confidence: number;
  /** Which signal pattern produced the best score (for debug/reasoning). */
  readonly matchedPattern?: string;
}

/** Default minimum confidence for "safe to use this symbol for trim." */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Score each symbol against the signals. Symbols with no match score 0
 * and are still returned (caller decides what to do with low-confidence
 * symbols).
 */
export function scoreSymbols(
  symbols: ReadonlyArray<ExtractedSymbol>,
  signals: ReadonlyArray<Signal>,
): ScoredSymbol[] {
  const grepPatterns = signals
    .filter((s) => s.kind === "grep-pattern")
    .map((s) => s.pattern);

  return symbols.map((symbol) => {
    let best = 0;
    let bestPattern: string | undefined;
    for (const pattern of grepPatterns) {
      const score = matchScore(symbol.name, pattern);
      if (score > best) {
        best = score;
        bestPattern = pattern;
      }
    }
    return bestPattern !== undefined
      ? { symbol, confidence: best, matchedPattern: bestPattern }
      : { symbol, confidence: best };
  });
}

/**
 * Pick symbols above the confidence threshold to use for AST trim. Returns
 * empty when nothing crosses the bar — caller should pass through the full
 * file.
 */
export function pickRelevantSymbols(
  scored: ReadonlyArray<ScoredSymbol>,
  threshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
): ScoredSymbol[] {
  return scored
    .filter((s) => s.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Compute a 0-1 score for how well symbol matches pattern.
 * Pure helper, exported for tests.
 */
export function matchScore(symbol: string, pattern: string): number {
  if (!symbol || !pattern) return 0;
  if (symbol === pattern) return 1.0;
  const symLower = symbol.toLowerCase();
  const patLower = pattern.toLowerCase();
  if (symLower === patLower) return 0.95;
  if (symLower.includes(patLower) || patLower.includes(symLower)) {
    // Length-aware: short pattern matching a long symbol is less reliable.
    // E.g. pattern "id" inside symbol "validateUserId" — match but not perfect.
    const ratio = Math.min(patLower.length, symLower.length) / Math.max(patLower.length, symLower.length);
    return 0.7 + 0.1 * ratio;
  }
  // Word-boundary on CamelCase / snake_case.
  const words = splitIdentifier(symbol);
  for (const w of words) {
    if (w.toLowerCase() === patLower) return 0.7;
  }
  // Regex attempt — patterns from Grep can be valid regex.
  try {
    const re = new RegExp(pattern);
    if (re.test(symbol)) return 0.7;
  } catch {
    // not a valid regex; ignore
  }
  return 0;
}

/** Split CamelCase / snake_case / kebab-case into lowercase words. */
function splitIdentifier(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .split(/[_\-]+/)
    .filter(Boolean);
}
