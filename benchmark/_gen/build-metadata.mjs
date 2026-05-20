/**
 * Author the per-task metadata (task.yml, prompt.md, expected.md) and a
 * minimal repo/ scaffold for each of the 10 tasks. Not shipped at runtime.
 *
 * Run after build-corpus.mjs to fill in everything around the transcript pair.
 *
 * Idempotent. Re-running overwrites files byte-identically.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.resolve(__dirname, "..", "corpus");

function writeText(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf-8");
}

function taskYml(meta) {
  return [
    `# ${meta.id} — locked task metadata. Stable ID; do not rename.`,
    `id: ${meta.id}`,
    `title: "${meta.title}"`,
    `category: ${meta.category}`,
    `difficulty: ${meta.difficulty}`,
    `model_recommended: ${meta.model_recommended}`,
    `estimated_cost_band: ${meta.estimated_cost_band}`,
    `notes: "${meta.notes}"`,
    ``,
  ].join("\n");
}

function repoPackageJson(name) {
  return JSON.stringify(
    {
      name,
      version: "0.0.0",
      private: true,
      type: "module",
      scripts: { test: "echo 'fixture — no tests'" },
    },
    null,
    2,
  ) + "\n";
}

const TASKS = [
  {
    id: "BT001",
    title: "rename a function and update all call sites in 12 files",
    category: "refactor",
    difficulty: "large",
    model_recommended: "claude-opus-4",
    estimated_cost_band: "high",
    notes: "high duplicate-read potential — agent re-reads files to confirm signatures.",
    prompt: "rename oldFunctionName to newFunctionName across the codebase. update all call sites.",
    expected: [
      "all 12 files import or reference newFunctionName (and not oldFunctionName).",
      "the exported declaration in src/utils.ts is renamed.",
      "tests still pass (the test file references newFunctionName).",
    ],
    repoName: "refactor-repo",
    files: [
      ["src/index.ts", "import { oldFunctionName } from './utils.js';\noldFunctionName(1);\noldFunctionName(2);\noldFunctionName(3);\n"],
      ["src/utils.ts", "export function oldFunctionName(n) { return n * 2; }\nexport function unrelated() { return 'ok'; }\n"],
      ["src/api/users.ts", "import { oldFunctionName } from '../utils.js';\nexport const handler = () => oldFunctionName(1);\n"],
      ["src/api/posts.ts", "import { oldFunctionName } from '../utils.js';\nexport const handler = () => oldFunctionName(2);\n"],
      ["src/api/comments.ts", "import { oldFunctionName } from '../utils.js';\nexport const handler = () => oldFunctionName(3);\n"],
      ["src/db/client.ts", "// db client; doesn't use oldFunctionName directly.\nexport const client = {};\n"],
      ["src/db/migrations.ts", "import { oldFunctionName } from '../utils.js';\nexport function run() { return oldFunctionName(5); }\n"],
      ["src/middleware/auth.ts", "import { oldFunctionName } from '../utils.js';\nexport const auth = () => oldFunctionName(6);\n"],
      ["src/middleware/logging.ts", "import { oldFunctionName } from '../utils.js';\nexport const log = () => oldFunctionName(7);\n"],
      ["src/lib/format.ts", "import { oldFunctionName } from '../utils.js';\nexport const fmt = () => oldFunctionName(8);\n"],
      ["src/lib/dates.ts", "import { oldFunctionName } from '../utils.js';\nexport const today = () => oldFunctionName(9);\n"],
      ["tests/users.test.ts", "import { handler } from '../src/api/users.js';\nconsole.log(handler());\n"],
    ],
  },
  {
    id: "BT002",
    title: "fix a null-pointer bug in a 3-file payment pipeline",
    category: "debug",
    difficulty: "small",
    model_recommended: "claude-opus-4",
    estimated_cost_band: "medium",
    notes: "small but realistic debug session — guarded null + re-run targeted test.",
    prompt: "fix the null-pointer in the payment-pipeline that crashes on guest checkout.",
    expected: [
      "src/payment/process.ts handles `customer == null` without throwing.",
      "the existing test suite continues to pass; no behavior change for signed-in users.",
    ],
    repoName: "payment-pipeline",
    files: [
      ["src/payment/process.ts", "export function processPayment(order, customer) {\n  // BUG: crashes when customer is null (guest checkout).\n  return customer.id + '-' + order.id;\n}\n"],
      ["src/payment/validate.ts", "export function validate(order) {\n  return !!order && !!order.amount;\n}\n"],
      ["src/payment/types.ts", "export type Order = { id: string; amount: number };\nexport type Customer = { id: string } | null;\n"],
    ],
  },
  {
    id: "BT003",
    title: "add a new REST endpoint to an Express app",
    category: "feature",
    difficulty: "medium",
    model_recommended: "claude-opus-4",
    estimated_cost_band: "medium",
    notes: "typical exploration-heavy feature: scan routes, pick a pattern, write a new one.",
    prompt: "add a /api/products GET endpoint following the same pattern as /api/posts.",
    expected: [
      "src/routes/products.ts exists and exports a router with GET /.",
      "src/routes/index.ts mounts the products router at /api/products.",
      "no other routes changed; tests pass.",
    ],
    repoName: "express-api",
    files: [
      ["src/server.ts", "import express from 'express';\nimport { router } from './routes/index.js';\nconst app = express();\napp.use(router);\napp.listen(3000);\n"],
      ["src/routes/index.ts", "import { Router } from 'express';\nimport { users } from './users.js';\nimport { posts } from './posts.js';\nexport const router = Router();\nrouter.use('/api/users', users);\nrouter.use('/api/posts', posts);\n"],
      ["src/routes/users.ts", "import { Router } from 'express';\nexport const users = Router();\nusers.get('/', (_req, res) => res.json([]));\n"],
      ["src/routes/posts.ts", "import { Router } from 'express';\nexport const posts = Router();\nposts.get('/', (_req, res) => res.json([]));\n"],
      ["src/middleware/auth.ts", "export const auth = (_req, _res, next) => next();\n"],
      ["src/middleware/validate.ts", "export const validate = (_req, _res, next) => next();\n"],
      ["src/db/client.ts", "export const client = {};\n"],
    ],
  },
  {
    id: "BT004",
    title: "write Vitest tests for a pure utility module",
    category: "test",
    difficulty: "small",
    model_recommended: "claude-sonnet-4",
    estimated_cost_band: "low",
    notes: "small canonical test-writing task; mostly output tokens.",
    prompt: "write vitest tests for the strings module — cover camelCase, snakeCase, slugify.",
    expected: [
      "tests/strings.test.ts exists with cases for camelCase, snakeCase, slugify.",
      "tests pass; no source files changed.",
    ],
    repoName: "utils-lib",
    files: [
      ["src/strings.ts", "export const camelCase = (s) => s.replace(/[-_](.)/g, (_, c) => c.toUpperCase());\nexport const snakeCase = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()).replace(/^_/, '');\nexport const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');\n"],
      ["src/dates.ts", "export const today = () => new Date().toISOString().slice(0, 10);\n"],
      ["tests/dates.test.ts", "import { describe, it, expect } from 'vitest';\nimport { today } from '../src/dates.js';\ndescribe('today', () => { it('returns yyyy-mm-dd', () => expect(today()).toMatch(/^\\d{4}-\\d{2}-\\d{2}$/)); });\n"],
      ["vitest.config.ts", "import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { environment: 'node' } });\n"],
    ],
  },
  {
    id: "BT005",
    title: "code review a 200-line PR diff",
    category: "review",
    difficulty: "medium",
    model_recommended: "claude-opus-4",
    estimated_cost_band: "high",
    notes: "output-token heavy — verbose review comments dominate.",
    prompt: "review this PR. flag correctness, perf, style, and test coverage gaps.",
    expected: [
      "review-notes.md exists with structured sections per finding.",
      "no source files modified.",
    ],
    repoName: "under-review-repo",
    files: [
      ["src/changed/feature.ts", "// PR-introduced feature.\nexport function feature(items) {\n  // O(n^2) — flagged in review.\n  const out = [];\n  for (const a of items) for (const b of items) if (a.id === b.id) out.push(a);\n  return out;\n}\n"],
      ["src/changed/feature.test.ts", "import { describe, it, expect } from 'vitest';\nimport { feature } from './feature.js';\ndescribe('feature', () => { it('returns matches', () => expect(feature([{ id: 1 }])).toHaveLength(1)); });\n"],
      ["src/related/helpers.ts", "export const noop = () => {};\n"],
    ],
  },
  {
    id: "BT006",
    title: "update README and add a CONTRIBUTING.md",
    category: "docs",
    difficulty: "small",
    model_recommended: "claude-sonnet-4",
    estimated_cost_band: "low",
    notes: "low-savings baseline — docs work has little duplicate-read or output-bloat headroom.",
    prompt: "update README, add a CONTRIBUTING.md with PR + commit guidelines.",
    expected: [
      "README.md updated with a Contributing section.",
      "CONTRIBUTING.md created with PR + commit guidelines.",
    ],
    repoName: "docs-update",
    files: [
      ["README.md", "# Docs Update\n\nA small example project.\n"],
      ["package.json", `{ "name": "docs-update", "version": "0.0.0" }\n`],
      ["CHANGELOG.md", "# Changelog\n\n- 0.0.0 — initial.\n"],
    ],
  },
  {
    id: "BT007",
    title: "migrate a config schema across 8 files",
    category: "migration",
    difficulty: "large",
    model_recommended: "claude-opus-4",
    estimated_cost_band: "high",
    notes: "dup-read worst case; agent re-reads schema + loader repeatedly to keep mappings consistent.",
    prompt: "migrate the LegacyConfig schema to ConfigV2 across all 8 files. Preserve defaults.",
    expected: [
      "every reference to LegacyConfig is replaced with ConfigV2.",
      "default values are preserved.",
      "tests pass.",
    ],
    repoName: "config-migration",
    files: [
      ["src/config/loader.ts", "import { LegacyConfig } from './schema.js';\nexport function load(): LegacyConfig { return { v: 1, name: 'x' }; }\n"],
      ["src/config/schema.ts", "export type LegacyConfig = { v: 1; name: string };\n"],
      ["src/config/defaults.ts", "import { LegacyConfig } from './schema.js';\nexport const defaults: LegacyConfig = { v: 1, name: 'default' };\n"],
      ["src/config/validate.ts", "import { LegacyConfig } from './schema.js';\nexport function validate(c: LegacyConfig) { return c.v === 1; }\n"],
      ["src/server/config.ts", "import { LegacyConfig } from '../config/schema.js';\nexport let current: LegacyConfig | undefined;\n"],
      ["src/server/init.ts", "import { load } from '../config/loader.js';\nexport function init() { return load(); }\n"],
      ["tests/config.test.ts", "import { load } from '../src/config/loader.js';\nconsole.log(load());\n"],
      ["docs/config.md", "# Config\n\nUses LegacyConfig.\n"],
    ],
  },
  {
    id: "BT008",
    title: "explain the codebase to a new contributor",
    category: "onboarding",
    difficulty: "medium",
    model_recommended: "claude-opus-4",
    estimated_cost_band: "high",
    notes: "manifest savings showcase — answer is mostly synthesizable from a manifest.",
    prompt: "you're a new contributor. explain this codebase: structure, key modules, how to run, how to test.",
    expected: [
      "a written guide names src/lib, src/api, src/db, src/cli and what each does.",
      "explains how to run and how to test.",
      "no source files changed.",
    ],
    repoName: "onboard-target",
    files: [
      ["README.md", "# Onboard Target\n\nSee docs/intro.md.\n"],
      ["package.json", `{ "name": "onboard-target", "version": "0.0.0", "scripts": { "start": "node src/index.js", "test": "vitest" } }\n`],
      ["src/index.ts", "import { start } from './api/server.js';\nstart();\n"],
      ["src/lib/core.ts", "export const VERSION = '0.0.0';\n"],
      ["src/lib/util.ts", "export const noop = () => {};\n"],
      ["src/api/server.ts", "import { routes } from './routes.js';\nexport function start() { routes(); }\n"],
      ["src/api/routes.ts", "export function routes() { /* register */ }\n"],
      ["src/db/conn.ts", "export const conn = {};\n"],
      ["src/db/models.ts", "export type Model = { id: string };\n"],
      ["src/cli/main.ts", "export function main() {}\n"],
      ["src/cli/parse.ts", "export function parse(argv: string[]) { return argv.slice(2); }\n"],
      ["docs/architecture.md", "# Architecture\n\nlib, api, db, cli.\n"],
      ["docs/intro.md", "# Intro\n\nSee README.\n"],
    ],
  },
  {
    id: "BT009",
    title: "add caching to a hot path",
    category: "optimization",
    difficulty: "medium",
    model_recommended: "claude-opus-4",
    estimated_cost_band: "medium",
    notes: "reads-then-edits pattern; agent benchmarks before and after.",
    prompt: "add an LRU cache to the hot path. show before/after benchmark numbers.",
    expected: [
      "src/hot/handler.ts wraps the hot lookup in an LRU cache.",
      "benchmark numbers (before/after) reported.",
    ],
    repoName: "hot-path-opt",
    files: [
      ["src/hot/handler.ts", "export function handle(key) {\n  // expensive lookup with no caching.\n  return slowLookup(key);\n}\nfunction slowLookup(_k) { return 1; }\n"],
      ["src/hot/store.ts", "export const store = new Map();\n"],
      ["src/cache/lru.ts", "export class LRU { constructor(public n = 100) {} get(_k){} set(_k,_v){} }\n"],
      ["tests/hot.test.ts", "import { handle } from '../src/hot/handler.js';\nconsole.log(handle('x'));\n"],
    ],
  },
  {
    id: "BT010",
    title: "fix a bug that requires touching 4 unrelated files",
    category: "bugfix-cross-file",
    difficulty: "large",
    model_recommended: "claude-opus-4",
    estimated_cost_band: "high",
    notes: "hardest case for read-once-cache — files are unrelated, so manifest doesn't help much.",
    prompt: "fix the missing logSpanId propagation that breaks correlation across 4 unrelated files.",
    expected: [
      "all four files thread logSpanId through their respective entry points.",
      "tests pass.",
    ],
    repoName: "cross-cutting-bug",
    files: [
      ["src/tracing/span.ts", "export function makeSpan() { return { id: 's1' }; }\n"],
      ["src/middleware/log.ts", "import { makeSpan } from '../tracing/span.js';\nexport function log() { const s = makeSpan(); console.log(s.id); }\n"],
      ["src/api/handler.ts", "export function handler() { /* missing logSpanId */ }\n"],
      ["src/jobs/runner.ts", "export function runner() { /* missing logSpanId */ }\n"],
    ],
  },
];

for (const t of TASKS) {
  const dir = path.join(CORPUS, t.id);
  writeText(
    path.join(dir, "task.yml"),
    taskYml({
      id: t.id,
      title: t.title,
      category: t.category,
      difficulty: t.difficulty,
      model_recommended: t.model_recommended,
      estimated_cost_band: t.estimated_cost_band,
      notes: t.notes,
    }),
  );
  writeText(path.join(dir, "prompt.md"), `# ${t.id} — prompt\n\n${t.prompt}\n`);
  writeText(
    path.join(dir, "expected.md"),
    `# ${t.id} — expected result\n\n${t.expected.map((e) => `- ${e}`).join("\n")}\n`,
  );
  writeText(path.join(dir, "repo", "package.json"), repoPackageJson(t.repoName));
  for (const [rel, body] of t.files) {
    writeText(path.join(dir, "repo", rel), body);
  }
}

console.log("metadata written for", TASKS.length, "tasks.");
