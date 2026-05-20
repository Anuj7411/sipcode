/**
 * Corpus walker. Pure-ish: discovers benchmark tasks on disk.
 *
 * Each task lives at `benchmark/corpus/<id>/` with:
 *   - task.yml — flat key: value metadata
 *   - prompt.md, expected.md — human-readable
 *   - baseline-transcript.jsonl, optimized-transcript.jsonl — fixtures
 *   - repo/ — synthetic codebase
 *
 * Discovery is alphabetical-by-id so ordering is reproducible.
 */
import path from "node:path";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { issue, type SipcodeIssue } from "../../lib/errors.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { BenchmarkTask, TaskCategory } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VALID_CATEGORIES: ReadonlySet<TaskCategory> = new Set([
  "refactor",
  "debug",
  "feature",
  "test",
  "review",
  "docs",
  "migration",
  "onboarding",
  "optimization",
  "bugfix-cross-file",
  // BT011-BT020 — Hardest Tasks subset categories
  "exploration",
  "dependency-trace",
  "api-discovery",
  "test-failure-triage",
  "config-archaeology",
  "type-inference",
  "rename-everything",
  "dead-code",
  "security-review",
  "dependency-update",
]);

/**
 * Default corpus root: `<repo>/benchmark/corpus`. From `src/modules/benchmark`,
 * that's four levels up. Callers can override via corpusDir.
 */
export function defaultCorpusDir(): string {
  // dist/modules/benchmark when compiled, src/modules/benchmark via tsx.
  // Walk up until we see a `benchmark/corpus` folder, but cap depth.
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "benchmark", "corpus");
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return path.resolve(__dirname, "..", "..", "..", "benchmark", "corpus");
}

/**
 * Flat-yaml subset parser. Supports only the shape we ship:
 *   key: value
 *   key: "quoted value"
 * Lines starting with `#` are comments. No nesting, no lists, no anchors.
 */
export function parseFlatYaml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line || line.trimStart().startsWith("#")) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let value = m[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    const hash = value.indexOf(" #");
    if (hash >= 0) value = value.slice(0, hash).trim();
    out[key] = value;
  }
  return out;
}

function loadTask(taskDir: string): Result<BenchmarkTask, SipcodeIssue[]> {
  const issues: SipcodeIssue[] = [];
  const taskYml = path.join(taskDir, "task.yml");
  const baseline = path.join(taskDir, "baseline-transcript.jsonl");
  const optimized = path.join(taskDir, "optimized-transcript.jsonl");

  if (!existsSync(taskYml)) {
    issues.push(
      issue("E003", `task.yml missing in ${path.basename(taskDir)}.`, {
        path: taskYml,
      }),
    );
    return err(issues);
  }
  if (!existsSync(baseline)) {
    issues.push(
      issue(
        "E003",
        `baseline-transcript.jsonl missing in ${path.basename(taskDir)}.`,
        { path: baseline },
      ),
    );
  }
  if (!existsSync(optimized)) {
    issues.push(
      issue(
        "E003",
        `optimized-transcript.jsonl missing in ${path.basename(taskDir)}.`,
        { path: optimized },
      ),
    );
  }
  if (issues.length > 0) return err(issues);

  const meta = parseFlatYaml(readFileSync(taskYml, "utf-8"));
  const id = meta.id?.trim() ?? path.basename(taskDir);
  const title = meta.title?.trim() ?? id;
  const rawCategory = (meta.category ?? "feature").trim() as TaskCategory;
  const category: TaskCategory = VALID_CATEGORIES.has(rawCategory)
    ? rawCategory
    : "feature";
  const difficulty = meta.difficulty?.trim() ?? "medium";
  const modelRecommended =
    meta.model_recommended?.trim() ??
    meta.model?.trim() ??
    "claude-opus-4";
  const estimatedCostBand =
    meta.estimated_cost_band?.trim() ?? meta.cost_band?.trim() ?? "medium";
  const notes = meta.notes?.trim() ?? "";

  return ok({
    id,
    title,
    category,
    difficulty,
    modelRecommended,
    estimatedCostBand,
    notes,
    absPath: taskDir,
    baselineTranscriptPath: baseline,
    optimizedTranscriptPath: optimized,
  });
}

/**
 * Walk a corpus directory. Returns tasks sorted by id. A missing transcript
 * fails the whole walk; partial corpora are not allowed.
 */
export function loadCorpus(
  corpusDir: string = defaultCorpusDir(),
): Result<ReadonlyArray<BenchmarkTask>, SipcodeIssue[]> {
  if (!existsSync(corpusDir)) {
    return err([
      issue(
        "E003",
        `benchmark corpus not found at ${corpusDir}. run from a sipcode checkout - the corpus ships in the repo.`,
        { path: corpusDir },
      ),
    ]);
  }
  const dirEntries = readdirSync(corpusDir)
    .map((name) => ({ name, full: path.join(corpusDir, name) }))
    .filter((e) => {
      try {
        return statSync(e.full).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const tasks: BenchmarkTask[] = [];
  const allIssues: SipcodeIssue[] = [];
  for (const e of dirEntries) {
    const r = loadTask(e.full);
    if (r.ok) tasks.push(r.value);
    else allIssues.push(...r.error);
  }
  if (allIssues.length > 0) return err(allIssues);
  return ok(tasks);
}

/**
 * Pick the 3 fastest tasks by combined transcript byte size - used by --quick.
 */
export function pickQuickTasks(
  tasks: ReadonlyArray<BenchmarkTask>,
  n = 3,
): ReadonlyArray<BenchmarkTask> {
  const measured = tasks.map((t) => {
    let size = 0;
    try {
      size += statSync(t.baselineTranscriptPath).size;
    } catch {
      /* ignore */
    }
    try {
      size += statSync(t.optimizedTranscriptPath).size;
    } catch {
      /* ignore */
    }
    return { t, size };
  });
  measured.sort((a, b) => a.size - b.size);
  return measured.slice(0, n).map((m) => m.t);
}
