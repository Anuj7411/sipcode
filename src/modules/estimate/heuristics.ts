/**
 * Task-text heuristics — PURE.
 *
 * Input: a free-form task description string.
 * Output: ComplexityScore with tier, verb class, expected turns/reads, and
 * mentioned-file count. Zero LLM calls. Zero I/O.
 *
 * The classifier is intentionally simple: we want it to be predictable,
 * snapshot-testable, and easy to extend. The bands ride on:
 *   - which verb (refactor / implement / fix / rename / explain / test / other)
 *   - how many files / modules the task names
 *   - scope keywords (across the codebase / everywhere)
 *   - negative-scope keywords (just / only / single / one-line)
 *   - raw word count (verbosity proxy)
 */
import type { ComplexityScore, ComplexityTier, VerbClass } from "./types.js";

/** Keyword → VerbClass. Lowercased; matched as whole words. */
const VERB_KEYWORDS: ReadonlyArray<[VerbClass, ReadonlyArray<string>]> = [
  ["refactor", ["refactor", "rewrite", "migrate", "redesign", "restructure", "overhaul", "port"]],
  ["implement", ["implement", "add", "build", "create", "introduce", "ship"]],
  ["debug", ["fix", "debug", "investigate", "diagnose", "troubleshoot", "repair", "resolve"]],
  ["rename", ["rename", "move", "delete", "remove", "comment", "uncomment", "format"]],
  ["review", ["explain", "review", "audit", "describe", "summarize", "document"]],
  ["test", ["test", "spec", "cover"]],
];

const SCOPE_BOOST_PATTERNS: ReadonlyArray<RegExp> = [
  /\bacross the (?:codebase|repo|project)\b/i,
  /\beverywhere\b/i,
  /\ball (?:files|modules|packages|tests)\b/i,
  /\bglobally\b/i,
  /\bproject-wide\b/i,
  /\bevery\b/i,
];

const SCOPE_REDUCE_PATTERNS: ReadonlyArray<RegExp> = [
  /\bjust\b/i,
  /\bonly\b/i,
  /\bsingle\b/i,
  /\bone[- ]line\b/i,
  /\bone[- ]liner\b/i,
  /\bquick\b/i,
  /\btiny\b/i,
  /\btrivial\b/i,
];

/** Match e.g. `src/foo.ts`, `path/to/bar.py`, `lib/baz.go`. */
const FILE_PATH_REGEX =
  /\b[\w@./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|pyi|go|rs|md|json|toml|yaml|yml|sh|css|scss|html|vue|svelte)\b/gi;

/** Match "the foo module" / "the foo package" / "the foo service". */
const MODULE_REFERENCE_REGEX =
  /\bthe ([\w-]+) (?:module|package|service|component|handler|api|router|controller|store|hook|util|lib|client|server)\b/gi;

/** Match "N files" / "N modules" — numeric scope hint. */
const NUMERIC_FILES_REGEX =
  /\b(\d+)\s+(?:files?|modules?|packages?|services?|components?)\b/i;

function lower(s: string): string {
  return s.toLowerCase();
}

function classifyVerb(taskLower: string): VerbClass {
  for (const [verb, keywords] of VERB_KEYWORDS) {
    for (const kw of keywords) {
      const re = new RegExp(`\\b${kw}\\b`, "i");
      if (re.test(taskLower)) return verb;
    }
  }
  return "other";
}

function countMentionedFiles(task: string): number {
  let n = 0;
  const seen = new Set<string>();
  for (const m of task.matchAll(FILE_PATH_REGEX)) {
    const path = m[0].toLowerCase();
    if (!seen.has(path)) {
      seen.add(path);
      n++;
    }
  }
  for (const m of task.matchAll(MODULE_REFERENCE_REGEX)) {
    const mod = (m[1] ?? "").toLowerCase();
    if (mod && !seen.has(`module:${mod}`)) {
      seen.add(`module:${mod}`);
      n++;
    }
  }
  const numeric = task.match(NUMERIC_FILES_REGEX);
  if (numeric && numeric[1]) {
    const parsed = parseInt(numeric[1], 10);
    if (Number.isFinite(parsed) && parsed > n) n = parsed;
  }
  return n;
}

function countScopeBoosts(task: string): number {
  let n = 0;
  for (const re of SCOPE_BOOST_PATTERNS) {
    if (re.test(task)) n++;
  }
  return n;
}

function countScopeReduces(task: string): number {
  let n = 0;
  for (const re of SCOPE_REDUCE_PATTERNS) {
    if (re.test(task)) n++;
  }
  return n;
}

function countWords(task: string): number {
  const trimmed = task.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/** Per-verb baseline tier. */
function baseTierForVerb(verb: VerbClass): ComplexityTier {
  switch (verb) {
    case "refactor":
      return "high";
    case "implement":
      return "medium";
    case "debug":
      return "high"; // wide band, default conservative
    case "rename":
      return "low";
    case "review":
      return "low";
    case "test":
      return "low";
    case "other":
      return "medium";
  }
}

function shiftTier(t: ComplexityTier, by: number): ComplexityTier {
  const order: ComplexityTier[] = ["low", "medium", "high"];
  const idx = order.indexOf(t);
  const next = Math.max(0, Math.min(order.length - 1, idx + by));
  return order[next]!;
}

/** Turn/read bands per tier, before per-verb adjustments. */
function bandsForTier(
  tier: ComplexityTier,
  verb: VerbClass,
): { turns: [number, number]; reads: [number, number] } {
  const base: Record<
    ComplexityTier,
    { turns: [number, number]; reads: [number, number] }
  > = {
    low: { turns: [3, 8], reads: [1, 5] },
    medium: { turns: [10, 25], reads: [5, 15] },
    high: { turns: [25, 45], reads: [12, 25] },
  };
  const b = base[tier];
  if (verb === "debug") {
    // Debug is wide — widen both ends a bit on top of the tier baseline.
    return {
      turns: [Math.max(3, b.turns[0] - 2), b.turns[1] + 10],
      reads: [Math.max(1, b.reads[0] - 1), b.reads[1] + 5],
    };
  }
  return b;
}

export function classifyTask(rawTask: string): ComplexityScore {
  const task = rawTask ?? "";
  const taskLower = lower(task);
  const verb = classifyVerb(taskLower);
  const mentionedFiles = countMentionedFiles(task);
  const scopeBoost = countScopeBoosts(task);
  const scopeReduce = countScopeReduces(task);
  const wordCount = countWords(task);

  let tier = baseTierForVerb(verb);
  // mentioned files raise the tier proportionally (every 3 files = +1 step).
  if (mentionedFiles >= 6) tier = shiftTier(tier, 1);
  if (mentionedFiles >= 12) tier = shiftTier(tier, 1);
  // scope boosts raise; reduces lower.
  if (scopeBoost > 0) tier = shiftTier(tier, 1);
  if (scopeReduce > 0) tier = shiftTier(tier, -1);
  // very long task descriptions (>= 60 words) raise the tier — usually means
  // multiple requirements bundled in.
  if (wordCount >= 60) tier = shiftTier(tier, 1);

  const bands = bandsForTier(tier, verb);

  return {
    tier,
    verb,
    expectedTurns: bands.turns,
    expectedReads: bands.reads,
    mentionedFiles,
    scopeBoost,
    scopeReduce,
    wordCount,
  };
}
