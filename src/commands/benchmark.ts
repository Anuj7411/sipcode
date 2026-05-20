/**
 * `sipcode benchmark` — reproducible benchmark suite (S110).
 *
 * Thin orchestrator: load corpus → re-analyze locked transcripts via existing
 * analyzers → aggregate → render → format → print (+ optionally write HTML / JSON).
 *
 * NO live model calls. The benchmark measures a static analysis over locked
 * transcript fixtures. Reproducibility comes from the locked corpus.
 */
import path from "node:path";
import { promises as nodeFs, readFileSync } from "node:fs";
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { MESSAGES } from "../lib/messages.js";
import { loadPricingForDate, pricingAgeDays } from "../lib/pricing/load.js";
import {
  loadCorpus,
  pickQuickTasks,
  defaultCorpusDir,
} from "../modules/benchmark/corpus.js";
import { runOne } from "../modules/benchmark/runOne.js";
import { runSuite } from "../modules/benchmark/runSuite.js";
import { renderBenchmark } from "../modules/benchmark/render.js";
import { formatTerminal, formatTaskList } from "../modules/benchmark/format-terminal.js";
import { formatHtml } from "../modules/benchmark/format-html.js";
import { formatJson } from "../modules/benchmark/format-json.js";
import type {
  BenchmarkTask,
  TaskResult,
} from "../modules/benchmark/types.js";

export interface BenchmarkOptions {
  task?: string;
  list?: boolean;
  html?: boolean;
  json?: boolean;
  quick?: boolean;
  corpus?: string;
  cwd?: string;
}

export interface BenchmarkDeps {
  fs?: FileSystem;
  clock?: Clock;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  writeFile?: (absPath: string, content: string) => Promise<void>;
  /** Read transcript .jsonl content. Default reads from disk. */
  readTranscript?: (absPath: string) => string;
}

export interface BenchmarkResult {
  readonly exitCode: 0 | 1;
}

async function defaultWriteFile(p: string, c: string): Promise<void> {
  await nodeFs.mkdir(path.dirname(p), { recursive: true });
  await nodeFs.writeFile(p, c, "utf-8");
}

const defaultReadTranscript = (p: string): string => readFileSync(p, "utf-8");

function posix(p: string): string {
  return p.replace(/\\/g, "/");
}

export async function runBenchmark(
  opts: BenchmarkOptions = {},
  deps: BenchmarkDeps = {},
): Promise<BenchmarkResult> {
  const clock = deps.clock ?? new RealClock();
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s + "\n"));
  const writeFile = deps.writeFile ?? defaultWriteFile;
  const readTranscript = deps.readTranscript ?? defaultReadTranscript;
  const cwd = opts.cwd ?? process.cwd();

  // Locate the corpus. Default lives at <repo>/benchmark/corpus.
  const corpusDir = opts.corpus ?? defaultCorpusDir();

  const corpusResult = loadCorpus(corpusDir);
  if (!corpusResult.ok) {
    for (const i of corpusResult.error) stderr(`[${i.code}] ${i.message}`);
    return { exitCode: 1 };
  }
  let tasks: ReadonlyArray<BenchmarkTask> = corpusResult.value;

  // --list: print and exit.
  if (opts.list) {
    stdout(formatTaskList(tasks));
    return { exitCode: 0 };
  }

  // --task <id>: scope to a single task.
  if (opts.task) {
    const id = opts.task.toUpperCase();
    const single = tasks.find((t) => t.id === id);
    if (!single) {
      stderr(MESSAGES.benchmarkTaskNotFound(opts.task));
      return { exitCode: 1 };
    }
    tasks = [single];
  } else if (opts.quick) {
    tasks = pickQuickTasks(tasks, 3);
  }

  if (tasks.length === 0) {
    stderr(MESSAGES.benchmarkEmptyCorpus(corpusDir));
    return { exitCode: 1 };
  }

  // Pricing — use today.
  const pricing = loadPricingForDate(clock.now());
  const ageDays = pricingAgeDays(pricing, clock.now());

  // Run each task: read its two transcripts, re-analyze.
  const taskResults: TaskResult[] = [];
  const warnings: { code: string; message: string }[] = [];
  for (const task of tasks) {
    let baselineJsonl: string;
    let optimizedJsonl: string;
    try {
      baselineJsonl = readTranscript(task.baselineTranscriptPath);
      optimizedJsonl = readTranscript(task.optimizedTranscriptPath);
    } catch {
      stderr(MESSAGES.benchmarkTranscriptMissing(task.id));
      warnings.push({
        code: "E003",
        message: `${task.id}: transcript missing`,
      });
      continue;
    }
    const r = runOne({ task, baselineJsonl, optimizedJsonl, pricing });
    if (!r.ok) {
      for (const i of r.error) {
        stderr(`[${i.code}] ${task.id}: ${i.message}`);
        warnings.push({ code: i.code, message: `${task.id}: ${i.message}` });
      }
      continue;
    }
    taskResults.push(r.value);
  }

  if (taskResults.length === 0) {
    stderr(MESSAGES.benchmarkAllFailed());
    return { exitCode: 1 };
  }

  const suite = runSuite({
    tasks: taskResults,
    pricingMeta: { asOf: pricing.as_of, ageDays },
    warnings,
  });
  const rendered = renderBenchmark(suite);

  // Stable timestamp for idempotence: use the pricing date, not clock.now().
  // The numbers are deterministic from corpus + pricing; the report timestamp
  // should be too.

  if (opts.json) {
    stdout(formatJson(rendered));
  } else {
    stdout(formatTerminal(rendered));
    if (ageDays > 30) {
      stderr("");
      stderr(MESSAGES.pricingStale(pricing.as_of, ageDays));
    }
  }

  if (opts.html) {
    const outPath = path.join(cwd, ".sipcode", "benchmark.html");
    await writeFile(outPath, formatHtml(rendered));
    if (!opts.json) {
      stdout("");
      stdout(`wrote ${posix(path.relative(cwd, outPath))}`);
    }
  }

  return { exitCode: 0 };
}
