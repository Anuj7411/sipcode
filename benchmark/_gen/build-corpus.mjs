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

console.log("corpus built at", CORPUS);
