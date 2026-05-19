/**
 * `sipcode estimate "<task>"` — predict the cost of a coding task across
 * opus / sonnet / haiku, BEFORE the user spends a token.
 *
 * Thin orchestrator: classify → load repo context → load historical anchors
 * → predict → recommend → format.
 *
 * All I/O via seams; zero LLM calls; zero network.
 */
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import { loadPricingForDate, pricingAgeDays } from "../lib/pricing/load.js";
import { classifyTask } from "../modules/estimate/heuristics.js";
import { loadRepoContext } from "../modules/estimate/repoContext.js";
import { loadAnchors } from "../modules/estimate/anchors.js";
import { predict } from "../modules/estimate/predict.js";
import { recommend } from "../modules/estimate/recommend.js";
import { formatJson } from "../modules/estimate/format-json.js";
import { formatTerminal } from "../modules/estimate/format-terminal.js";
import type { EstimateResult } from "../modules/estimate/types.js";

export interface EstimateOptions {
  task?: string;
  repo?: string;
  json?: boolean;
  anchors?: boolean; // commander emits `anchors: false` when --no-anchors used
  model?: string;
  cwd?: string;
}

export interface EstimateDeps {
  fs?: FileSystem;
  clock?: Clock;
  env?: ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

export interface EstimateRunResult {
  readonly exitCode: 0 | 1;
}

export async function runEstimate(
  opts: EstimateOptions,
  deps: EstimateDeps = {},
): Promise<EstimateRunResult> {
  const fs = deps.fs ?? new RealFileSystem();
  const clock = deps.clock ?? new RealClock();
  const env = deps.env ?? new RealProcessEnv();
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s + "\n"));

  const task = (opts.task ?? "").trim();
  if (task.length === 0) {
    stderr(
      [
        `[E010] missing task description.`,
        ``,
        `why: sipcode estimate needs a one-line description of what you're about to do — that's the input that drives the prediction.`,
        ``,
        `fix: wrap the task in quotes.`,
        ``,
        `next: npx sipcode estimate "refactor the auth module to use jwt"`,
      ].join("\n"),
    );
    return { exitCode: 1 };
  }

  const cwd = opts.repo ?? opts.cwd ?? process.cwd();

  const complexity = classifyTask(task);
  const repoContext = await loadRepoContext(fs, cwd);
  const anchors = await loadAnchors(fs, env, complexity.tier, {
    skip: opts.anchors === false,
  });

  const pricing = loadPricingForDate(clock.now());
  const ageDays = pricingAgeDays(pricing, clock.now());

  const predictions = predict({
    complexity,
    repoContext,
    anchors,
    pricing,
  });
  const recommendation = recommend(predictions, complexity, anchors);

  const warnings: string[] = [];
  if (!repoContext.manifestPresent && !opts.json) {
    // already surfaced in fallbackNote — no extra warning
  }
  if (anchors.confidence === "low" && !anchors.skipped) {
    warnings.push(
      "low-confidence prediction — no past sessions matched this complexity tier. heuristic only.",
    );
  }
  if (anchors.skipped) {
    warnings.push(
      "anchors skipped via --no-anchors — confidence is low by definition.",
    );
  }
  if (ageDays > 30) {
    warnings.push(
      `pricing is ${ageDays} days old (as of ${pricing.as_of}) — update sipcode for fresh numbers.`,
    );
  }

  const result: EstimateResult = {
    schemaVersion: "sipcode-estimate/1",
    task,
    complexity,
    repoContext,
    anchors,
    predictions,
    recommendation,
    metaPricing: { asOf: pricing.as_of, ageDays },
    warnings,
  };

  if (opts.json) {
    stdout(formatJson(result));
  } else {
    const useColor =
      env.get("NO_COLOR") === undefined && (process.stdout?.isTTY ?? false);
    const fmtOpts: { useColor: boolean; onlyModel?: string } = { useColor };
    if (opts.model) fmtOpts.onlyModel = opts.model;
    stdout(formatTerminal(result, fmtOpts));
  }

  return { exitCode: 0 };
}
