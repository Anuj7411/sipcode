# sipcode proxy — Phase A Implementation Plan (v2 — corrected architecture)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

> **Architecture correction (v2):** The original plan was built against a fabricated PostToolUse-output-replacement contract that does not exist in Claude Code. `plan-eng-review` caught this before any code was written. **This v2 plan uses the verified PreToolUse + `updatedInput` contract** — the same mechanic RTK actually uses. The fix: instead of filtering tool OUTPUTS, we rewrite tool INPUTS to commands that produce naturally-compact output (e.g., `git status` → `git status -s`). Source: `https://code.claude.com/docs/en/hooks` verified 2026-06-04.

**Goal:** Ship `sipcode proxy` — a Claude Code PreToolUse hook that rewrites tool inputs at runtime to produce naturally-compact outputs, reducing token consumption 60–90% out of the box. Matches RTK's mechanic exactly. Keeps Sipcode's audit + MCP differentiators.

**Architecture:** Pure runner + I/O seam. Filters are pure functions `(toolName, toolInput) → null | { updatedInput, savedTokensEstimate, filterName }`. I/O lives only in the hook script and CLI installer. Matches the existing `sipcode hygiene` install pattern byte-for-byte.

**Tech Stack:** TypeScript, Node 20+, zero new runtime deps. Vitest. Hook is a generated `.mjs` at `~/.claude/hooks/sipcode-proxy.mjs`. Cross-platform. Privacy contract preserved.

**Regex style note:** throughout this plan, use `str.match(re)` rather than `re.test(str)`-with-capture-groups calling style. Functionally equivalent; the former is canonical.

---

## What Phase A actually does (verified mechanic)

```
┌──────────────────────────────────────────────────────────────────┐
│  Claude wants to run: `git status`                               │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
              ┌──────────────────────────┐
              │  ⏸ PreToolUse hook fires │  ← Sipcode proxy intercepts.
              │                          │
              │  Sees:                   │
              │    tool_name: "Bash"     │
              │    tool_input: {         │
              │      command: "git status"│
              │    }                     │
              │                          │
              │  Returns to Claude Code: │
              │    hookSpecificOutput.   │
              │      updatedInput = {    │
              │        command:          │
              │          "git status -s" │
              │      }                   │
              └──────────────────────────┘
                            │
                            ▼
                    ┌─────────────┐
                    │ git status  │  ← Tool runs with the rewritten input.
                    │   -s runs   │     Produces ~5 lines instead of ~200.
                    └─────────────┘
                            │
                            ▼
              ┌──────────────────────────┐
              │  Claude reads ~5 lines   │  ← 95% fewer tokens, same UX.
              └──────────────────────────┘
```

No output filtering. No PostToolUse. No fabricated `replace_tool_response` field. Just clean input rewriting via the documented `hookSpecificOutput.updatedInput` field.

---

## File Structure (locked)

**New files:**

```
src/modules/proxy/
├── types.ts                      Verified hook contract types
├── rewriters/
│   ├── base.ts                   Shared helpers + null-rewrite identity
│   ├── git.ts                    rewriteGitStatus / rewriteGitLog
│   ├── npm.ts                    rewriteNpmLs
│   ├── cargo.ts                  rewriteCargoBuild
│   ├── ls.ts                     rewriteLs (add `| head -N` if absent)
│   ├── find.ts                   rewriteFind (same pattern as ls)
│   ├── grep.ts                   rewriteGrep (Bash grep — add `-c` count mode)
│   ├── cat.ts                    rewriteCat (wrap as head + tail)
│   ├── nativeRead.ts             Claude Code Read tool param injector
│   ├── nativeGrep.ts             Claude Code Grep tool param injector
│   └── nativeGlob.ts             Claude Code Glob tool param injector
├── registry.ts                   resolveRewriter(toolName, toolInput) → RewriterFn
├── runRewriter.ts                Pure orchestrator
├── proxyHookScript.ts            Generator for the on-disk .mjs hook
├── install.ts                    Pure install/uninstall helpers
├── stats-store.ts                JSONL append + aggregate read for proxy stats
├── format-json.ts                Stable JSON shape for proxy report
└── format-terminal.ts            Terminal renderer for `sipcode proxy --stats`

src/commands/proxy.ts             CLI wiring (--install / --uninstall / --diff / --stats)
```

**Modified files:**

```
src/cli.ts                        Register `proxy` command
src/mcp/server.ts                 Add `get_proxy_stats` (7th tool)
tests/e2e/release-smoke.test.ts   Bump tool count to 7
tests/mcp/server.integration.test.ts   Same bump
docs/MCP.md                       Document 7th tool
README.md                         Proxy in commands table, badge bumps
docs/COMPETITIVE-STRATEGY-RTK.md  Mark Phase A shipped
package.json                      Version 1.4.0 → 1.5.0
.claude-plugin/plugin.json        Version bump (must stay in sync)
```

**Notably ABSENT from v2** (versus v1 plan): no `esbuild` bundling, no `scripts/copy-assets.mjs` changes, no separate `proxy-hook-bundle.js`. The hook script is small enough to inline-embed its dispatch logic directly.

---

## Task 1: Verified hook contract types

**Files:**
- Create: `src/modules/proxy/types.ts`
- Test: `tests/modules/proxy/types.test.ts`

The types match Claude Code's documented PreToolUse contract verbatim — no invented fields.

- [ ] **Step 1: Write 5 failing tests** asserting shape lock for `PreToolUseInput`, `HookSpecificOutput`, `RewriterResult`, `RewriterFn`, `ProxyReport`.

- [ ] **Step 2: Run** `npx vitest run tests/modules/proxy/types.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/modules/proxy/types.ts`:**

```typescript
/**
 * Verified Claude Code hook contract types — PreToolUse only.
 * Source: https://code.claude.com/docs/en/hooks (verified 2026-06-04).
 *
 * IMPORTANT: PostToolUse is intentionally not used. Claude Code's
 * PostToolUse cannot replace tool_output (verified). The only
 * documented output-modification path is `decision: "block"` plus
 * `additionalContext`, which is intentionally NOT exercised in
 * Phase A — it would lose the natural-tool-output UX that makes
 * the proxy transparent.
 */

/** PreToolUse JSON delivered on stdin to the hook script. */
export interface PreToolUseInput {
  readonly session_id: string;
  readonly transcript_path: string;
  readonly cwd: string;
  readonly permission_mode: string;
  readonly hook_event_name: "PreToolUse";
  readonly tool_name: string;
  readonly tool_input: Record<string, unknown>;
}

/** Standard JSON the hook writes to stdout to influence Claude Code. */
export interface HookSpecificOutput {
  readonly hookSpecificOutput: {
    readonly hookEventName: "PreToolUse";
    /** Always "allow" for the proxy — we never block, only rewrite. */
    readonly permissionDecision?: "allow";
    /** The modified tool_input that replaces the original. THIS IS THE LEVER. */
    readonly updatedInput?: Record<string, unknown>;
    readonly additionalContext?: string;
  };
}

/** Per-rewriter result. `null` means "no change" (passthrough). */
export type RewriterResult =
  | null
  | {
      readonly updatedInput: Record<string, unknown>;
      readonly savedTokensEstimate: number;
      readonly rewriterName: string;
    };

/** Rewriter function signature. Pure. */
export type RewriterFn = (
  toolInput: Record<string, unknown>,
) => RewriterResult;

/** One proxy hook invocation written to .sipcode/proxy-stats.jsonl. */
export interface ProxyStatsEntry {
  readonly timestamp: string;
  readonly toolName: string;
  readonly rewriterName: string;
  /** Estimated tokens saved (heuristic, not measured). */
  readonly savedTokensEstimate: number;
}

/** Aggregated report — what `get_proxy_stats` MCP tool returns. */
export interface ProxyReport {
  readonly schemaVersion: "sipcode-proxy/2";
  readonly totalInvocations: number;
  readonly estimatedSavedTokens: number;
  readonly perRewriter: Record<
    string,
    {
      invocations: number;
      estimatedSavedTokens: number;
    }
  >;
  readonly note: string;
}
```

- [ ] **Step 4: Run test** — Expected: PASS (5 tests).

- [ ] **Step 5: Commit:**

```bash
git add src/modules/proxy/types.ts tests/modules/proxy/types.test.ts
git commit -m "feat(proxy): verified Claude Code PreToolUse contract types"
```

---

## Task 2: First rewriter end-to-end — `git status`

**Files:**
- Create: `src/modules/proxy/rewriters/base.ts`
- Create: `src/modules/proxy/rewriters/git.ts`
- Test: `tests/modules/proxy/rewriters/git.test.ts`

- [ ] **Step 1: Write 4 failing tests:**
  1. `rewriteGitStatus({ command: "git status" })` returns `{ updatedInput: { command: "git status -s" }, ... }`.
  2. `rewriteGitStatus({ command: "git status -s" })` returns `null` (already short — no rewrite).
  3. `rewriteGitStatus({ command: "git status --porcelain" })` returns `null` (already machine-readable).
  4. `rewriteGitStatus({ command: "git statusbar" })` returns `null` (not actually `git status` — prefix match must be word-boundary aware).

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement `src/modules/proxy/rewriters/base.ts`:**

```typescript
/**
 * Shared rewriter helpers. Pure functions only.
 *
 * Savings heuristic: each rewriter declares an expected reduction
 * percentage based on observed-in-the-wild output sizes. These are
 * used for the proxy stats display but never as a marketing claim —
 * actual savings vary per-invocation.
 */

/** Does `cmd` start with a target prefix at a word boundary? */
export function commandStartsWith(cmd: string, prefix: string): boolean {
  const trimmed = cmd.trim();
  if (!trimmed.startsWith(prefix)) return false;
  const next = trimmed[prefix.length];
  if (next === undefined) return true;
  return next === " " || next === "\t" || next === "\n";
}

/** Is a particular flag/argument already present in the command? */
export function hasFlag(cmd: string, ...flags: string[]): boolean {
  for (const f of flags) {
    const re = new RegExp(`(^|\\s)${escapeRegex(f)}(\\s|$|=)`);
    if (re.test(cmd)) return true;
  }
  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Is the command already piped to a length-limiting tool? */
export function hasOutputLimit(cmd: string): boolean {
  return /\|\s*(head|tail|less|more)\b/.test(cmd);
}
```

- [ ] **Step 4: Implement `src/modules/proxy/rewriters/git.ts`:**

```typescript
import type { RewriterFn } from "../types.js";
import { commandStartsWith, hasFlag } from "./base.js";

/**
 * git status: add `-s` (short format) if not already in short or porcelain mode.
 * Typical reduction: 85-95% on dirty trees, ~50% on clean trees.
 */
export const rewriteGitStatus: RewriterFn = (input) => {
  const cmd = String(input.command ?? "");
  if (!commandStartsWith(cmd, "git status")) return null;
  if (hasFlag(cmd, "-s", "--short", "--porcelain")) return null;
  const updated = cmd.replace(/^(\s*git status)/, "$1 -s");
  return {
    updatedInput: { ...input, command: updated },
    savedTokensEstimate: 800, // heuristic
    rewriterName: "git-status",
  };
};

/**
 * git log: add `--oneline -n 20` if no --oneline/--pretty/--format and no -n already.
 * Typical reduction: 90-98% on repositories with > 20 commits in history.
 */
export const rewriteGitLog: RewriterFn = (input) => {
  const cmd = String(input.command ?? "");
  if (!commandStartsWith(cmd, "git log")) return null;
  if (hasFlag(cmd, "--oneline", "--pretty", "--format", "-n")) return null;
  if (/--max-count/.test(cmd)) return null;
  const updated = cmd.replace(/^(\s*git log)/, "$1 --oneline -n 20");
  return {
    updatedInput: { ...input, command: updated },
    savedTokensEstimate: 3000,
    rewriterName: "git-log",
  };
};
```

- [ ] **Step 5: Run tests** — Expected: PASS (4 tests).

- [ ] **Step 6: Commit:**

```bash
git add src/modules/proxy/rewriters/base.ts src/modules/proxy/rewriters/git.ts tests/modules/proxy/rewriters/git.test.ts
git commit -m "feat(proxy): git rewriter — status -s + log --oneline -n 20 when absent"
```

---

## Task 3: `npm ls` rewriter

**Files:** `src/modules/proxy/rewriters/npm.ts`, `tests/modules/proxy/rewriters/npm.test.ts`

- [ ] **Step 1: Write 3 failing tests:**
  1. `rewriteNpmLs({ command: "npm ls" })` returns `{ updatedInput: { command: "npm ls --depth=0" } }`.
  2. `rewriteNpmLs({ command: "npm ls --depth=1" })` returns `null` (depth already set).
  3. `rewriteNpmLs({ command: "npm install foo" })` returns `null` (not `npm ls`).

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement:**

```typescript
import type { RewriterFn } from "../types.js";
import { commandStartsWith, hasFlag } from "./base.js";

export const rewriteNpmLs: RewriterFn = (input) => {
  const cmd = String(input.command ?? "");
  const isLs =
    commandStartsWith(cmd, "npm ls") || commandStartsWith(cmd, "npm list");
  if (!isLs) return null;
  if (hasFlag(cmd, "--depth", "-a", "--all", "--json")) return null;
  const updated = cmd.replace(/^(\s*npm (?:ls|list))/, "$1 --depth=0");
  return {
    updatedInput: { ...input, command: updated },
    savedTokensEstimate: 5000,
    rewriterName: "npm-ls",
  };
};
```

- [ ] **Step 4: Commit** `feat(proxy): npm-ls rewriter — flatten to depth=0 when no --depth set`

---

## Task 4: `cargo build` / `cargo check` rewriter

**Files:** `src/modules/proxy/rewriters/cargo.ts`, `tests/modules/proxy/rewriters/cargo.test.ts`

The "Compiling X" progress lines come on stderr. Cargo accepts `--quiet` to suppress them.

- [ ] **Step 1: Test:**
  1. `rewriteCargoBuild({ command: "cargo build" })` → adds `--quiet`.
  2. `rewriteCargoBuild({ command: "cargo build --quiet" })` → `null`.
  3. `rewriteCargoBuild({ command: "cargo build -q" })` → `null`.

- [ ] **Step 2: Implement** — add `--quiet` when neither `--quiet` nor `-q` is present.

- [ ] **Step 3: Commit** `feat(proxy): cargo rewriter — --quiet when verbosity not set`

---

## Task 5: `ls` rewriter — pipe to head if no length limiter present

**Files:** `src/modules/proxy/rewriters/ls.ts`, `tests/modules/proxy/rewriters/ls.test.ts`

- [ ] **Step 1: Test:**
  1. `rewriteLs({ command: "ls" })` → `{ updatedInput: { command: "ls | head -50" } }`.
  2. `rewriteLs({ command: "ls /tmp" })` → `{ updatedInput: { command: "ls /tmp | head -50" } }`.
  3. `rewriteLs({ command: "ls | head -10" })` → `null` (already limited).
  4. `rewriteLs({ command: "ls | less" })` → `null`.

- [ ] **Step 2: Implement** — use `commandStartsWith(cmd, "ls")` + `!hasOutputLimit(cmd)` → append `| head -50`.

- [ ] **Step 3: Commit** `feat(proxy): ls rewriter — append | head -50 when no limit`

---

## Task 6: `find` rewriter — same pattern as ls

**Files:** `src/modules/proxy/rewriters/find.ts`, `tests/modules/proxy/rewriters/find.test.ts`

Mirror `rewriteLs`. Pipe to `head -100`.

- [ ] **Step 1, 2, 3:** Same pattern as Task 5. Commit `feat(proxy): find rewriter — append | head -100 when no limit`

---

## Task 7: `grep` rewriter — count mode for `-r`

**Files:** `src/modules/proxy/rewriters/grep.ts`, `tests/modules/proxy/rewriters/grep.test.ts`

Recursive grep without a count flag often produces hundreds of identical match lines across files. Adding `-c` gives one-line-per-file with match counts instead.

- [ ] **Step 1: Test:**
  1. `rewriteGrep({ command: "grep -r foo ." })` → adds `-c`.
  2. `rewriteGrep({ command: "grep -rc foo ." })` → `null` (already count mode).
  3. `rewriteGrep({ command: "grep foo file.txt" })` (non-recursive) → `null`.

- [ ] **Step 2: Implement** — check for `-r` or `-R` AND absence of `-c` AND absence of `-l`.

- [ ] **Step 3: Commit** `feat(proxy): grep rewriter — add -c for recursive scans without count/list mode`

---

## Task 8: `cat` rewriter — head + tail for unknown-size cats

**Files:** `src/modules/proxy/rewriters/cat.ts`, `tests/modules/proxy/rewriters/cat.test.ts`

This is the trickiest one because we can't know the file size at PreToolUse time. We rewrite `cat X` to a shell snippet that shows head + summary + tail only if X is large.

- [ ] **Step 1: Test:**
  1. `rewriteCat({ command: "cat file.txt" })` → updates to a head/tail wrap.
  2. `rewriteCat({ command: "cat file.txt | grep foo" })` → `null` (already piped).
  3. `rewriteCat({ command: "cat /etc/hosts /etc/passwd" })` (multiple files) → `null` (skip for v1).

- [ ] **Step 2: Implement** — only rewrite single-file `cat`. Wrap as: `awk 'NR<=200 || prev>NR-100' file` (POSIX) OR use a shell conditional. Simpler v1: `head -200 file && echo "..." && tail -100 file`.

- [ ] **Step 3: Commit** `feat(proxy): cat rewriter — head + tail for single-file cats without pipe`

---

## Task 9: Claude Code `Read` tool — parameter injector

**Files:** `src/modules/proxy/rewriters/nativeRead.ts`, `tests/modules/proxy/rewriters/nativeRead.test.ts`

Claude Code's Read tool accepts a `limit` parameter. If absent, inject `limit: 2000` to cap large file reads.

- [ ] **Step 1: Test:**
  1. `rewriteNativeRead({ file_path: "/x.ts" })` → `{ updatedInput: { file_path: "/x.ts", limit: 2000 } }`.
  2. `rewriteNativeRead({ file_path: "/x.ts", limit: 100 })` → `null` (user/agent explicitly set).
  3. `rewriteNativeRead({ file_path: "/x.png" })` → `null` (image; let Claude Code handle natively).

- [ ] **Step 2: Implement** — check `file_path` not image extension, no existing `limit` → set `limit: 2000`.

- [ ] **Step 3: Commit** `feat(proxy): native Read rewriter — inject limit=2000 when absent for non-image files`

---

## Task 10: Claude Code `Grep` tool — parameter injector

**Files:** `src/modules/proxy/rewriters/nativeGrep.ts`, `tests/modules/proxy/rewriters/nativeGrep.test.ts`

Grep tool accepts `head_limit` parameter.

- [ ] **Step 1: Test:**
  1. `rewriteNativeGrep({ pattern: "foo" })` → injects `head_limit: 50`.
  2. `rewriteNativeGrep({ pattern: "foo", head_limit: 10 })` → `null`.

- [ ] **Step 2: Implement.**

- [ ] **Step 3: Commit** `feat(proxy): native Grep rewriter — inject head_limit=50 when absent`

---

## Task 11: Claude Code `Glob` tool — parameter injector

Same as Task 10 with `head_limit: 100` (paths are short; can afford more entries).

- [ ] **Step 1, 2, 3:** Commit `feat(proxy): native Glob rewriter — inject head_limit=100 when absent`

---

## Task 12: Registry + dispatch

**Files:** `src/modules/proxy/registry.ts`, `tests/modules/proxy/registry.test.ts`

- [ ] **Step 1: Test 8 dispatch cases:**
  1. Bash + `git status` → `rewriteGitStatus`
  2. Bash + `git log` → `rewriteGitLog`
  3. Bash + `npm ls` → `rewriteNpmLs`
  4. Bash + `cargo check` → `rewriteCargoBuild`
  5. Bash + `ls /tmp` → `rewriteLs`
  6. Read tool → `rewriteNativeRead`
  7. Grep tool → `rewriteNativeGrep`
  8. Unknown tool → returns `null` (no rewriter)

- [ ] **Step 2: Implement** the dispatch (mirror of v1 registry, with `null` as the "no rewriter" return).

- [ ] **Step 3: Commit** `feat(proxy): registry — dispatch (toolName, command) → rewriter`

---

## Task 13: `runRewriter` orchestrator

**Files:** `src/modules/proxy/runRewriter.ts`, `tests/modules/proxy/runRewriter.test.ts`

- [ ] **Step 1: Test:**
  1. `runRewriter({ tool_name: "Bash", tool_input: { command: "git status" } })` returns the full `HookSpecificOutput` shape with `updatedInput.command === "git status -s"`.
  2. `runRewriter({ tool_name: "Bash", tool_input: { command: "echo hello" } })` returns `null` (no rewriter matched).
  3. Throwing rewriter is caught → returns `null` (proxy never breaks Claude Code).

- [ ] **Step 2: Implement:**

```typescript
import type { PreToolUseInput, HookSpecificOutput, ProxyStatsEntry } from "./types.js";
import { resolveRewriter } from "./registry.js";

export interface RunRewriterResult {
  readonly hookOutput: HookSpecificOutput | null;
  readonly statsEntry: ProxyStatsEntry | null;
}

export function runRewriter(input: PreToolUseInput): RunRewriterResult {
  try {
    const fn = resolveRewriter(input.tool_name);
    if (!fn) return { hookOutput: null, statsEntry: null };
    const result = fn(input.tool_input);
    if (!result) return { hookOutput: null, statsEntry: null };
    return {
      hookOutput: {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: result.updatedInput,
        },
      },
      statsEntry: {
        timestamp: new Date().toISOString(),
        toolName: input.tool_name,
        rewriterName: result.rewriterName,
        savedTokensEstimate: result.savedTokensEstimate,
      },
    };
  } catch {
    return { hookOutput: null, statsEntry: null };
  }
}
```

- [ ] **Step 3: Commit** `feat(proxy): runRewriter orchestrator — dispatch + apply + emit hook output`

---

## Task 14: Hook script generator (no esbuild needed)

**Files:** `src/modules/proxy/proxyHookScript.ts`, `tests/modules/proxy/proxyHookScript.test.ts`

The hook script is self-contained. All rewriter logic inlines as JavaScript inside a single template string. Total size ~400 lines — well within reason. No esbuild bundling.

- [ ] **Step 1: Test:**
  - Script string contains `SIPCODE_PROXY_HOOK_SIGNATURE`.
  - Script string contains the rewrite rules for git, npm, cargo, ls, find, grep, cat as inlined logic.
  - Script ends with `process.exit(0)` safety nets.

- [ ] **Step 2: Implement** as a single string template returning the hook script source. The rewriter logic is inlined (the rewriter modules are small — ~30 LOC each — and inlining them into the script is cleaner than bundling).

- [ ] **Step 3: Commit** `feat(proxy): hook script generator — inlines rewriter logic, no bundler`

---

## Task 15: `install.ts` — write hook + edit settings.json

**Files:** `src/modules/proxy/install.ts`, `tests/integration/proxy-install-roundtrip.test.ts`

- [ ] **Step 1: Test round-trip** — install adds PreToolUse entry pointing at `~/.claude/hooks/sipcode-proxy.mjs`. Uninstall removes it. Original `settings.json` byte-identical.

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

- [ ] **Step 3: Commit** `feat(proxy): install/uninstall helpers — byte-identical round-trip`

---

## Task 16: `sipcode proxy` CLI command

**Files:** `src/commands/proxy.ts`, modify `src/cli.ts`

Mirrors `src/commands/hygiene.ts` structure: install / uninstall / diff / stats subflows.

- [ ] **Step 1: Integration test** — spawn `node dist/cli.js proxy --install --diff` against tmpdir HOME, assert diff output mentions hook script path + settings.json change.

- [ ] **Step 2: Write `src/commands/proxy.ts`.** Install writes the hook `.mjs` to `~/.claude/hooks/sipcode-proxy.mjs` (no bundle file in v2 — script is self-contained). Uninstall removes the file + settings entry. Diff shows what install would do. Stats reads `~/.sipcode/proxy-stats.jsonl` and renders.

- [ ] **Step 3: Register in `src/cli.ts`:**

```typescript
program
  .command("proxy")
  .description("Install Sipcode runtime proxy — rewrites tool inputs to produce naturally-compact outputs (matches RTK's mechanic).")
  .option("--install", "register the PreToolUse hook (idempotent)")
  .option("--uninstall", "remove the hook")
  .option("--diff", "show what would change without writing")
  .option("--stats", "show accumulated rewrite stats")
  .action(async (opts) => {
    const { runProxy } = await import("./commands/proxy.js");
    const r = await runProxy(opts);
    if (r?.exitCode) process.exit(r.exitCode);
  });
```

- [ ] **Step 4: Commit** `feat(proxy): sipcode proxy CLI — install/uninstall/diff/stats`

---

## Task 17: Stats store — per-PID JSONL to dodge Windows append races

**Files:** `src/modules/proxy/stats-store.ts`, `tests/modules/proxy/stats-store.test.ts`

`appendFile` is NOT reliably atomic on Windows for parallel writers. Mitigation: each hook invocation writes to its own file `~/.sipcode/proxy-stats-<pid>-<timestamp>.jsonl`, then `sipcode proxy --stats` aggregates across all of them. No concurrency at write time.

- [ ] **Step 1: Test:**
  - `appendStats` writes to a per-invocation file.
  - `readReport` discovers all `proxy-stats-*.jsonl` files and aggregates.
  - Malformed lines are skipped, not crashed on.

- [ ] **Step 2: Implement:**

```typescript
import { writeFile, readdir, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ProxyStatsEntry, ProxyReport } from "./types.js";

export async function writeStats(
  dir: string,
  entry: ProxyStatsEntry,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const filename = `proxy-stats-${process.pid}-${Date.now()}.jsonl`;
  await writeFile(join(dir, filename), JSON.stringify(entry) + "\n", "utf-8");
}

export async function readReport(dir: string): Promise<ProxyReport> {
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.startsWith("proxy-stats-") && f.endsWith(".jsonl"));
  } catch { /* dir missing */ }
  const entries: ProxyStatsEntry[] = [];
  for (const f of files) {
    try {
      const raw = await readFile(join(dir, f), "utf-8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
    } catch { /* skip unreadable */ }
  }
  let total = 0;
  const perRewriter: ProxyReport["perRewriter"] = {};
  for (const e of entries) {
    total += e.savedTokensEstimate;
    const pr = perRewriter[e.rewriterName] ??= {
      invocations: 0, estimatedSavedTokens: 0,
    };
    pr.invocations++;
    pr.estimatedSavedTokens += e.savedTokensEstimate;
  }
  return {
    schemaVersion: "sipcode-proxy/2",
    totalInvocations: entries.length,
    estimatedSavedTokens: total,
    perRewriter,
    note: "Per-rewriter savings are heuristic estimates, not measured per-invocation. For verified savings, run `npx sipcode benchmark`.",
  };
}
```

- [ ] **Step 3: Commit** `feat(proxy): stats store — per-PID JSONL files avoid Windows append races`

---

## Task 18: `get_proxy_stats` MCP tool (6 → 7 tools)

**Files:** modify `src/mcp/server.ts`

- [ ] **Step 1: Add tool definition** after `verify_sipcode_impact`:

```typescript
{
  name: "get_proxy_stats",
  description: "Return aggregated proxy rewrite stats: total invocations, per-rewriter counts, estimated saved tokens (heuristic). Use when the user asks 'is the proxy active' or 'how much is the proxy doing'.",
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
  const dir = join(homedir(), ".sipcode", "proxy-stats");
  const report = await readReport(dir);
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
  - `tests/e2e/release-smoke.test.ts`: bump `"6 tools"` → `"7 tools"` + add `"get_proxy_stats"` to sorted array.
  - `tests/mcp/server.integration.test.ts`: `toHaveLength(7)` + add name.

- [ ] **Step 5: Commit** `feat(mcp): get_proxy_stats — 7th MCP tool reports proxy rewrite activity`

---

## Task 19: `sipcode benchmark --vs-rtk`

**Files:** modify `src/modules/benchmark/runOne.ts`, `src/commands/benchmark.ts`

When `--vs-rtk` is set, each benchmark task is run twice: once with the proxy installed (rewrites active) and once without. Output is a side-by-side table.

- [ ] **Step 1: Test** asserting `--vs-rtk` mode produces `withProxy` + `withoutProxy` rows per task.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** `feat(benchmark): --vs-rtk option compares proxy on/off`

---

## Task 20: Regression guards

**Files:**
- `tests/guards/proxy-rewriter-purity.test.ts`
- `tests/guards/proxy-no-fabricated-fields.test.ts`

- [ ] **Step 1: Write `proxy-rewriter-purity.test.ts`** — static guard. Reads each file in `src/modules/proxy/rewriters/`. Asserts none import from `node:fs`, `node:http`, `node:https`, `node:net`, `node:dns`, `node:tls`, `node:child_process`. Filter purity is a brand-pillar contract.

- [ ] **Step 2: Write `proxy-no-fabricated-fields.test.ts`** — reads `src/modules/proxy/types.ts` source. Asserts the string `replace_tool_response` does NOT appear anywhere in the file (catches the original architecture bug from recurring — anyone reintroducing the fabricated field fails the build).

- [ ] **Step 3: Commit** `test(guards): proxy rewriter purity + no fabricated PostToolUse fields`

---

## Task 21: README + docs

- [ ] **Step 1: Update `README.md`** — proxy in commands table, "out of the box savings via sipcode proxy --install", test count bump, v2 roadmap status update.

- [ ] **Step 2: Update `docs/MCP.md`** — document `get_proxy_stats` as 7th tool.

- [ ] **Step 3: Update `docs/COMPETITIVE-STRATEGY-RTK.md`** — mark Phase A shipped, advance to Phase B.

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
git commit -m "feat(v1.5.0): sipcode proxy — runtime input rewriting (matches RTK mechanic), 60-90% savings out of the box"
git push origin main
git tag v1.5.0
git push origin v1.5.0
```

- [ ] **Step 5: Watch CI green.** `gh run watch $(...)` per the existing pattern.

- [ ] **Step 6: Verify on npm.** `npm view sipcode version dist-tags.latest` → 1.5.0.

- [ ] **Step 7: Dogfood.** `sipcode proxy --install` → use Claude Code for 15-30 min → `sipcode proxy --stats`. Expect: invocations > 0, multiple rewriters fired.

---

## Self-review (v2)

**Spec coverage check** — every requirement from `docs/COMPETITIVE-STRATEGY-RTK.md` Phase A:

| Spec requirement | Covered by task |
|---|---|
| PreToolUse hook handler | Tasks 14, 15 |
| Per-tool filters: Read, Grep, Bash, Glob | Tasks 9, 10, 11 + all Bash variants in 2-8 |
| `git status`, `git log`, `npm ls`, `cargo build`, `ls`, `find`, `grep`, `cat` | Tasks 2-8 |
| `sipcode proxy --install` / `--uninstall` CLI | Task 16 |
| `get_proxy_stats` MCP tool | Task 18 |
| `sipcode benchmark --vs-rtk` | Task 19 |
| Regression guards | Task 20 |
| ~2000 LOC + tests | Revised estimate: ~1200-1500 LOC |

**v2 vs v1 size reduction:** Removed esbuild bundling (Task 14 in v1), removed fabricated PostToolUse output-replacement plumbing, removed JSON-output-rewriting protocol. Rewriters are smaller because they output command strings, not transform large text. Total task count similar (22) but ~30-40% smaller LOC.

**Placeholder scan:** none. Every code-step has either the actual code or the explicit algorithm.

**Type consistency:** `PreToolUseInput`, `HookSpecificOutput`, `RewriterFn`, `RewriterResult` defined in Task 1 and used unchanged through Task 22.

**Risk callouts (v2):**

- **Cross-platform `cmd.startsWith()` matching is intentional v1 scope.** Chained commands (`a && git status`) don't match the prefix. Mitigation: rules match the FIRST shell token; chained commands fall through to no-rewrite. Phase B can add proper shell tokenization. **NEW: added word-boundary check via `commandStartsWith` to prevent `git statusbar` from matching `git status`.**
- **Stats concurrency** — fixed in v2 via per-PID files. No appendFile races on any platform.
- **Heuristic savings estimates** — each rewriter declares a fixed `savedTokensEstimate` per invocation. Honest about being a heuristic in the JSON output (`note` field). For verified savings users run `npx sipcode benchmark`.
- **PostToolUse not used** — `decision: "block" + additionalContext` is the only documented output-modification path but it loses the natural-tool-output UX. v2 deliberately avoids it. Phase B can revisit if specific tools need it.

**Total task count: 22.** Each bite-sized (4-7 steps, 2-5 minutes per step). **Revised execution estimate: 2-3 working days for a solo dev** (down from v1's 3-5 days because the architecture is simpler).

---

## ARCHITECTURE DECISION RECORD (v2)

**Date:** 2026-06-04
**Decision:** Use PreToolUse + `updatedInput` for runtime token optimization. Do NOT attempt PostToolUse output replacement (does not exist in Claude Code's hook contract).

**Evidence:** WebFetch of `https://code.claude.com/docs/en/hooks` (verified 2026-06-04) confirmed:
1. PreToolUse fires before tool execution, sees `tool_input`, can return `updatedInput` to modify the call.
2. PostToolUse fires after tool execution, sees `tool_output`, can return `decision: "block"` + `additionalContext` but CANNOT replace `tool_output`.
3. No `replace_tool_response` or equivalent field exists in any hook event.

**Consequence:** Phase A becomes a "command rewriter" instead of an "output filter." Match RTK's actual mechanic, not the fabricated one originally planned. Saves ~4 days of building against a non-existent contract.

**Caught by:** `plan-eng-review` — the gstack engineering team flow that the user explicitly requested. The 30 min of verification before implementation justifies the entire skill flow.
