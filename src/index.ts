/**
 * Programmatic entrypoint for `sipcode` consumed as a library.
 *
 * Most users invoke the binary (`npx sipcode why`, etc.). For
 * advanced/CI use, expose the command runners so callers can drive
 * Sipcode from their own code with injected dependencies.
 *
 * Privacy contract: importing this module pulls in command code paths
 * which all import `ASSERT_NO_NETWORK`. The privacy guard test
 * enforces no network access across the entire surface area.
 */
export { runWhy, type WhyOptions, type WhyDeps } from "./commands/why.js";
export {
  runManifest,
  type ManifestOptions,
  type ManifestDeps,
} from "./commands/manifest.js";
export { runInit, type InitOptions, type InitDeps } from "./commands/init.js";
export {
  runReceipt,
  type ReceiptOptions,
  type ReceiptDeps,
} from "./commands/receipt.js";
export {
  runRules,
  type RulesOptions,
  type RulesDeps,
} from "./commands/rules.js";
export {
  runEstimate,
  type EstimateOptions,
  type EstimateDeps,
} from "./commands/estimate.js";
export {
  runStats,
  type StatsOptions,
  type StatsDeps,
} from "./commands/stats.js";
export {
  runScoreCmd as runScore,
  type ScoreOptions,
  type ScoreDeps,
} from "./commands/score.js";
export {
  runBenchmark,
  type BenchmarkOptions,
  type BenchmarkDeps,
} from "./commands/benchmark.js";
export {
  runHygiene,
  type HygieneOptions,
  type HygieneDeps,
} from "./commands/hygiene.js";

// Privacy contract — see PRIVACY.md.
export { ASSERT_NO_NETWORK } from "./lib/privacy.js";
