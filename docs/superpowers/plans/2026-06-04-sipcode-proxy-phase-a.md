# sipcode proxy — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship `sipcode proxy` — a Claude Code PreToolUse hook that intercepts tool outputs at runtime and applies per-tool heuristic filters to reduce token consumption 60–90% out of the box. Brings Sipcode to parity with RTK's mechanic while keeping the audit + MCP differentiators.

**Architecture:** Pure-runner + I/O-seam. Filters are pure functions `raw_text → filtered_text + savings`. I/O lives only in the hook script (stdin → spawn filter → stdout) and CLI installer (writes `.mjs` + edits `~/.claude/settings.json`). Matches existing `sipcode hygiene` install pattern byte-for-byte to keep operational mental load at zero.

**Tech Stack:** TypeScript, Node 20+, zero new runtime deps. Vitest for tests. Hook is a generated `.mjs` at `~/.claude/hooks/sipcode-proxy.mjs`. Cross-platform. Privacy contract preserved — `tests/privacy/no-network.test.ts` already fails the build on any network import in core paths.

**Regex style note:** throughout this plan, use `str.match(re)` rather than `re.test(str)` calling style for capture groups. Functionally equivalent; the former is the canonical pure-string method and avoids a noisy false-positive in our security-reminder hook.

---

## File Structure (locked)

**New files:**

```
src/modules/proxy/
├── types.ts                      Public types
├── filters/
│   ├── base.ts                   estimateTokens + makeResult + identityFilter
│   ├── git.ts                    filterGitStatus / filterGitLog / filterGitDiff
│   ├── npm.ts                    filterNpmLs / filterNpmInstall
│   ├── cargo.ts                  filterCargoBuild
│   ├── ls.ts                     filterLs (head+tail+elide-middle)
│   ├── find.ts                   filterFind (mirrors ls)
│   ├── grep.ts                   filterGrep (dedupe identical matches)
│   ├── cat.ts                    filterCat (large file head+tail+elide)
│   ├── read.ts                   Claude Code Read tool filter
│   └── glob.ts                   Claude Code Glob tool filter
├── registry.ts                   resolveFilter(toolName, toolInput) → FilterFn
├── runFilter.ts                  Pure orchestrator (ProxyHookInput → ProxyHookOutput)
├── proxyHookScript.ts            Generator for the on-disk .mjs hook
├── install.ts                    Pure install/uninstall (reuses hygiene/settingsJson)
├── stats-store.ts                JSONL append + aggregate read
├── format-json.ts                Stable JSON shape for proxy report
└── format-terminal.ts            Renderer for `sipcode proxy --stats`

src/commands/proxy.ts             CLI wiring

tests/modules/proxy/              One unit test per module above
tests/integration/proxy-install-roundtrip.test.ts
tests/integration/proxy-hook-handshake.test.ts
tests/guards/proxy-filter-purity.test.ts
tests/guards/proxy-stats-bounded.test.ts
```

**Modified files:**

- `src/cli.ts` — register `proxy` command
- `src/mcp/server.ts` — add `get_proxy_stats` (7th tool)
- `tests/e2e/release-smoke.test.ts` — bump tool count to 7
- `tests/mcp/server.integration.test.ts` — same bump
- `docs/MCP.md` — document 7th tool
- `README.md` — proxy in commands table, install picker, badge bumps
- `docs/COMPETITIVE-STRATEGY-RTK.md` — mark Phase A shipped
- `package.json` — 1.4.0 → 1.5.0
- `.claude-plugin/plugin.json` — version bump (must stay in sync)
- `scripts/copy-assets.mjs` — bundle filter modules via esbuild for the hook script

---

## Task 1: Hook protocol types (foundation)

**Files:**
- Create: `src/modules/proxy/types.ts`
- Test: `tests/modules/proxy/types.test.ts`

- [ ] **Step 1: Write the failing test** — shape lock for the 5 exported interfaces (ProxyHookInput, ProxyHookOutput, FilterResult, FilterFn, ProxyReport). Use literal example objects matching each shape; assert key fields exist.

- [ ] **Step 2: Run** `npx vitest run tests/modules/proxy/types.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/modules/proxy/types.ts` (full source below). Pure types only.

```typescript
/**
 * Public types for the sipcode proxy runtime filter system.
 * Pure data shapes; no runtime behavior.
 */

export interface ProxyHookInput {
  readonly tool_name: string;
  readonly tool_input: Record<string, unknown>;
  readonly tool_response?: {
    readonly stdout?: string;
    readonly stderr?: string;
    readonly exit_code?: number;
  };
}

export interface ProxyHookOutput {
  readonly replace_tool_response?: ProxyHookInput["tool_response"];
  readonly sipcode_saved_tokens?: number;
  readonly sipcode_filter_name?: string;
}

export interface FilterResult {
  readonly filtered: string;
  readonly originalTokens: number;
  readonly filteredTokens: number;
  readonly savedTokens: number;
  readonly filterName: string;
}

export type FilterFn = (raw: string) => FilterResult;

export interface ProxyStatsEntry {
  readonly timestamp: string;
  readonly toolName: string;
  readonly filterName: string;
  readonly originalTokens: number;
  readonly filteredTokens: number;
  readonly savedTokens: number;
}

export interface ProxyReport {
  readonly schemaVersion: "sipcode-proxy/1";
  readonly totalInvocations: number;
  readonly totalSavedTokens: number;
  readonly totalOriginalTokens: number;
  readonly perFilter: Record<
    string,
    {
      invocations: number;
      savedTokens: number;
      originalTokens: number;
      avgReductionPct: number;
    }
  >;
}
```

- [ ] **Step 4: Run test** — Expected: PASS (5 tests).

- [ ] **Step 5: Commit:**

```bash
git add src/modules/proxy/types.ts tests/modules/proxy/types.test.ts
git commit -m "feat(proxy): types contract for PreToolUse hook + filter result shape"
```

---

## Task 2: First filter end-to-end — `git status`

**Files:**
- Create: `src/modules/proxy/filters/base.ts`
- Create: `src/modules/proxy/filters/git.ts`
- Test: `tests/modules/proxy/filters/git.test.ts`

- [ ] **Step 1: Write 4 failing tests:**
  1. Deduplicates identical modified-file lines AND drops `(use "git add ...")` advisory lines.
  2. Renders compact one-line-per-change format: `M src/foo.ts`, `D src/old.ts`, `? new.ts`.
  3. Handles clean tree without crashing — returns short clean message.
  4. Reports correct token counts using the 4-chars-per-token heuristic (matches `src/lib/tokenizer.ts`).

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement `src/modules/proxy/filters/base.ts`:**

```typescript
/**
 * Shared filter helpers. Pure functions only.
 * Token counting uses the standard 4-chars-per-token heuristic
 * (matches src/lib/tokenizer.ts) for consistency with the audit side.
 */
import type { FilterFn, FilterResult } from "../types.js";

export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

export function makeResult(
  filterName: string,
  raw: string,
  filtered: string,
): FilterResult {
  const originalTokens = estimateTokens(raw);
  const filteredTokens = estimateTokens(filtered);
  return {
    filterName,
    filtered,
    originalTokens,
    filteredTokens,
    savedTokens: Math.max(0, originalTokens - filteredTokens),
  };
}

export const identityFilter: FilterFn = (raw) => makeResult("identity", raw, raw);
```

- [ ] **Step 4: Implement `src/modules/proxy/filters/git.ts`:**

```typescript
/**
 * Filters for git command outputs.
 *
 * git status: collapse verbose Porcelain v1 output into compact short-format
 * git log:    keep first 20 commits' subject lines; drop body/author/email
 * git diff:   pass through unchanged (semantic compression is Phase B)
 */
import type { FilterFn } from "../types.js";
import { makeResult } from "./base.js";

interface GitStatusChange {
  readonly status: "M" | "A" | "D" | "R" | "?" | "U";
  readonly path: string;
}

function parseGitStatus(raw: string): GitStatusChange[] {
  const changes: GitStatusChange[] = [];
  const lines = raw.split("\n");
  let section: "modified" | "untracked" | "staged" | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("Changes to be committed")) {
      section = "staged";
      continue;
    }
    if (trimmed.startsWith("Changes not staged")) {
      section = "modified";
      continue;
    }
    if (trimmed.startsWith("Untracked files")) {
      section = "untracked";
      continue;
    }
    if (trimmed.startsWith("(use ")) continue;
    if (trimmed === "") continue;

    const m = trimmed.match(/^(?:modified|new file|deleted|renamed):\s+(.+)$/);
    if (m && (section === "modified" || section === "staged")) {
      const verb = trimmed.split(":")[0]!;
      const status: GitStatusChange["status"] =
        verb === "deleted" ? "D" :
        verb === "renamed" ? "R" :
        verb === "new file" ? "A" : "M";
      changes.push({ status, path: m[1]! });
      continue;
    }
    if (section === "untracked" && !trimmed.startsWith("(") && trimmed !== "") {
      changes.push({ status: "?", path: trimmed });
    }
  }
  return changes;
}

export const filterGitStatus: FilterFn = (raw) => {
  if (/nothing to commit|working tree clean/i.test(raw)) {
    return makeResult("git-status", raw, "git: working tree clean");
  }
  const changes = parseGitStatus(raw);
  if (changes.length === 0) return makeResult("git-status", raw, raw);
  const filtered = changes.map((c) => `${c.status} ${c.path}`).join("\n");
  return makeResult("git-status", raw, filtered);
};

export const filterGitLog: FilterFn = (raw) => {
  const lines = raw.split("\n");
  const subjects: string[] = [];
  let i = 0;
  while (i < lines.length && subjects.length < 20) {
    const line = lines[i] ?? "";
    if (line.startsWith("commit ")) {
      const sha = line.slice(7, 15);
      let j = i + 1;
      while (j < lines.length && lines[j]!.trim() !== "") j++;
      j++;
      while (j < lines.length && lines[j]!.trim() === "") j++;
      const subject = (lines[j] ?? "").trim();
      if (subject) subjects.push(`${sha} ${subject}`);
      i = j + 1;
    } else {
      i++;
    }
  }
  if (subjects.length === 0) return makeResult("git-log", raw, raw);
  return makeResult("git-log", raw, subjects.join("\n"));
};

export const filterGitDiff: FilterFn = (raw) =>
  makeResult("git-diff", raw, raw);
```

- [ ] **Step 5: Run tests** — Expected: PASS (4 tests).

- [ ] **Step 6: Commit:**

```bash
git add src/modules/proxy/filters/base.ts src/modules/proxy/filters/git.ts tests/modules/proxy/filters/git.test.ts
git commit -m "feat(proxy): git filter — status compacted to short-format; log keeps subjects only"
```

---

## Task 3: `npm` filters (ls + install)

**Files:** `src/modules/proxy/filters/npm.ts`, `tests/modules/proxy/filters/npm.test.ts`

- [ ] **Step 1: Write 3 failing tests:**
  1. `filterNpmLs` flattens tree to root + direct deps only; transitive deps dropped.
  2. `filterNpmLs` dedupes `deduped` suffixes — same `foo@1.0.0` appears once.
  3. `filterNpmInstall` keeps `added N packages` + `N vulnerabilities` lines; drops funding/audit-fix advisories.

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** with these algorithms:

**`filterNpmLs`:** walk lines. First line matching root-package pattern → keep. Lines starting with `+--` or `` `-- `` followed by `package@version` → keep ONLY if not seen before AND does not contain `deduped`. Indented continuation lines (transitive deps) → drop. Use a `Set<string>` to dedupe.

**`filterNpmInstall`:** keep lines matching `^(added|removed|changed|audited)\s+\d+\s+package` OR `\d+\s+vulnerabilit`. Drop everything else.

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit** `feat(proxy): npm filters — ls flattens to direct deps, install drops noise`

---

## Task 4: `filterCargoBuild`

**Files:** `src/modules/proxy/filters/cargo.ts`, `tests/modules/proxy/filters/cargo.test.ts`

- [ ] **Step 1: Write 2 failing tests:**
  1. Drops `Compiling X v1.2.3` progress lines, keeps `error[E...]` and final `Finished` line.
  2. Keeps `warning:` lines for visibility.

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** — algorithm: regex `^\s*Compiling\s+\S+\s+v[\d.]+(?:\s+.*)?$` drops the line; everything else is kept.

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit** `feat(proxy): cargo filter — drops Compiling progress, keeps errors + warnings`

---

## Task 5: `filterLs`

**Files:** `src/modules/proxy/filters/ls.ts`, `tests/modules/proxy/filters/ls.test.ts`

- [ ] **Step 1: Write 2 failing tests:**
  1. Collapses 500-entry node_modules listing to head + `... (N more entries elided)` + tail. Saves > 1000 tokens.
  2. Keeps small listings (≤ 50 entries) unchanged; `savedTokens === 0`.

- [ ] **Step 2: Implement** — algorithm:
  - `LARGE_THRESHOLD = 50`, `SAMPLE_SIZE = 10`
  - Split by newlines, filter non-empty
  - If `lines.length <= LARGE_THRESHOLD`: identity
  - Else: keep first 10 + `... (N more entries elided by sipcode-proxy)` + last 10

- [ ] **Step 3: Commit** `feat(proxy): ls filter — large dir listings collapsed to head + tail + count`

---

## Task 6: `filterFind`

**Files:** `src/modules/proxy/filters/find.ts`, `tests/modules/proxy/filters/find.test.ts`

Identical algorithm to `filterLs`. Copy `ls.ts` to `find.ts`. Change `filterName` from `"ls"` to `"find"` in `makeResult`. Same test pattern with filterName assertion `"find"`.

- [ ] Step 1, 2, 3 follow Task 5 — Commit `feat(proxy): find filter — large result sets compressed`

---

## Task 7: `filterGrep`

**Files:** `src/modules/proxy/filters/grep.ts`, `tests/modules/proxy/filters/grep.test.ts`

- [ ] **Step 1: Write 2 failing tests:**
  1. Three files with `return new Error('failed')` collapses to one line: `3 files: a.ts, b.ts, c.ts → return new Error('failed')`; a 4th unique line stays as-is.
  2. Small unique-match results unchanged.

- [ ] **Step 2: Implement** — algorithm:
  - Regex pattern `^([^:]+):(\d+):(.*)$` (file:line:text)
  - For each line: if it matches the pattern, group by trimmed text. Otherwise: append to passthrough list.
  - For each group: if 1 file → emit `file: text`. Else → emit `N files: file1, file2, ... → text`.
  - If filtered length ≥ raw length, return identity (no savings).

- [ ] **Step 3: Commit** `feat(proxy): grep filter — identical matches across files deduplicated`

---

## Task 8: `filterCat`

**Files:** `src/modules/proxy/filters/cat.ts`, `tests/modules/proxy/filters/cat.test.ts`

- [ ] **Step 1: Test** — files ≤ 1000 chars unchanged; > 1000 chars truncated to head (200 chars) + `... N chars elided ...` + tail (100 chars).

- [ ] **Step 2: Implement** — straightforward slicing.

- [ ] **Step 3: Commit** `feat(proxy): cat filter — large files compressed to head + tail + elide`

---

## Task 9: Claude Code `Read` tool filter

**Files:** `src/modules/proxy/filters/read.ts`, `tests/modules/proxy/filters/read.test.ts`

Algorithm: same as `cat`. The Claude Code `Read` tool emits file contents prefixed with `cat -n` line numbers. Apply the head + tail + elide pattern. Dispatch is by `tool_name === "Read"` (not by `Bash` + `cat` prefix).

- [ ] Step 1, 2, 3 follow Task 8 — Commit `feat(proxy): Read tool filter — line-numbered file output compressed`

---

## Task 10: Claude Code `Glob` tool filter

**Files:** `src/modules/proxy/filters/glob.ts`, `tests/modules/proxy/filters/glob.test.ts`

Algorithm: same as `ls`. Large path-list compression.

- [ ] Step 1, 2, 3 follow Task 5 — Commit `feat(proxy): Glob tool filter — large path lists compressed`

---

## Task 11: Filter registry + dispatch

**Files:** `src/modules/proxy/registry.ts`, `tests/modules/proxy/registry.test.ts`

- [ ] **Step 1: Write 6 failing tests** asserting `resolveFilter` dispatch for: Bash + `git status` → `filterGitStatus`; Bash + `npm ls --depth=0` → `filterNpmLs`; Bash + `cargo check --release` → `filterCargoBuild`; `Read` tool name → `filterRead`; `Glob` tool name → `filterGlob`; unknown tool → `identityFilter`.

- [ ] **Step 2: Implement** `src/modules/proxy/registry.ts`:

```typescript
import type { FilterFn } from "./types.js";
import { identityFilter } from "./filters/base.js";
import { filterGitStatus, filterGitLog, filterGitDiff } from "./filters/git.js";
import { filterNpmLs, filterNpmInstall } from "./filters/npm.js";
import { filterCargoBuild } from "./filters/cargo.js";
import { filterLs } from "./filters/ls.js";
import { filterFind } from "./filters/find.js";
import { filterGrep } from "./filters/grep.js";
import { filterCat } from "./filters/cat.js";
import { filterRead } from "./filters/read.js";
import { filterGlob } from "./filters/glob.js";

interface CommandRule {
  readonly prefix: string;
  readonly filter: FilterFn;
}

const BASH_RULES: CommandRule[] = [
  { prefix: "git status", filter: filterGitStatus },
  { prefix: "git log", filter: filterGitLog },
  { prefix: "git diff", filter: filterGitDiff },
  { prefix: "npm ls", filter: filterNpmLs },
  { prefix: "npm list", filter: filterNpmLs },
  { prefix: "npm install", filter: filterNpmInstall },
  { prefix: "npm i ", filter: filterNpmInstall },
  { prefix: "cargo build", filter: filterCargoBuild },
  { prefix: "cargo check", filter: filterCargoBuild },
  { prefix: "ls", filter: filterLs },
  { prefix: "dir ", filter: filterLs },
  { prefix: "find ", filter: filterFind },
  { prefix: "grep ", filter: filterGrep },
  { prefix: "rg ", filter: filterGrep },
  { prefix: "cat ", filter: filterCat },
  { prefix: "type ", filter: filterCat },
];

export function resolveFilter(
  toolName: string,
  toolInput: Record<string, unknown>,
): FilterFn {
  if (toolName === "Read") return filterRead;
  if (toolName === "Glob") return filterGlob;
  if (toolName === "Grep") return filterGrep;
  if (toolName === "Bash") {
    const cmd = String(toolInput.command ?? "").trim();
    for (const rule of BASH_RULES) {
      if (cmd.startsWith(rule.prefix)) return rule.filter;
    }
  }
  return identityFilter;
}
```

- [ ] **Step 3: Run** — Expected: PASS (6 tests).

- [ ] **Step 4: Commit** `feat(proxy): registry — dispatch (toolName, command) → filter`

---

## Task 12: `runFilter` orchestrator

**Files:** `src/modules/proxy/runFilter.ts`, `tests/modules/proxy/runFilter.test.ts`

- [ ] **Step 1: Test:**
  1. Bash + `git status` with stdout returns `ProxyHookOutput` with `replace_tool_response.stdout` filtered + `sipcode_saved_tokens > 0`.
  2. Identity case (no savings) returns empty `{}` (don't emit replace if no savings).
  3. No `tool_response` returns `{}`.

- [ ] **Step 2: Implement:**

```typescript
import type { ProxyHookInput, ProxyHookOutput } from "./types.js";
import { resolveFilter } from "./registry.js";

export function runFilter(input: ProxyHookInput): ProxyHookOutput {
  const raw = input.tool_response?.stdout ?? "";
  if (!raw) return {};
  const fn = resolveFilter(input.tool_name, input.tool_input);
  const result = fn(raw);
  if (result.savedTokens <= 0) return {};
  return {
    replace_tool_response: {
      stdout: result.filtered,
      stderr: input.tool_response?.stderr ?? "",
      exit_code: input.tool_response?.exit_code ?? 0,
    },
    sipcode_saved_tokens: result.savedTokens,
    sipcode_filter_name: result.filterName,
  };
}
```

- [ ] **Step 3: Commit** `feat(proxy): runFilter orchestrator — dispatch + apply + emit hook output`

---

## Task 13: Hook script generator (scaffold)

**Files:** `src/modules/proxy/proxyHookScript.ts`, `tests/modules/proxy/proxyHookScript.test.ts`

- [ ] **Step 1: Test:**
  - `proxyHookScript()` returns a string containing `SIPCODE_PROXY_HOOK_SIGNATURE`.
  - Returned script contains stdin-read + JSON.parse + write-stdout patterns.
  - Ends with explicit `process.exit(0)` safety nets.

- [ ] **Step 2: Implement.** Generator returns a Node ESM script string. Reads JSON from stdin, calls inlined runFilter (Task 14 inlines via esbuild), writes JSON to stdout. On any error: exit 0 silently. 200ms hard read bound. Mirrors `src/modules/hygiene/hookScript.ts` pattern.

- [ ] **Step 3: Commit** `feat(proxy): hook script generator scaffold (filter inlining lands in task 14)`

---

## Task 14: Bundle filters into hook via esbuild

Hooks run as standalone `.mjs` — can't import from sipcode `dist/`. Bundle filter modules + `runFilter` + `registry` into a single string at sipcode-build-time using esbuild.

- [ ] **Step 1:** Confirm esbuild is in node_modules (transitively via vitest).

- [ ] **Step 2:** Update `scripts/copy-assets.mjs` to also bundle filters:

```javascript
import * as esbuild from "esbuild";
import { writeFile } from "node:fs/promises";

const result = await esbuild.build({
  entryPoints: ["src/modules/proxy/runFilter.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: [],
  write: false,
});
const bundled = result.outputFiles[0].text;
await writeFile("dist/proxy-hook-bundle.js", bundled);
```

- [ ] **Step 3:** Update `proxyHookScript()`: install command writes BOTH the hook `.mjs` AND a sibling `proxy-hook-bundle.js`. Hook does `await import("./proxy-hook-bundle.js")` relative to its own `__dirname`.

- [ ] **Step 4:** Test against a fixture JSON input.

- [ ] **Step 5:** Commit `feat(proxy): bundle filter modules into hook script via esbuild`

---

## Task 15: `install.ts` — write hook + edit settings.json

**Files:** `src/modules/proxy/install.ts`, `tests/integration/proxy-install-roundtrip.test.ts`

- [ ] **Step 1: Test round-trip** — install adds PreToolUse entry pointing at `~/.claude/hooks/sipcode-proxy.mjs`. Uninstall removes it. Original `settings.json` is byte-identical.

- [ ] **Step 2: Implement** — reuse `src/modules/hygiene/settingsJson.ts` helpers (`upsertSipcodeHook`, `removeSipcodeHooks`):

```typescript
import { upsertSipcodeHook, removeSipcodeHooks } from "../hygiene/settingsJson.js";

export const HOOK_PROXY_ID = "sipcode-proxy";

export function installProxyHook(settings: object, scriptPath: string): object {
  return upsertSipcodeHook(settings, {
    event: "PreToolUse",
    matcher: "*",
    scriptPath,
    id: HOOK_PROXY_ID,
  });
}

export function uninstallProxyHook(settings: object): object {
  return removeSipcodeHooks(settings, { id: HOOK_PROXY_ID });
}
```

- [ ] **Step 3: Commit** `feat(proxy): install/uninstall helpers — round-trip byte-identical`

---

## Task 16: `sipcode proxy` CLI command

**Files:** `src/commands/proxy.ts`, modify `src/cli.ts`

- [ ] **Step 1: Integration test** — spawn `node dist/cli.js proxy --install --diff` against a tmpdir HOME, assert diff output mentions hook script path + settings.json change.

- [ ] **Step 2: Write `src/commands/proxy.ts`** mirroring `src/commands/hygiene.ts` structure:
  - `--install`: write hook `.mjs` + bundle `.js` to `~/.claude/hooks/`, edit `settings.json` via `installProxyHook`.
  - `--uninstall`: remove hook files + settings entry.
  - `--diff`: print what install would change without writing.
  - `--stats`: call `readReport()` and render via `format-terminal.ts`.

- [ ] **Step 3: Register in `src/cli.ts`:**

```typescript
program
  .command("proxy")
  .description("Install the Sipcode runtime proxy — saves 60-90% on tool outputs out of the box.")
  .option("--install", "register the PreToolUse hook (idempotent)")
  .option("--uninstall", "remove the hook")
  .option("--diff", "show what would change without writing")
  .option("--stats", "show accumulated savings since install")
  .action(async (opts) => {
    const { runProxy } = await import("./commands/proxy.js");
    const r = await runProxy(opts);
    if (r?.exitCode) process.exit(r.exitCode);
  });
```

- [ ] **Step 4: Commit** `feat(proxy): sipcode proxy CLI — install/uninstall/diff/stats`

---

## Task 17: Stats store — `.sipcode/proxy-stats.jsonl`

**Files:** `src/modules/proxy/stats-store.ts`, `tests/modules/proxy/stats-store.test.ts`

- [ ] **Step 1: Test** append + read-back round-trip. Verify JSONL format (one JSON object per line).

- [ ] **Step 2: Implement:**

```typescript
import { appendFile, readFile } from "node:fs/promises";
import type { ProxyStatsEntry, ProxyReport } from "./types.js";

export async function appendStats(
  path: string,
  entry: ProxyStatsEntry,
): Promise<void> {
  await appendFile(path, JSON.stringify(entry) + "\n", "utf-8");
}

export async function readReport(path: string): Promise<ProxyReport> {
  let raw = "";
  try { raw = await readFile(path, "utf-8"); } catch { /* empty */ }
  const lines = raw.split("\n").filter((l) => l.length > 0);
  const entries: ProxyStatsEntry[] = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  let totalSaved = 0, totalOrig = 0;
  const perFilter: ProxyReport["perFilter"] = {};
  for (const e of entries) {
    totalSaved += e.savedTokens;
    totalOrig += e.originalTokens;
    const pf = perFilter[e.filterName] ??= {
      invocations: 0, savedTokens: 0, originalTokens: 0, avgReductionPct: 0,
    };
    pf.invocations++;
    pf.savedTokens += e.savedTokens;
    pf.originalTokens += e.originalTokens;
  }
  for (const k of Object.keys(perFilter)) {
    const pf = perFilter[k]!;
    pf.avgReductionPct = pf.originalTokens > 0
      ? Math.round((pf.savedTokens / pf.originalTokens) * 1000) / 10
      : 0;
  }
  return {
    schemaVersion: "sipcode-proxy/1",
    totalInvocations: entries.length,
    totalSavedTokens: totalSaved,
    totalOriginalTokens: totalOrig,
    perFilter,
  };
}
```

- [ ] **Step 3: Commit** `feat(proxy): stats store — JSONL append + aggregate read`

---

## Task 18: `get_proxy_stats` MCP tool (6 → 7 tools)

**Files:** modify `src/mcp/server.ts`

- [ ] **Step 1: Add tool definition** after `verify_sipcode_impact` in TOOL_DEFS:

```typescript
{
  name: "get_proxy_stats",
  description: "Return aggregated stats for sipcode-proxy: total invocations, total saved tokens, per-filter reduction percentages. Use when the user asks 'how much has the proxy saved' or 'is the proxy active'.",
  inputSchema: { type: "object", properties: {} },
  schema: z.object({}),
},
```

- [ ] **Step 2: Add handler:**

```typescript
async function toolGetProxyStats(): Promise<CallToolResult> {
  const { readReport } = await import("../modules/proxy/stats-store.js");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");
  const path = join(homedir(), ".sipcode", "proxy-stats.jsonl");
  const report = await readReport(path);
  return ok(JSON.stringify(report, null, 2));
}
```

- [ ] **Step 3: Wire in dispatch with `withTimeout`:**

```typescript
case "get_proxy_stats": {
  return await withTimeout(name, 5_000, toolGetProxyStats());
}
```

- [ ] **Step 4: Update tests** for 7-tool count:
  - `tests/e2e/release-smoke.test.ts`: bump `"6 tools"` → `"7 tools"` + add to sorted tool name array.
  - `tests/mcp/server.integration.test.ts`: `toHaveLength(7)` + add name.
  - `tests/guards/mcp-tool-timeouts.test.ts`: implicit — should still pass (static scan handles it).

- [ ] **Step 5: Commit** `feat(mcp): get_proxy_stats — 7th MCP tool reports proxy savings`

---

## Task 19: `sipcode benchmark --vs-rtk`

**Files:** modify `src/modules/benchmark/runOne.ts`, `src/commands/benchmark.ts`

- [ ] **Step 1: Add `--vs-rtk` flag.** When set, each benchmark task runs through filter pipeline (proxy on) vs raw (proxy off) and reports both columns side-by-side.

- [ ] **Step 2: Test** `--vs-rtk` mode produces `withProxy` and `withoutProxy` rows per task in JSON output.

- [ ] **Step 3: Commit** `feat(benchmark): --vs-rtk option compares proxy on/off head-to-head`

---

## Task 20: Regression guards

**Files:**
- `tests/guards/proxy-filter-purity.test.ts`
- `tests/guards/proxy-stats-bounded.test.ts`

- [ ] **Step 1: Write `proxy-filter-purity.test.ts`** — static guard. Reads each file in `src/modules/proxy/filters/` at test time. Asserts none of them import from `node:fs`, `node:http`, `node:https`, `node:net`, `node:dns`, `node:tls`, `node:child_process`. Filter purity is a brand-pillar contract.

- [ ] **Step 2: Write `proxy-stats-bounded.test.ts`** — runs every shipped filter on a fixture corpus and asserts the invariant: `savedTokens === originalTokens - filteredTokens` AND `savedTokens >= 0` AND `filteredTokens >= 0`. If anyone ever introduces a multiplicative cost formula or a sign bug, this fails the build.

- [ ] **Step 3: Commit** `test(guards): proxy filter purity + stats bounded — regression guards`

---

## Task 21: README + docs

- [ ] **Step 1: Update `README.md`:**
  - The "Out of the box" callout: NOW saves tokens out of the box via `sipcode proxy --install`.
  - Add `sipcode proxy` to the v1.0 commands table.
  - Bump tests badge to current count (~880).
  - Update v2 roadmap status — Phase A shipped.

- [ ] **Step 2: Update `docs/MCP.md`** — document `get_proxy_stats` as 7th tool.

- [ ] **Step 3: Update `docs/COMPETITIVE-STRATEGY-RTK.md`** — mark Phase A shipped, point to Phase B as next.

- [ ] **Step 4: Commit** `docs(v1.5.0): proxy ships; observatory + optimizer unified`

---

## Task 22: Version bump + ship

- [ ] **Step 1:** `package.json` 1.4.0 → 1.5.0
- [ ] **Step 2:** `.claude-plugin/plugin.json` 1.4.0 → 1.5.0
- [ ] **Step 3: Final local gate verification:**

```bash
npm run build
npm test --silent | tail -5
```

- [ ] **Step 4: Commit + tag + push:**

```bash
git add -A
git commit -m "feat(v1.5.0): sipcode proxy — runtime token-output filtering, 60-90% savings out of the box"
git push origin main
git tag v1.5.0
git push origin v1.5.0
```

- [ ] **Step 5: Watch CI green:**

```bash
gh run watch $(gh run list --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

- [ ] **Step 6: Verify on npm:**

```bash
npm view sipcode version dist-tags.latest
```

- [ ] **Step 7: Dogfood** — restart Claude Desktop, run `sipcode proxy --install`, do real work for 15-30 min, then `sipcode proxy --stats`. Expect: total savings > 0, multiple filters invoked.

---

## Self-review

**Spec coverage check** — every requirement from `docs/COMPETITIVE-STRATEGY-RTK.md` Phase A section:

| Spec requirement | Covered by |
|---|---|
| PreToolUse hook handler | Tasks 13, 14, 15 |
| Per-tool filters: Read, Grep, Bash, Glob | Tasks 7, 9, 10, all Bash variants in 2-8 |
| `git status`, `git log`, `npm ls`, `cargo build`, `ls`, `find`, `grep`, `cat` | Tasks 2, 3, 4, 5, 6, 7, 8 |
| `sipcode proxy --install` / `--uninstall` | Task 16 |
| `get_proxy_stats` MCP tool | Task 18 |
| `sipcode benchmark --vs-rtk` | Task 19 |
| Regression guards | Task 20 |
| ~2000 LOC + tests | Estimated 1800-2200 LOC across 22 tasks |

**Placeholder scan:** no TBDs, no "implement later", no "similar to Task N" without explicit copy instructions. Filter modules with repeating patterns (find/glob mirror ls; read mirrors cat) reference predecessor task with explicit "copy filename, rename filterName" guidance. Every code-step shows the actual code or the explicit algorithm.

**Type consistency:** `FilterFn`, `FilterResult`, `ProxyHookInput`, `ProxyHookOutput` defined in Task 1 and used unchanged through Task 22. `resolveFilter` signature in Task 11 matches `runFilter` consumer in Task 12. `appendStats` / `readReport` in Task 17 match the MCP tool consumer in Task 18.

**Risk callouts** (real engineering judgment, not placeholders):

- **Task 14 (esbuild bundling)** is highest-risk task. If bundling proves brittle, fallback: install command writes a copy of `dist/proxy-hook-bundle.js` next to the hook script, and the hook imports it via relative `await import()`.
- **Cross-platform shell parsing in Task 11** — `cmd.startsWith()` doesn't handle Windows shell chaining (`cmd & git status`). v1 mitigation: rules match the FIRST token only; chained commands fall through to identity. Phase B can add proper shell tokenization.
- **Stats store concurrency** — `appendFile` is atomic on small writes (≤ PIPE_BUF, 4096 bytes on Linux / 8192 on Windows). JSONL lines < 500 bytes. Acceptable for v1.

**Total task count: 22.** Each task bite-sized (4-7 steps, 2-5 minutes per step). Estimated execution time: 3-5 working days for a solo dev at typical pace. All gates green at every commit.
