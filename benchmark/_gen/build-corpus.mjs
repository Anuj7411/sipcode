/**
 * One-shot corpus generator.
 *
 * NOT shipped — lives under benchmark/_gen/. The .jsonl files THIS script
 * produces are what ship. The benchmark runtime never executes this script;
 * it just reads the locked .jsonl outputs.
 *
 * Run from repo root:
 *   node benchmark/_gen/build-corpus.mjs
 *
 * Idempotent: deterministic timestamps, fixed-ordering, no randomness.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.resolve(__dirname, "..", "corpus");

const MODEL = "claude-opus-4-7";

/**
 * Deterministic ISO timestamp generator. Each call advances by 12s.
 */
function tsFactory(start = "2026-05-15T10:00:00.000Z") {
  let cursor = new Date(start).getTime();
  return () => {
    const out = new Date(cursor).toISOString();
    cursor += 12_000;
    return out;
  };
}

let uuidCounter = 0;
function uid() {
  uuidCounter++;
  return `uuid-${uuidCounter.toString(36).padStart(8, "0")}`;
}

/** Build a user-prompt entry. */
function userPrompt(text, ts, sessionId, cwd) {
  return {
    type: "user",
    uuid: uid(),
    timestamp: ts,
    sessionId,
    cwd,
    message: { role: "user", content: text },
  };
}

/** Build a user-tool-result entry. */
function userToolResult(toolUseId, content, ts, sessionId, cwd) {
  return {
    type: "user",
    uuid: uid(),
    timestamp: ts,
    sessionId,
    cwd,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
    },
  };
}

/** Build an assistant entry with one or more tool_use blocks + usage. */
function assistantWithTools(tools, usage, ts, sessionId, cwd, textPrelude) {
  const content = [];
  if (textPrelude) content.push({ type: "text", text: textPrelude });
  for (const t of tools) {
    content.push({
      type: "tool_use",
      id: t.id,
      name: t.name,
      input: t.input,
    });
  }
  return {
    type: "assistant",
    uuid: uid(),
    timestamp: ts,
    sessionId,
    cwd,
    message: {
      model: MODEL,
      role: "assistant",
      content,
      usage,
    },
  };
}

/** Build an assistant text-only entry (the final reply) + usage. */
function assistantText(text, usage, ts, sessionId, cwd) {
  return {
    type: "assistant",
    uuid: uid(),
    timestamp: ts,
    sessionId,
    cwd,
    message: {
      model: MODEL,
      role: "assistant",
      content: [{ type: "text", text }],
      usage,
    },
  };
}

function toolUse(id, name, input) {
  return { id, name, input };
}

function usage(input, output, cacheRead, cacheCreation) {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreation,
  };
}

function writeJsonl(filePath, entries) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const text = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(filePath, text, "utf-8");
}

/**
 * Generate a transcript pair given a recipe. The recipe is a small
 * declarative description of the agent's actions in each flavor.
 *
 * Each "step" is a tool call. The baseline can repeat the same Read calls
 * (duplicate-reads), holds large context (high cache_creation), and writes
 * verbose outputs. The optimized version reads each file once, has a smaller
 * cache_creation footprint (thanks to a manifest), and writes diffs.
 */
function buildPair(taskId, cwd, recipe) {
  uuidCounter = 0; // reset so files are deterministic
  const baselineTs = tsFactory("2026-05-15T10:00:00.000Z");
  const optimizedTs = tsFactory("2026-05-16T10:00:00.000Z");
  const baselineSession = `bt-${taskId.toLowerCase()}-baseline`;
  const optimizedSession = `bt-${taskId.toLowerCase()}-optimized`;

  function buildFlavor(flavor, session, tsGen, steps) {
    const entries = [];
    entries.push(userPrompt(recipe.prompt, tsGen(), session, cwd));
    let toolIdCounter = 0;
    for (const step of steps) {
      toolIdCounter++;
      const toolId = `tu-${flavor}-${toolIdCounter.toString().padStart(4, "0")}`;
      // assistant emits the tool call
      const ats = tsGen();
      entries.push(
        assistantWithTools(
          [toolUse(toolId, step.tool, step.input)],
          usage(step.input_tokens, step.output_tokens, step.cache_read_input_tokens, step.cache_creation_input_tokens),
          ats,
          session,
          cwd,
          step.preludeText,
        ),
      );
      // user replies with a tool_result (no usage cost — that's the assistant's bookkeeping)
      entries.push(
        userToolResult(
          toolId,
          step.tool_result_text ?? "ok",
          tsGen(),
          session,
          cwd,
        ),
      );
    }
    // Final assistant text response.
    entries.push(
      assistantText(
        recipe[`${flavor}FinalText`] ?? "done.",
        usage(
          recipe[`${flavor}FinalUsage`].input_tokens,
          recipe[`${flavor}FinalUsage`].output_tokens,
          recipe[`${flavor}FinalUsage`].cache_read_input_tokens,
          recipe[`${flavor}FinalUsage`].cache_creation_input_tokens,
        ),
        tsGen(),
        session,
        cwd,
      ),
    );
    return entries;
  }

  const baseDir = path.join(CORPUS, taskId);
  writeJsonl(
    path.join(baseDir, "baseline-transcript.jsonl"),
    buildFlavor("baseline", baselineSession, baselineTs, recipe.baseline),
  );
  writeJsonl(
    path.join(baseDir, "optimized-transcript.jsonl"),
    buildFlavor("optimized", optimizedSession, optimizedTs, recipe.optimized),
  );
}

/**
 * Helpers to construct steps.
 */
function readStep(filePath, inputTokens, cacheCreation, cacheRead = 0) {
  return {
    tool: "Read",
    input: { file_path: filePath },
    input_tokens: inputTokens,
    output_tokens: 0,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreation,
    tool_result_text: `<contents of ${filePath} — synthetic>`,
  };
}

function editStep(filePath, inputTokens, outputTokens, cacheRead = 0) {
  return {
    tool: "Edit",
    input: {
      file_path: filePath,
      old_string: "<old>",
      new_string: "<new>",
    },
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: 0,
    tool_result_text: `edited ${filePath}.`,
  };
}

function writeStep(filePath, inputTokens, outputTokens, cacheRead = 0) {
  return {
    tool: "Write",
    input: { file_path: filePath, content: "<file content>" },
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: 0,
    tool_result_text: `wrote ${filePath}.`,
  };
}

function bashStep(cmd, inputTokens, outputTokens, cacheRead = 0) {
  return {
    tool: "Bash",
    input: { command: cmd },
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: 0,
    tool_result_text: "ok",
  };
}

function grepStep(pattern, inputTokens, outputTokens, cacheRead = 0) {
  return {
    tool: "Grep",
    input: { pattern },
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: 0,
    tool_result_text: "matches…",
  };
}

/**
 * ====================== THE 10 TASKS ======================
 */

// BT001 — refactor (rename function across 12 files). High duplicate-read.
// Baseline: 12 file reads, then 4 re-reads, then 12 edits. Lots of context.
// Optimized: manifest first, 12 reads, 12 edits (diff-only).
{
  const cwd = "/work/projects/refactor-repo";
  const files = [
    "src/index.ts", "src/utils.ts", "src/api/users.ts", "src/api/posts.ts",
    "src/api/comments.ts", "src/db/client.ts", "src/db/migrations.ts",
    "src/middleware/auth.ts", "src/middleware/logging.ts", "src/lib/format.ts",
    "src/lib/dates.ts", "tests/users.test.ts",
  ];
  const baseline = [];
  // 12 grep + 12 reads
  baseline.push(grepStep("oldFunctionName", 12000, 800, 1000));
  for (const f of files) baseline.push(readStep(f, 4500, 3500, 8000));
  // Re-read 4 files because the agent forgot.
  for (const f of files.slice(0, 4)) baseline.push(readStep(f, 4500, 3500, 9500));
  // 12 edits writing full files (Edit but verbose — high output)
  for (const f of files) baseline.push(editStep(f, 3000, 6000, 12000));

  const optimized = [];
  // First read manifest, then read each file once, then 12 diff-edits.
  optimized.push(readStep(".sipcode/manifest.md", 1800, 1900, 0));
  for (const f of files) optimized.push(readStep(f, 4500, 0, 4500));
  for (const f of files) optimized.push(editStep(f, 1800, 600, 5000));

  buildPair("BT001", cwd, {
    prompt: "rename oldFunctionName to newFunctionName across the codebase. update all call sites.",
    baseline,
    optimized,
    baselineFinalText: "I renamed oldFunctionName to newFunctionName in 12 files. Here is what changed in each file:\n\n" +
      "src/index.ts: updated 3 call sites of oldFunctionName to newFunctionName...\n" +
      "src/utils.ts: this file exported oldFunctionName; renamed export and 2 internal callers...\n" +
      "src/api/users.ts: 4 call sites updated; signature unchanged...\n" +
      "...detailed prose for each file...",
    baselineFinalUsage: usage(2000, 3500, 30000, 0),
    optimizedFinalText: "renamed in 12 files. all call sites updated.",
    optimizedFinalUsage: usage(800, 80, 10000, 0),
  });
}

// BT002 — debug a null-pointer bug across 3 files. Small task.
{
  const cwd = "/work/projects/payment-pipeline";
  const baseline = [
    grepStep("processPayment", 4500, 600, 0),
    readStep("src/payment/process.ts", 5200, 4100, 7000),
    readStep("src/payment/validate.ts", 4000, 3200, 8000),
    readStep("src/payment/types.ts", 3000, 2400, 9000),
    // Re-read process.ts twice to "look harder"
    readStep("src/payment/process.ts", 5200, 0, 9500),
    readStep("src/payment/process.ts", 5200, 0, 10000),
    bashStep("npm test -- payment", 1200, 8000, 10500),
    editStep("src/payment/process.ts", 3000, 4000, 11000),
    bashStep("npm test -- payment", 800, 6000, 11500),
  ];
  const optimized = [
    readStep(".sipcode/manifest.md", 1800, 1700, 0),
    grepStep("processPayment", 1500, 300, 1900),
    readStep("src/payment/process.ts", 4200, 0, 3500),
    readStep("src/payment/validate.ts", 3000, 0, 5000),
    readStep("src/payment/types.ts", 2200, 0, 6000),
    editStep("src/payment/process.ts", 1500, 350, 7000),
    bashStep("npm test -- payment", 800, 2500, 7500),
  ];
  buildPair("BT002", cwd, {
    prompt: "fix the null-pointer in the payment-pipeline that crashes on guest checkout.",
    baseline,
    optimized,
    baselineFinalText: "Fixed by guarding against null in processPayment. Here's a detailed walk-through of root cause... <prose>",
    baselineFinalUsage: usage(2200, 4200, 22000, 0),
    optimizedFinalText: "fixed: guarded null in process.ts. tests pass.",
    optimizedFinalUsage: usage(600, 60, 8000, 0),
  });
}

// BT003 — feature: add a REST endpoint. Typical exploration task.
{
  const cwd = "/work/projects/express-api";
  const baseline = [
    bashStep("ls -la src/", 800, 400, 0),
    readStep("src/server.ts", 5500, 4400, 6500),
    readStep("src/routes/index.ts", 3000, 2400, 7500),
    readStep("src/routes/users.ts", 5500, 4400, 8500),
    readStep("src/routes/posts.ts", 5800, 4600, 9500),
    readStep("src/middleware/auth.ts", 3500, 2800, 10500),
    readStep("src/middleware/validate.ts", 3200, 2600, 11500),
    readStep("src/db/client.ts", 4000, 3200, 12500),
    grepStep("router.post", 2000, 1500, 13500),
    // re-read posts because we forgot the validate pattern
    readStep("src/routes/posts.ts", 5800, 0, 14500),
    writeStep("src/routes/products.ts", 4000, 9000, 15500),
    editStep("src/routes/index.ts", 3000, 4500, 16500),
    bashStep("npm test", 1500, 12000, 17500),
  ];
  const optimized = [
    readStep(".sipcode/manifest.md", 1800, 1900, 0),
    readStep("src/routes/posts.ts", 5800, 0, 3500),
    readStep("src/routes/index.ts", 3000, 0, 5000),
    writeStep("src/routes/products.ts", 2200, 1500, 6500),
    editStep("src/routes/index.ts", 1500, 250, 7500),
    bashStep("npm test", 1500, 3500, 8500),
  ];
  buildPair("BT003", cwd, {
    prompt: "add a /api/products GET endpoint following the same pattern as /api/posts.",
    baseline,
    optimized,
    baselineFinalText: "Added /api/products. Detailed explanation of the design, the route registration, the auth middleware integration, the validation strategy, and how I matched the posts pattern...",
    baselineFinalUsage: usage(2500, 5000, 28000, 0),
    optimizedFinalText: "added /api/products. mirrors /api/posts. tests pass.",
    optimizedFinalUsage: usage(700, 70, 9000, 0),
  });
}

// BT004 — test: write Vitest tests for a utility module.
{
  const cwd = "/work/projects/utils-lib";
  const baseline = [
    bashStep("ls src/", 600, 300, 0),
    readStep("src/strings.ts", 6000, 4800, 4500),
    readStep("src/dates.ts", 5500, 4400, 5500),
    readStep("tests/dates.test.ts", 4000, 3200, 6500),
    readStep("vitest.config.ts", 1500, 1200, 7500),
    // re-read strings to remember a function signature
    readStep("src/strings.ts", 6000, 0, 8500),
    writeStep("tests/strings.test.ts", 4000, 9000, 9500),
    bashStep("npm test", 1500, 6000, 10500),
  ];
  const optimized = [
    readStep(".sipcode/manifest.md", 1800, 1700, 0),
    readStep("src/strings.ts", 6000, 0, 3500),
    readStep("tests/dates.test.ts", 4000, 0, 5000),
    writeStep("tests/strings.test.ts", 2500, 2000, 6500),
    bashStep("npm test", 1200, 1800, 7500),
  ];
  buildPair("BT004", cwd, {
    prompt: "write vitest tests for the strings module — cover camelCase, snakeCase, slugify.",
    baseline,
    optimized,
    baselineFinalText: "Added 14 tests covering all three functions. Walk-through of each test case...",
    baselineFinalUsage: usage(1700, 3200, 18000, 0),
    optimizedFinalText: "added 14 tests. all pass.",
    optimizedFinalUsage: usage(500, 50, 7500, 0),
  });
}

// BT005 — review: code-review a 200-line PR diff. Output-token heavy.
{
  const cwd = "/work/projects/under-review-repo";
  const baseline = [
    bashStep("git diff main", 2000, 18000, 0),
    readStep("src/changed/feature.ts", 8000, 6400, 5500),
    readStep("src/changed/feature.test.ts", 6000, 4800, 6500),
    readStep("src/related/helpers.ts", 4500, 3600, 7500),
    grepStep("feature\\.ts", 1500, 800, 8500),
  ];
  // verbose review comments
  baseline.push({
    tool: "Write",
    input: { file_path: "review-notes.md", content: "<verbose>" },
    input_tokens: 4000,
    output_tokens: 22000,
    cache_read_input_tokens: 9500,
    cache_creation_input_tokens: 0,
    tool_result_text: "wrote.",
  });
  const optimized = [
    readStep(".sipcode/manifest.md", 1800, 1700, 0),
    bashStep("git diff main", 1500, 8500, 3500),
    readStep("src/changed/feature.ts", 5000, 0, 4500),
    readStep("src/related/helpers.ts", 3500, 0, 5500),
    {
      tool: "Write",
      input: { file_path: "review-notes.md", content: "<diff>" },
      input_tokens: 2000,
      output_tokens: 4500,
      cache_read_input_tokens: 6500,
      cache_creation_input_tokens: 0,
      tool_result_text: "wrote.",
    },
  ];
  buildPair("BT005", cwd, {
    prompt: "review this PR. flag correctness, perf, style, and test coverage gaps.",
    baseline,
    optimized,
    baselineFinalText: "Full review with annotated comments inline.\n\n" + "Comment 1: ... Comment 2: ... Comment 3: ...".repeat(20),
    baselineFinalUsage: usage(3000, 9000, 15000, 0),
    optimizedFinalText: "review written to review-notes.md.",
    optimizedFinalUsage: usage(600, 60, 7000, 0),
  });
}

// BT006 — docs: low-savings baseline (gives honest range).
{
  const cwd = "/work/projects/docs-update";
  const baseline = [
    readStep("README.md", 4000, 3200, 0),
    readStep("package.json", 1500, 1200, 2500),
    readStep("CHANGELOG.md", 3000, 2400, 3500),
    grepStep("contributing", 800, 400, 4500),
    editStep("README.md", 2500, 6500, 5500),
    writeStep("CONTRIBUTING.md", 3000, 9500, 6500),
  ];
  const optimized = [
    readStep(".sipcode/manifest.md", 1800, 1700, 0),
    readStep("README.md", 4000, 0, 2500),
    readStep("package.json", 1500, 0, 4000),
    editStep("README.md", 2000, 3500, 5000),
    writeStep("CONTRIBUTING.md", 2500, 5500, 6000),
  ];
  buildPair("BT006", cwd, {
    prompt: "update README, add a CONTRIBUTING.md with PR + commit guidelines.",
    baseline,
    optimized,
    baselineFinalText: "Updated README. Wrote CONTRIBUTING. Here's a detailed summary of the changes...",
    baselineFinalUsage: usage(1500, 3000, 8000, 0),
    optimizedFinalText: "updated README. wrote CONTRIBUTING.",
    optimizedFinalUsage: usage(500, 200, 5000, 0),
  });
}

// BT007 — migration: schema across 8 files. Dup-read worst case.
{
  const cwd = "/work/projects/config-migration";
  const files = [
    "src/config/loader.ts", "src/config/schema.ts", "src/config/defaults.ts",
    "src/config/validate.ts", "src/server/config.ts", "src/server/init.ts",
    "tests/config.test.ts", "docs/config.md",
  ];
  const baseline = [];
  baseline.push(grepStep("LegacyConfig", 6000, 1200, 0));
  for (const f of files) baseline.push(readStep(f, 5000, 4000, 6000));
  // re-read schema twice + loader twice
  baseline.push(readStep("src/config/schema.ts", 5000, 0, 12000));
  baseline.push(readStep("src/config/loader.ts", 5000, 0, 12500));
  baseline.push(readStep("src/config/schema.ts", 5000, 0, 13000));
  baseline.push(readStep("src/config/loader.ts", 5000, 0, 13500));
  for (const f of files) baseline.push(editStep(f, 2500, 4500, 14000));

  const optimized = [];
  optimized.push(readStep(".sipcode/manifest.md", 1800, 1900, 0));
  optimized.push(grepStep("LegacyConfig", 1500, 400, 1900));
  for (const f of files) optimized.push(readStep(f, 5000, 0, 4500));
  for (const f of files) optimized.push(editStep(f, 1500, 500, 6000));

  buildPair("BT007", cwd, {
    prompt: "migrate the LegacyConfig schema to ConfigV2 across all 8 files. Preserve defaults.",
    baseline,
    optimized,
    baselineFinalText: "Migrated 8 files. Detailed walkthrough per file of the LegacyConfig → ConfigV2 mapping...",
    baselineFinalUsage: usage(2500, 5500, 32000, 0),
    optimizedFinalText: "migrated 8 files to ConfigV2. tests pass.",
    optimizedFinalUsage: usage(700, 80, 11000, 0),
  });
}

// BT008 — onboarding: explain codebase. Manifest savings showcase.
{
  const cwd = "/work/projects/onboard-target";
  // Baseline: 15 reads to understand structure.
  const ls = [
    "README.md", "package.json", "src/index.ts", "src/lib/core.ts",
    "src/lib/util.ts", "src/api/server.ts", "src/api/routes.ts",
    "src/db/conn.ts", "src/db/models.ts", "src/cli/main.ts",
    "src/cli/parse.ts", "tests/index.test.ts", "tests/api.test.ts",
    "docs/architecture.md", "docs/intro.md",
  ];
  const baseline = [bashStep("ls -R src/", 1500, 4000, 0)];
  for (const f of ls) baseline.push(readStep(f, 3500, 2800, 4500));
  // No edits in this task — pure exploration.
  const optimized = [readStep(".sipcode/manifest.md", 1800, 1700, 0)];
  // Just read the 4 most important files instead of 15.
  for (const f of ls.slice(0, 4)) optimized.push(readStep(f, 3500, 0, 3500));

  buildPair("BT008", cwd, {
    prompt: "you're a new contributor. explain this codebase: structure, key modules, how to run, how to test.",
    baseline,
    optimized,
    baselineFinalText: "Here's a guided tour of the codebase. The repository is structured as follows...\n\n" +
      "## Top-level layout\n\n" +
      "...long prose...".repeat(30),
    baselineFinalUsage: usage(4000, 12000, 35000, 0),
    optimizedFinalText: "## Structure\n\n- src/lib: core utils\n- src/api: routes + server\n- src/db: models\n- src/cli: cli\n\n## Run: `npm start`. Test: `npm test`.",
    optimizedFinalUsage: usage(1000, 280, 9500, 0),
  });
}

// BT009 — optimization: caching to a hot path.
{
  const cwd = "/work/projects/hot-path-opt";
  const baseline = [
    bashStep("npm run bench", 1500, 8000, 0),
    grepStep("hotPath", 2000, 1500, 4500),
    readStep("src/hot/handler.ts", 6000, 4800, 5500),
    readStep("src/hot/store.ts", 5500, 4400, 6500),
    readStep("src/cache/lru.ts", 4500, 3600, 7500),
    readStep("tests/hot.test.ts", 4000, 3200, 8500),
    // re-read handler
    readStep("src/hot/handler.ts", 6000, 0, 9500),
    editStep("src/hot/handler.ts", 4500, 7000, 10500),
    bashStep("npm run bench", 1500, 8500, 11500),
  ];
  const optimized = [
    readStep(".sipcode/manifest.md", 1800, 1700, 0),
    bashStep("npm run bench", 1500, 4000, 3500),
    readStep("src/hot/handler.ts", 5500, 0, 4500),
    readStep("src/cache/lru.ts", 4000, 0, 5500),
    editStep("src/hot/handler.ts", 1800, 600, 6500),
    bashStep("npm run bench", 1500, 4000, 7500),
  ];
  buildPair("BT009", cwd, {
    prompt: "add an LRU cache to the hot path. show before/after benchmark numbers.",
    baseline,
    optimized,
    baselineFinalText: "Added LRU cache around handler. Detailed walk-through of the cache eviction strategy, the keying scheme, and the benchmark deltas...",
    baselineFinalUsage: usage(2200, 4200, 22000, 0),
    optimizedFinalText: "added LRU. 2.3× faster.",
    optimizedFinalUsage: usage(600, 50, 8500, 0),
  });
}

// BT010 — bugfix across 4 unrelated files. Hardest case for read-once.
{
  const cwd = "/work/projects/cross-cutting-bug";
  const baseline = [
    grepStep("logSpanId", 4000, 1200, 0),
    readStep("src/tracing/span.ts", 5500, 4400, 4500),
    readStep("src/middleware/log.ts", 5000, 4000, 5500),
    readStep("src/api/handler.ts", 4500, 3600, 6500),
    readStep("src/jobs/runner.ts", 4500, 3600, 7500),
    // re-read span
    readStep("src/tracing/span.ts", 5500, 0, 8500),
    editStep("src/tracing/span.ts", 2500, 3500, 9500),
    editStep("src/middleware/log.ts", 2500, 3500, 10000),
    editStep("src/api/handler.ts", 2500, 3500, 10500),
    editStep("src/jobs/runner.ts", 2500, 3500, 11000),
    bashStep("npm test", 1500, 8000, 11500),
  ];
  const optimized = [
    readStep(".sipcode/manifest.md", 1800, 1900, 0),
    grepStep("logSpanId", 1500, 400, 1900),
    readStep("src/tracing/span.ts", 5500, 0, 3500),
    readStep("src/middleware/log.ts", 5000, 0, 4500),
    readStep("src/api/handler.ts", 4500, 0, 5500),
    readStep("src/jobs/runner.ts", 4500, 0, 6500),
    editStep("src/tracing/span.ts", 1500, 350, 7500),
    editStep("src/middleware/log.ts", 1500, 350, 8000),
    editStep("src/api/handler.ts", 1500, 350, 8500),
    editStep("src/jobs/runner.ts", 1500, 350, 9000),
    bashStep("npm test", 1500, 3500, 9500),
  ];
  buildPair("BT010", cwd, {
    prompt: "fix the missing logSpanId propagation that breaks correlation across 4 unrelated files.",
    baseline,
    optimized,
    baselineFinalText: "Threaded logSpanId through tracing, log middleware, api handler, and job runner. Detailed walk-through of each file change and why the bug went undetected...",
    baselineFinalUsage: usage(2500, 4800, 24000, 0),
    optimizedFinalText: "threaded logSpanId through 4 files. tests pass.",
    optimizedFinalUsage: usage(700, 80, 10000, 0),
  });
}

// ====================== BT011-BT020 — Hardest Tasks subset ======================
// These 10 tasks are specifically designed to maximize token waste.
// Categories chosen because they're the hardest to do *cheaply*, not the
// hardest to do correctly. Reuses the same recipe shape as BT001-BT010.

// BT011 — exploration: navigate a 100-file monorepo to find one function.
// Manifest savings ceiling test — baseline does a wide ls/grep sweep + 16
// reads to triangulate; optimized reads the manifest then 2 surgical reads.
{
  const cwd = "/work/projects/monorepo-explore";
  const baselineFiles = [
    "packages/core/src/index.ts", "packages/core/src/dispatcher.ts",
    "packages/core/src/scheduler.ts", "packages/api/src/server.ts",
    "packages/api/src/routes.ts", "packages/api/src/handlers.ts",
    "packages/workers/src/queue.ts", "packages/workers/src/runner.ts",
    "packages/workers/src/registry.ts", "packages/ui/src/main.ts",
    "packages/ui/src/store.ts", "packages/db/src/client.ts",
    "packages/db/src/migrations.ts", "packages/shared/src/types.ts",
    "packages/shared/src/util.ts", "packages/shared/src/log.ts",
  ];
  const baseline = [
    bashStep("ls -R packages/", 2200, 9000, 0),
    grepStep("scheduleJob", 4500, 1500, 4500),
    bashStep("find packages -name '*.ts' | head -40", 1500, 5000, 5500),
  ];
  // baseline reads 11 of the 16 files (slightly less catastrophic than reading all)
  for (const f of baselineFiles.slice(0, 11)) baseline.push(readStep(f, 5000, 4000, 7500));

  const optimized = [
    readStep(".sipcode/manifest.md", 1800, 1900, 0),
    grepStep("scheduleJob", 1800, 500, 1900),
    readStep("packages/workers/src/queue.ts", 4500, 0, 3500),
    readStep("packages/workers/src/runner.ts", 3800, 0, 5000),
    readStep("packages/core/src/dispatcher.ts", 3200, 0, 6000),
    readStep("packages/api/src/handlers.ts", 3000, 0, 6800),
  ];
  buildPair("BT011", cwd, {
    prompt: "find where scheduleJob is defined and trace how it gets invoked from the api package.",
    baseline,
    optimized,
    baselineFinalText: "Located scheduleJob in packages/workers/src/queue.ts. It's invoked from packages/api/src/handlers.ts via the dispatcher. Walk-through of the full call chain across 11 files I read to triangulate this...",
    baselineFinalUsage: usage(2800, 5500, 24000, 0),
    optimizedFinalText: "scheduleJob defined: packages/workers/src/queue.ts:24. Called from api/handlers via core/dispatcher. Two-hop chain.",
    optimizedFinalUsage: usage(900, 150, 9500, 0),
  });
}

// BT012 — dependency-trace: trace why an import chain causes a crash.
// Duplicate-read trap — baseline re-reads the same 3 files 3 times each
// while peeling back the chain. Optimized reads once + uses summaries.
{
  const cwd = "/work/projects/import-crash";
  const baseline = [
    bashStep("npm start", 1500, 4500, 0),
    grepStep("Cannot find module", 1500, 800, 4500),
    readStep("src/app.ts", 4500, 3600, 5500),
    readStep("src/services/auth.ts", 5000, 4000, 6500),
    readStep("src/services/db.ts", 4500, 3600, 7500),
    // re-read app + auth + db twice to walk the chain
    readStep("src/app.ts", 4500, 0, 8500),
    readStep("src/services/auth.ts", 5000, 0, 9000),
    readStep("src/app.ts", 4500, 0, 9500),
    readStep("src/services/db.ts", 4500, 0, 10000),
    readStep("src/services/auth.ts", 5000, 0, 10500),
    readStep("package.json", 2000, 1600, 11000),
    editStep("src/services/auth.ts", 2500, 4500, 11500),
    bashStep("npm start", 1500, 3500, 12000),
  ];
  const optimized = [
    readStep(".sipcode/manifest.md", 1800, 1900, 0),
    bashStep("npm start", 1500, 2000, 1900),
    readStep("src/app.ts", 4500, 0, 3500),
    readStep("src/services/auth.ts", 5000, 0, 4500),
    readStep("src/services/db.ts", 4500, 0, 5500),
    readStep("package.json", 2000, 0, 6500),
    editStep("src/services/auth.ts", 1500, 400, 7500),
    bashStep("npm start", 1500, 1200, 8000),
  ];
  buildPair("BT012", cwd, {
    prompt: "the app crashes on startup with a module-not-found chain. find the broken import and fix it.",
    baseline,
    optimized,
    baselineFinalText: "Found broken import: auth.ts imports db from the wrong path, which silently fails when db re-exports a renamed type. Detailed walkthrough of the chain across all three files and why the error surface is misleading...",
    baselineFinalUsage: usage(2500, 4800, 24000, 0),
    optimizedFinalText: "fixed: auth.ts had a stale import path to db. updated. starts clean.",
    optimizedFinalUsage: usage(600, 70, 8500, 0),
  });
}

// BT013 — api-discovery: discover the public API surface of an undocumented library.
// Reads-without-writes worst case. Pure exploration, zero edits.
{
  const cwd = "/work/projects/undocumented-lib";
  const files = [
    "src/index.ts", "src/client.ts", "src/types.ts",
    "src/internal/transport.ts", "src/internal/retry.ts",
    "src/internal/auth.ts", "src/internal/serialize.ts",
    "src/errors.ts", "src/constants.ts", "src/util.ts",
    "tests/client.test.ts", "tests/transport.test.ts",
  ];
  const baseline = [bashStep("ls -R src/", 1500, 4000, 0)];
  for (const f of files) baseline.push(readStep(f, 5500, 4400, 5500));
  // re-read entry points to remember exported surface
  baseline.push(readStep("src/index.ts", 5500, 0, 12000));
  baseline.push(readStep("src/client.ts", 5500, 0, 12500));
  baseline.push(readStep("src/types.ts", 5500, 0, 13000));

  const optimized = [
    readStep(".sipcode/manifest.md", 1800, 1900, 0),
    readStep("src/index.ts", 5500, 0, 3500),
    readStep("src/client.ts", 5500, 0, 4500),
    readStep("src/types.ts", 5500, 0, 5500),
    readStep("src/errors.ts", 3500, 0, 6500),
    readStep("src/internal/transport.ts", 3500, 0, 7000),
    readStep("src/constants.ts", 2500, 0, 7500),
  ];
  buildPair("BT013", cwd, {
    prompt: "this library has no docs. document its public API: exported types, client methods, error classes, configuration options.",
    baseline,
    optimized,
    baselineFinalText: "Public API surface mapped. Detailed enumeration of every export, every method signature, every error class, with prose explanations for each...\n\n## Client class\n- constructor(opts)...\n- get/post/put/delete...\n- ...long form...".repeat(8),
    baselineFinalUsage: usage(3500, 14000, 35000, 0),
    optimizedFinalText: "## Public API\n\n- `Client(opts)`, `.request(method, path, body?)`, `.close()`\n- Types: `RequestOpts`, `Response`, `RetryPolicy`\n- Errors: `TransportError`, `AuthError`, `SerializeError`\n- Config: timeout, retries, auth.token",
    optimizedFinalUsage: usage(900, 220, 10000, 0),
  });
}

// BT014 — test-failure-triage: 6 flaky tests across 3 test files.
// Partial-information re-read pattern.
{
  const cwd = "/work/projects/flaky-tests";
  const baseline = [
    bashStep("npm test", 1500, 14000, 0),
    readStep("tests/auth.test.ts", 5500, 4400, 4500),
    readStep("tests/payment.test.ts", 6000, 4800, 5500),
    readStep("tests/inventory.test.ts", 5500, 4400, 6500),
    readStep("src/auth.ts", 4500, 3600, 7500),
    readStep("src/payment.ts", 5000, 4000, 8500),
    readStep("src/inventory.ts", 4500, 3600, 9500),
    // re-read tests after looking at source
    readStep("tests/auth.test.ts", 5500, 0, 10500),
    readStep("tests/payment.test.ts", 6000, 0, 11000),
    bashStep("npm test -- --reporter=verbose", 1500, 11000, 11500),
    readStep("tests/inventory.test.ts", 5500, 0, 12000),
    editStep("tests/auth.test.ts", 2500, 3500, 12500),
    editStep("tests/payment.test.ts", 2500, 3500, 13000),
    editStep("tests/inventory.test.ts", 2500, 3500, 13500),
    bashStep("npm test", 1500, 6000, 14000),
  ];
  const optimized = [
    readStep(".sipcode/manifest.md", 1800, 1900, 0),
    bashStep("npm test", 1500, 6000, 1900),
    readStep("tests/auth.test.ts", 5500, 0, 4500),
    readStep("tests/payment.test.ts", 6000, 0, 5500),
    readStep("tests/inventory.test.ts", 5500, 0, 6500),
    readStep("src/auth.ts", 4500, 0, 7500),
    editStep("tests/auth.test.ts", 1500, 400, 8500),
    editStep("tests/payment.test.ts", 1500, 400, 9000),
    editStep("tests/inventory.test.ts", 1500, 400, 9500),
    bashStep("npm test", 1500, 2200, 10000),
  ];
  buildPair("BT014", cwd, {
    prompt: "6 tests are flaky across 3 files. diagnose root cause and stabilize them.",
    baseline,
    optimized,
    baselineFinalText: "Stabilized 6 flaky tests. Root causes: 2 timing races in auth, 2 unmocked clock calls in payment, 2 shared-state leaks in inventory. Detailed walkthrough of each fix...",
    baselineFinalUsage: usage(2800, 6000, 28000, 0),
    optimizedFinalText: "fixed 6 flakes: 2 timing races, 2 clock mocks, 2 state leaks. tests green.",
    optimizedFinalUsage: usage(700, 90, 9000, 0),
  });
}

// BT015 — config-archaeology: prod config differs from staging.
// Idle-context accumulator — baseline holds large diffs in context.
{
  const cwd = "/work/projects/config-archaeology";
  const baseline = [
    bashStep("diff config/prod.yml config/staging.yml", 2000, 14000, 0),
    readStep("config/prod.yml", 5000, 4000, 5500),
    readStep("config/staging.yml", 5000, 4000, 6500),
    readStep("config/defaults.yml", 3500, 2800, 7500),
    readStep("config/schema.ts", 4500, 3600, 8500),
    grepStep("CONFIG_OVERRIDE", 2000, 1500, 9500),
    bashStep("git log -- config/", 1500, 9000, 10500),
    // re-read prod after looking at history
    readStep("config/prod.yml", 5000, 0, 11500),
    readStep("config/schema.ts", 4500, 0, 12000),
    bashStep("git log -- config/prod.yml", 1500, 8000, 12500),
  ];
  const optimized = [
    readStep(".sipcode/manifest.md", 1800, 1900, 0),
    bashStep("diff config/prod.yml config/staging.yml", 2000, 5500, 1900),
    readStep("config/prod.yml", 5000, 0, 3500),
    readStep("config/staging.yml", 5000, 0, 4500),
    readStep("config/schema.ts", 4500, 0, 5500),
    bashStep("git log --oneline -- config/", 1500, 2200, 6500),
  ];
  buildPair("BT015", cwd, {
    prompt: "prod config drifts from staging in subtle ways. enumerate every difference, explain which are intentional vs accidental, recommend reconciliation.",
    baseline,
    optimized,
    baselineFinalText: "Found 14 differences between prod and staging. Of those, 9 are intentional (region-specific endpoints, scale-out concurrency), 5 are accidental drift. Detailed reconciliation plan per key, with git-blame attribution for each accidental drift...",
    baselineFinalUsage: usage(2400, 5500, 24000, 0),
    optimizedFinalText: "14 differences: 9 intentional, 5 drift. Drift keys: log_level, retry_max, cache_ttl, queue_depth, sampling_rate. Recommend syncing the 5 to staging values.",
    optimizedFinalUsage: usage(700, 200, 8500, 0),
  });
}

// BT016 — type-inference: resolve a TS inference error across 4 files.
// High cache-creation overhead because TS types compound.
{
  const cwd = "/work/projects/ts-inference";
  const baseline = [
    bashStep("tsc --noEmit", 1500, 8500, 0),
    readStep("src/types.ts", 4500, 3600, 4500),
    readStep("src/api/handler.ts", 5500, 4400, 5500),
    readStep("src/lib/wrap.ts", 4500, 3600, 6500),
    readStep("src/lib/result.ts", 4000, 3200, 7500),
    // re-read types twice — TS inference is hard to hold in context
    readStep("src/types.ts", 4500, 0, 8500),
    readStep("src/lib/result.ts", 4000, 0, 9000),
    readStep("src/types.ts", 4500, 0, 9500),
    editStep("src/types.ts", 2500, 3500, 10000),
    bashStep("tsc --noEmit", 1500, 6500, 10500),
    editStep("src/lib/wrap.ts", 2500, 3000, 11000),
    bashStep("tsc --noEmit", 1500, 2000, 11500),
  ];
  const optimized = [
    readStep(".sipcode/manifest.md", 1800, 1900, 0),
    bashStep("tsc --noEmit", 1500, 3500, 1900),
    readStep("src/types.ts", 4500, 0, 3500),
    readStep("src/lib/result.ts", 4000, 0, 4500),
    readStep("src/lib/wrap.ts", 4500, 0, 5500),
    editStep("src/types.ts", 1500, 450, 6500),
    editStep("src/lib/wrap.ts", 1500, 400, 7000),
    bashStep("tsc --noEmit", 1500, 1200, 7500),
  ];
  buildPair("BT016", cwd, {
    prompt: "tsc complains about an inference loop between Result<T,E> and wrap(). fix the type signature so inference flows through both.",
    baseline,
    optimized,
    baselineFinalText: "Fixed by introducing a phantom-type witness on Result so wrap can narrow correctly. Detailed walkthrough of why the original generic constraint caused a loop and why the new shape breaks the cycle...",
    baselineFinalUsage: usage(2600, 5500, 26000, 0),
    optimizedFinalText: "added phantom-type witness on Result; wrap now infers cleanly. tsc passes.",
    optimizedFinalUsage: usage(700, 100, 9000, 0),
  });
}

// BT017 — rename-everything: mass rename a concept used in 18 files + tests + docs.
// Scale stress test — extends BT001 to twice the surface area.
{
  const cwd = "/work/projects/mass-rename";
  const files = [
    "src/core/Customer.ts", "src/core/CustomerRepo.ts", "src/core/CustomerService.ts",
    "src/api/customer-routes.ts", "src/api/customer-handler.ts",
    "src/db/customer-table.ts", "src/db/customer-queries.ts",
    "src/jobs/customer-sync.ts", "src/jobs/customer-billing.ts",
    "src/util/customer-format.ts", "src/util/customer-validate.ts",
    "src/types/customer.ts", "tests/customer.test.ts",
    "tests/customer-repo.test.ts", "tests/customer-service.test.ts",
    "docs/customer.md", "docs/customer-api.md", "README.md",
  ];
  const baseline = [grepStep("Customer", 8000, 3000, 0)];
  for (const f of files) baseline.push(readStep(f, 5000, 4000, 7500));
  // re-read 6 files after fanning out — agent forgets earlier files
  for (const f of files.slice(0, 6)) baseline.push(readStep(f, 5000, 0, 14000));
  for (const f of files) baseline.push(editStep(f, 2800, 5500, 16000));

  const optimized = [readStep(".sipcode/manifest.md", 1800, 1900, 0)];
  optimized.push(grepStep("Customer", 1800, 500, 1900));
  for (const f of files) optimized.push(readStep(f, 5000, 0, 4500));
  for (const f of files) optimized.push(editStep(f, 1500, 500, 6500));

  buildPair("BT017", cwd, {
    prompt: "rename Customer → Account everywhere: source, tests, docs. 18 files. preserve external API names.",
    baseline,
    optimized,
    baselineFinalText: "Renamed Customer → Account across 18 files. Full per-file changelog with reasoning for each substitution decision, including the 3 places where the external API name was preserved...",
    baselineFinalUsage: usage(3500, 9000, 40000, 0),
    optimizedFinalText: "renamed Customer → Account in 18 files. external API names preserved.",
    optimizedFinalUsage: usage(800, 90, 12000, 0),
  });
}

// BT018 — dead-code: identify and remove dead code in a tangled module.
// Full-tree scan worst case. Low-savings honest task — minimal writes.
{
  const cwd = "/work/projects/dead-code-hunt";
  const tangledFiles = [
    "src/legacy/parser.ts", "src/legacy/printer.ts", "src/legacy/walker.ts",
    "src/legacy/helpers.ts", "src/legacy/types.ts", "src/legacy/util.ts",
    "src/legacy/old-cache.ts", "src/legacy/old-store.ts",
    "src/current/api.ts", "src/current/main.ts",
  ];
  const baseline = [bashStep("ls src/legacy/", 800, 500, 0)];
  for (const f of tangledFiles) baseline.push(readStep(f, 5000, 4000, 4500));
  baseline.push(grepStep("import .* from.*legacy", 3000, 2500, 11000));
  // re-read parser + helpers — needs to chase usages
  baseline.push(readStep("src/legacy/parser.ts", 5000, 0, 12000));
  baseline.push(readStep("src/legacy/helpers.ts", 5000, 0, 12500));
  baseline.push(readStep("src/current/api.ts", 5000, 0, 13000));
  // small number of edits — mostly deletions
  baseline.push(editStep("src/legacy/old-cache.ts", 2000, 1500, 13500));
  baseline.push(editStep("src/legacy/old-store.ts", 2000, 1500, 14000));
  baseline.push(editStep("src/legacy/walker.ts", 2500, 2500, 14500));
  baseline.push(bashStep("npm test", 1500, 5000, 15000));

  const optimized = [readStep(".sipcode/manifest.md", 1800, 1900, 0)];
  for (const f of tangledFiles) optimized.push(readStep(f, 5000, 0, 4500));
  optimized.push(grepStep("import .* from.*legacy", 1500, 800, 8500));
  optimized.push(editStep("src/legacy/old-cache.ts", 1500, 500, 9500));
  optimized.push(editStep("src/legacy/old-store.ts", 1500, 500, 10000));
  optimized.push(editStep("src/legacy/walker.ts", 1800, 800, 10500));
  optimized.push(bashStep("npm test", 1500, 2500, 11000));

  buildPair("BT018", cwd, {
    prompt: "identify all dead code in src/legacy/ and remove it. preserve anything imported from src/current/.",
    baseline,
    optimized,
    baselineFinalText: "Removed 3 dead files and partial-dead code in walker.ts. Detailed accounting of every export checked, every import traced, and why each removal is safe...",
    baselineFinalUsage: usage(2400, 4500, 24000, 0),
    optimizedFinalText: "removed old-cache.ts, old-store.ts, dead branches in walker.ts. tests pass.",
    optimizedFinalUsage: usage(700, 110, 9500, 0),
  });
}

// BT019 — security-review: identify auth bypass risk across a request pipeline.
// Output-token heavy — every finding gets explained.
{
  const cwd = "/work/projects/auth-pipeline";
  const baseline = [
    grepStep("authenticate\\|authorize\\|jwt", 4000, 3500, 0),
    readStep("src/auth/middleware.ts", 5500, 4400, 5000),
    readStep("src/auth/jwt.ts", 5000, 4000, 6000),
    readStep("src/auth/session.ts", 4500, 3600, 7000),
    readStep("src/api/router.ts", 5500, 4400, 8000),
    readStep("src/api/handlers.ts", 6000, 4800, 9000),
    readStep("src/api/admin.ts", 4500, 3600, 10000),
    // re-read middleware to trace bypass path
    readStep("src/auth/middleware.ts", 5500, 0, 11000),
  ];
  // verbose findings doc
  baseline.push({
    tool: "Write",
    input: { file_path: "security-review.md", content: "<verbose>" },
    input_tokens: 4500,
    output_tokens: 28000,
    cache_read_input_tokens: 11500,
    cache_creation_input_tokens: 0,
    tool_result_text: "wrote.",
  });
  const optimized = [
    readStep(".sipcode/manifest.md", 1800, 1900, 0),
    grepStep("authenticate\\|authorize\\|jwt", 1500, 800, 1900),
    readStep("src/auth/middleware.ts", 5500, 0, 3500),
    readStep("src/auth/jwt.ts", 5000, 0, 4500),
    readStep("src/api/router.ts", 5500, 0, 5500),
    readStep("src/api/admin.ts", 4500, 0, 6500),
    {
      tool: "Write",
      input: { file_path: "security-review.md", content: "<diff>" },
      input_tokens: 2200,
      output_tokens: 7000,
      cache_read_input_tokens: 7500,
      cache_creation_input_tokens: 0,
      tool_result_text: "wrote.",
    },
  ];
  buildPair("BT019", cwd, {
    prompt: "audit the auth pipeline for bypass risks. identify every code path where a request could reach a privileged handler without a valid token.",
    baseline,
    optimized,
    baselineFinalText: "Identified 4 bypass risks. Detailed exploitation walk-through for each, ranked by CVSS, with recommended fixes...\n\nFinding 1: ... Finding 2: ... ".repeat(15),
    baselineFinalUsage: usage(3500, 10000, 28000, 0),
    optimizedFinalText: "4 findings written to security-review.md: 1 high (admin route mounts before auth mw), 2 medium (jwt clock-skew + missing aud check), 1 low (verbose error leaks).",
    optimizedFinalUsage: usage(800, 220, 9500, 0),
  });
}

// BT020 — dependency-update: upgrade a major dependency that breaks 7 places.
// Read + edit + retest cycle.
{
  const cwd = "/work/projects/dep-upgrade";
  const broken = [
    "src/server/index.ts", "src/server/middleware.ts", "src/server/error.ts",
    "src/util/http.ts", "src/util/log.ts", "tests/server.test.ts",
    "tests/http.test.ts",
  ];
  const baseline = [
    bashStep("npm install express@5", 1500, 7000, 0),
    bashStep("tsc --noEmit", 1500, 12000, 4500),
    grepStep("express", 3500, 2500, 5500),
  ];
  for (const f of broken) baseline.push(readStep(f, 5000, 4000, 7500));
  // re-read after first round of edits to verify
  baseline.push(readStep("src/server/index.ts", 5000, 0, 13500));
  baseline.push(readStep("src/server/middleware.ts", 5000, 0, 14000));
  baseline.push(bashStep("tsc --noEmit", 1500, 6500, 14500));
  for (const f of broken) baseline.push(editStep(f, 2500, 3500, 15000));
  baseline.push(bashStep("npm test", 1500, 8500, 16000));

  const optimized = [
    readStep(".sipcode/manifest.md", 1800, 1900, 0),
    bashStep("npm install express@5", 1500, 3500, 1900),
    bashStep("tsc --noEmit", 1500, 5000, 3500),
    grepStep("express", 1500, 600, 4500),
  ];
  for (const f of broken) optimized.push(readStep(f, 5000, 0, 5500));
  for (const f of broken) optimized.push(editStep(f, 1500, 400, 7500));
  optimized.push(bashStep("npm test", 1500, 2800, 9000));

  buildPair("BT020", cwd, {
    prompt: "upgrade express from v4 to v5. fix all 7 breaking-change sites. tests must stay green.",
    baseline,
    optimized,
    baselineFinalText: "Upgraded express 4 → 5. Fixed 7 breaking changes: async error handler signature, removed req.param, removed res.json default callback, query parser change, removed body-parser bundling, removed bound res.send chaining, sub-app mounting change. Detailed per-site walk-through...",
    baselineFinalUsage: usage(2800, 7000, 28000, 0),
    optimizedFinalText: "upgraded express to v5. 7 breaking-change sites fixed (async handlers, req.param, res.json cb, query parser, body-parser, res.send chain, sub-app mount). tests green.",
    optimizedFinalUsage: usage(800, 220, 10500, 0),
  });
}

console.log("corpus built at", CORPUS);
