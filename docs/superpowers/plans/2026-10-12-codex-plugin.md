# Codex Plugin + `sipcode regress` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v1.7.2: a new `sipcode regress` command (did Claude Code or Codex get worse after an update, from the user's own logs) and a skills-only "Sipcode" Codex plugin whose four skills answer spend, limits, why-expensive and regression questions by running the published `sipcode` CLI.

**Architecture:** `regress` is built like `limits`: pure units (catalog, rows, five Claude Code checks, one Codex check, report, formatters) tested alone, one disk module (`load.ts`) that feeds them from the shared `loadSessions` (request merge, cross-file dedupe, usage cache) and the limits readings/periods, and a thin command. Four small shared changes give the checks what they need: per-request tags from the Claude Code parser, Codex `cli_version` on discovered sessions, the plan on each limit period, and Claude Code discovery that counts unreadable folders. The plugin is static files (`plugins/sipcode/`, `.agents/plugins/marketplace.json`) checked by a validation test that also runs every command the skills name against the real CLI help.

**Tech Stack:** TypeScript 5.5 (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Node >= 20, Commander 12, Vitest 2, tsx 4 (validation test only). I/O behind the `FileSystem` / `ProcessEnv` / `Clock` seams (`InMemoryFs`, `FakeProcessEnv`, `FakeClock` in tests).

**Spec:** `docs/superpowers/specs/2026-10-12-codex-plugin-design.md`. **Branch:** `codex-plugin`. Ships as **v1.7.2** (patch bump).

---

## Decisions this plan makes

Everything here is pinned by a test, and was run end to end in a throwaway copy of the repo (git archive + its own `npm ci`) while writing this plan: the full suite passed, `regress` gave zero findings on the maintainer's real logs (27,671 interactive Claude Code requests, the same count as the prototype), and the independent check in Task 12 matched every regress number on a frozen copy of those logs.

1. **No MCP tool for `regress`.** MCP tools must finish within 10 s; a cold `regress` reads every Claude Code transcript in full (31 s on 4.8 GB). The tool count stays 16; no count assertion changes.
2. **Codex check on the limits module, not per-file deltas.** Account-wide periods (`buildPeriods`), each rise shared by the requests since the previous rise (`attribute`). Rises with no local request (other devices) and requests after a period's last rise are left out. Every window is compared (the prototype read `primary` only); the group key adds `limitId`.
3. **Codex peers: same plan, limit and window, any model** (the prototype's rule), plus a note when no peer ran the same model. Every Codex finding carries the plan-change / other-devices caveat.
4. **Version of a Codex request = `cli_version` on line 1 of its file**, pre-release suffix dropped (Sipcode's existing rule that later `session_meta` lines are fork copies; 0 of the maintainer's 15 rollouts have a second one).
5. **5-minute cache write = cache write − 1-hour write when the nested split was logged** (new `cacheSplitLogged` flag), else 0. No change to the dedupe index's five usage fields.
6. **Sessions are counted per file**; example lines use the first 8 characters of the file's session id.
7. **"Nothing read" (exit 2)** = no interactive Claude Code request and no Codex request read from the agents asked for. **"Not enough data to compare versions yet"** (exit 0, `comparable: false`) when data was read but no check had versions to compare and nothing fired. Neither is ever "No regressions detected".
8. **`--agent`** (`auto`/both, `claude-code`, `codex`; `cursor` = E009), **`--min-n`** validated 1..1000 (E010). No folder flags (env vars as everywhere).
9. **Usage cache keeps the new turn fields** (it stores every turn field except tool calls); `CACHE_SCHEMA` goes to `sipcode-usage-cache/3` as the file's own comment requires. `regress` uses the cache like `today`/`forecast`.
10. **Claude Code discovery counts what it cannot read** (`listClaudeSessions`); `claudeCodeAgent.discoverSessions` returns the full `SessionDiscovery`, so period commands print the existing unreadable-folder note for Claude Code too.
11. **Plugin layout:** root `plugin.json` (portable, `extensions["com.openai"].interface`) plus a `.codex-plugin/plugin.json` overlay for older Codex builds, kept identical by a test. Plugin version = npm version.

---

## Conventions for every task

- Files in this working tree have CRLF line endings. Edit existing files with the Edit tool (it matches text, not line endings). New files may use LF.
- Run one test file with `npx vitest run <path>`; the typecheck with `npm run lint`. Run anything longer than a minute (`npx vitest run`, `npm run test:e2e`, `verify-counts`, copying logs) with `run_in_background` and wait for it.
- Never print message text, paths or commands from real `~/.claude` or `~/.codex` logs: numbers only.
- Copy rules for every user-facing string: no em dashes or en dashes as dashes, no hype, no roadmap promises, never "stops hallucinations", never "nerfed" (except inside a "never say" rule), a limit cut is always "possible".
- Commit after each task: `git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`. Do not push, do not tag.
- Shell commands are Git Bash. For Tasks 14 and 15 set `SCRATCH="$(cygpath -m "<session scratchpad directory>")"` (never a folder inside the repo). Never create a git worktree with a junction or symlinked `node_modules`.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/modules/transcript/parse.ts` | modify | `AssistantTurn` gains `version`, `entrypoint`, `sidechain`, `afterToolResult`, `cacheSplitLogged` (Claude Code) |
| `src/modules/agents/usageSessions.ts` | modify | `CACHE_SCHEMA` → `sipcode-usage-cache/3` |
| `src/modules/transcript/discover.ts` | modify | `listClaudeSessions` (counts unreadable folders/files); `listAllSessions` wraps it; `SessionMeta.cliVersion` |
| `src/modules/agents/claude-code/adapter.ts` | modify | `discoverSessions` returns `SessionDiscovery` with the counts |
| `src/modules/agents/codex/discover.ts` | modify | copy line 1's `cli_version` into `SessionMeta.cliVersion` |
| `src/modules/limits/periods.ts` | modify | `LimitPeriod.planType` (newest reading's plan) |
| `src/modules/regress/catalog.ts` | create | `KNOWN` (R1 to R5), `vcmp`, `inRange`, `releaseOf`, `matchKnown`, `knownWindowsCovered`, `CheckId` |
| `src/modules/regress/helpers.ts` | create | `pct`, `fmtN`, `isoTime`, `upperMedian` |
| `src/modules/regress/types.ts` | create | `Finding` |
| `src/modules/regress/rows.ts` | create | `ClaudeRow` + `claudeRows`, `isAutomated`; `CodexRequest` + `codexRequests` (loadSessions `analyze`) |
| `src/modules/regress/claude.ts` | create | `detectClaude` (five checks, tables, coverage, comparable), `coverageOf`, `DEFAULT_MIN_N` |
| `src/modules/regress/codex.ts` | create | `burnTable`, `detectCodex` |
| `src/modules/regress/report.ts` | create | `buildRegressReport`, `RegressAccess`, `RegressReport` |
| `src/modules/regress/bug-report.ts` | create | `formatBugReport` |
| `src/modules/regress/format-terminal.ts` | create | `formatRegressTerminal` |
| `src/modules/regress/format-json.ts` | create | `formatRegressJson` |
| `src/modules/regress/load.ts` | create | `loadClaudeInput`, `loadCodexInput`, `accessOf` (the only disk access of the module) |
| `src/commands/regress.ts` | create | `runRegress(opts, deps)`: flags, wiring, exit codes |
| `src/lib/messages.ts` | modify | `regressCursor`, `regressBadMinN`, `regressUnreadable`, `regressNothingToAnalyse`, `regressNoFindings`, `regressNotEnoughData`, `regressSignalNotProof` |
| `src/cli.ts` | modify | register `regress` |
| `tests/modules/transcript/parse-regress-fields.test.ts`, `tests/modules/transcript/discover-counts.test.ts`, `tests/modules/agents/codex/discover-cli-version.test.ts`, `tests/modules/limits/periods-plan.test.ts`, `tests/modules/regress/{catalog,rows,claude,codex,format}.test.ts` | create | unit tests |
| `tests/modules/agents/claude-code/adapter.test.ts` | modify | discovery now returns counts |
| `tests/integration/regress-fixtures.ts`, `tests/integration/regress.integration.test.ts` | create | ported ground truth and end-to-end tests |
| `tests/e2e/release-smoke.test.ts` | modify | `regress` in the `--help` list |
| `plugins/sipcode/plugin.json`, `plugins/sipcode/.codex-plugin/plugin.json`, `plugins/sipcode/assets/logo.png`, `plugins/sipcode/skills/{sipcode-spend,sipcode-limits,sipcode-why,sipcode-regress}/SKILL.md`, `.agents/plugins/marketplace.json` | create | the plugin and its marketplace |
| `tests/plugin/codex-plugin.test.ts` | create | plugin validation test |
| `scripts/verify-counts.mjs` | modify | independent regress check |
| `README.md`, `CHANGELOG.md`, `PRIVACY.md`, `docs/site/public/llms.txt`, `docs/site/public/llms-full.txt` | modify | docs |
| `package.json`, `package-lock.json`, `server.json`, `docs/site/src/components/{Hero,Footer}.astro`, README badge, llms files | modify | v1.7.2 and the test count (release task) |

---

### Task 1: Claude Code parser keeps each request's tags

**Files:**
- Modify: `src/modules/transcript/parse.ts`
- Modify: `src/modules/agents/usageSessions.ts:182`
- Test: `tests/modules/transcript/parse-regress-fields.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/transcript/parse-regress-fields.test.ts`:

```ts
/** The per-request fields `sipcode regress` reads from Claude Code transcripts. */
import { describe, expect, it } from "vitest";
import { parseTranscript } from "../../../src/modules/transcript/parse.js";

const user = (content: unknown, ts = "2026-10-01T10:00:00.000Z") =>
  JSON.stringify({ type: "user", sessionId: "s", timestamp: ts, message: { role: "user", content } });

const assistant = (o: {
  id: string;
  version?: string;
  entrypoint?: string;
  isSidechain?: boolean;
  usage?: Record<string, unknown>;
  ts?: string;
}) =>
  JSON.stringify({
    type: "assistant",
    sessionId: "s",
    timestamp: o.ts ?? "2026-10-01T10:00:01.000Z",
    requestId: `req_${o.id}`,
    ...(o.version ? { version: o.version } : {}),
    ...(o.entrypoint ? { entrypoint: o.entrypoint } : {}),
    ...(o.isSidechain !== undefined ? { isSidechain: o.isSidechain } : {}),
    message: { id: `msg_${o.id}`, model: "claude-opus-4-8", role: "assistant", content: [{ type: "text", text: "." }], usage: o.usage ?? { input_tokens: 3, output_tokens: 10 } },
  });

function turns(lines: string[]) {
  const r = parseTranscript(lines.join("\n"));
  if (!r.ok) throw new Error("parse");
  return r.value.assistantTurns;
}

describe("parseTranscript: regress fields", () => {
  it("keeps version and entrypoint from the request's line", () => {
    const [t] = turns([user("hi"), assistant({ id: "a", version: "2.1.257", entrypoint: "cli" })]);
    expect(t!.version).toBe("2.1.257");
    expect(t!.entrypoint).toBe("cli");
    expect(t!.sidechain).toBeUndefined();
  });

  it("leaves version and entrypoint unset when the line has none", () => {
    const [t] = turns([assistant({ id: "a" })]);
    expect(t!.version).toBeUndefined();
    expect(t!.entrypoint).toBeUndefined();
  });

  it("marks sidechain requests", () => {
    const [a, b] = turns([assistant({ id: "a", isSidechain: true }), assistant({ id: "b", isSidechain: false })]);
    expect(a!.sidechain).toBe(true);
    expect(b!.sidechain).toBeUndefined();
  });

  it("afterToolResult follows the last user line: tool_result yes, prompt no", () => {
    const [a, b, c] = turns([
      user([{ type: "tool_result", tool_use_id: "t1", content: "ok" }]),
      assistant({ id: "a" }),
      user("next prompt"),
      assistant({ id: "b" }),
      user([{ type: "text", text: "x" }, { type: "tool_result", tool_use_id: "t2", content: "ok" }]),
      assistant({ id: "c" }),
    ]);
    expect(a!.afterToolResult).toBe(true);
    expect(b!.afterToolResult).toBeUndefined();
    expect(c!.afterToolResult).toBe(true);
  });

  it("cacheSplitLogged: set when usage logs the nested 5m / 1h split; 5m = cache write - 1h", () => {
    const [split, flat] = turns([
      assistant({
        id: "a",
        usage: { input_tokens: 3, output_tokens: 10, cache_creation_input_tokens: 900, cache_creation: { ephemeral_5m_input_tokens: 600, ephemeral_1h_input_tokens: 300 } },
      }),
      assistant({ id: "b", usage: { input_tokens: 3, output_tokens: 10, cache_creation_input_tokens: 900 } }),
    ]);
    expect(split!.cacheSplitLogged).toBe(true);
    expect(split!.cacheCreationTokens - split!.cacheCreation1hTokens).toBe(600);
    expect(flat!.cacheSplitLogged).toBeUndefined();
  });

  it("one request logged on several lines keeps the first line's tags and one turn", () => {
    const t = turns([
      user([{ type: "tool_result", tool_use_id: "t1", content: "ok" }]),
      assistant({ id: "a", version: "2.1.90", entrypoint: "cli" }),
      assistant({ id: "a", version: "2.1.90", entrypoint: "cli", usage: { input_tokens: 3, output_tokens: 50 } }),
    ]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ version: "2.1.90", entrypoint: "cli", afterToolResult: true, outputTokens: 50 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/modules/transcript/parse-regress-fields.test.ts`
Expected: FAIL, 5 of 6 tests: `expected undefined to be '2.1.257'`, `expected undefined to be true`, ... (only "leaves version and entrypoint unset" passes).

- [ ] **Step 3: Add the fields to `AssistantTurn`**

In `src/modules/transcript/parse.ts` replace:

```ts
  /** True if this turn had no usage block at all (older Claude Code). */
  readonly missingUsage: boolean;
}
```

with:

```ts
  /** True if this turn had no usage block at all (older Claude Code). */
  readonly missingUsage: boolean;
  /** Claude Code: the `version` on the request's line (the Claude Code version that sent it). */
  readonly version?: string | undefined;
  /** Claude Code: the `entrypoint` on the request's line ("cli", "sdk-ts", ...). */
  readonly entrypoint?: string | undefined;
  /** Claude Code: true when the line is marked `isSidechain` (a subagent turn inside the main file). */
  readonly sidechain?: boolean | undefined;
  /** Claude Code: true when the user line logged before this request held a tool_result. */
  readonly afterToolResult?: boolean | undefined;
  /** Claude Code: true when usage logged the nested 5-minute / 1-hour cache-write split. */
  readonly cacheSplitLogged?: boolean | undefined;
}
```

- [ ] **Step 4: Report whether the nested split was logged**

In `usageNumbers` replace:

```ts
  cacheCreation1h: number;
} {
```

with:

```ts
  cacheCreation1h: number;
  split: boolean;
} {
```

and replace:

```ts
    cacheCreation1h: nested1h,
  };
}
```

with:

```ts
    cacheCreation1h: nested1h,
    split: !!nested && typeof nested === "object",
  };
}
```

- [ ] **Step 5: Track the last user line and tag each request**

In `parseTranscript` replace:

```ts
  let userTurnCount = 0;
  let linesParsed = 0;
  let linesSkipped = 0;

  for (let i = 0; i < lines.length; i++) {
```

with:

```ts
  let userTurnCount = 0;
  let linesParsed = 0;
  let linesSkipped = 0;
  // Did the last user line hold a tool_result? (AssistantTurn.afterToolResult)
  let lastUserHadToolResult = false;

  for (let i = 0; i < lines.length; i++) {
```

Replace:

```ts
        t.cacheCreation1hTokens = Math.max(t.cacheCreation1hTokens, u.cacheCreation1h);
        if (usage) t.missingUsage = false;
      } else {
        if (model) {
          modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
        }
        turn = {
```

with:

```ts
        t.cacheCreation1hTokens = Math.max(t.cacheCreation1hTokens, u.cacheCreation1h);
        if (usage) t.missingUsage = false;
        if (u.split) t.cacheSplitLogged = true;
      } else {
        if (model) {
          modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
        }
        const tags = a as { version?: unknown; entrypoint?: unknown; isSidechain?: unknown };
        turn = {
          ...(typeof tags.version === "string" && tags.version ? { version: tags.version } : {}),
          ...(typeof tags.entrypoint === "string" && tags.entrypoint ? { entrypoint: tags.entrypoint } : {}),
          ...(tags.isSidechain === true ? { sidechain: true } : {}),
          ...(lastUserHadToolResult ? { afterToolResult: true } : {}),
          ...(u.split ? { cacheSplitLogged: true } : {}),
```

Replace:

```ts
      // Skip tool_result-only wrappers when counting user turns.
      const content = u.message?.content;
```

with:

```ts
      // Skip tool_result-only wrappers when counting user turns.
      const content = u.message?.content;
      lastUserHadToolResult =
        Array.isArray(content) &&
        content.some((c) => c != null && typeof c === "object" && (c as { type?: unknown }).type === "tool_result");
```

- [ ] **Step 6: Bump the usage-cache schema (the parse output changed)**

In `src/modules/agents/usageSessions.ts` replace `const CACHE_SCHEMA = "sipcode-usage-cache/2";` with `const CACHE_SCHEMA = "sipcode-usage-cache/3";`.

- [ ] **Step 7: Run the test, the parser and cache tests, and the typecheck**

Run: `npx vitest run tests/modules/transcript tests/modules/agents/usageSessions.test.ts && npm run lint`
Expected: PASS (the `usageOnly` test still passes: the cache keeps every turn field except tool calls).

- [ ] **Step 8: Commit**

```bash
git add src/modules/transcript/parse.ts src/modules/agents/usageSessions.ts tests/modules/transcript/parse-regress-fields.test.ts
git commit -m "feat(parse): keep each Claude Code request's version, entrypoint and cache flags" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Claude Code discovery counts what it cannot read

**Files:**
- Modify: `src/modules/transcript/discover.ts:94-133`
- Modify: `src/modules/agents/claude-code/adapter.ts`
- Modify: `tests/modules/agents/claude-code/adapter.test.ts:98-103`
- Test: `tests/modules/transcript/discover-counts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/transcript/discover-counts.test.ts`:

```ts
/** Claude Code discovery counts what it could not read (never drops it silently). */
import { describe, expect, it } from "vitest";
import { InMemoryFs, type FileSystem } from "../../../src/lib/fs.js";
import { listAllSessions, listClaudeSessions } from "../../../src/modules/transcript/discover.js";

/** Throws EACCES for the operations and paths `fail` names. */
function failing(base: InMemoryFs, fail: (p: string, op: string) => boolean): FileSystem {
  const guard = (p: string, op: string) => {
    if (fail(p.replace(/\\/g, "/"), op)) throw Object.assign(new Error(`EACCES: ${p}`), { code: "EACCES" });
  };
  return {
    exists: (p) => base.exists(p),
    readFile: async (p) => (guard(p, "readFile"), base.readFile(p)),
    readHead: async (p, n) => (guard(p, "readHead"), base.readHead(p, n)),
    readDir: async (p) => (guard(p, "readDir"), base.readDir(p)),
    stat: async (p) => (guard(p, "stat"), base.stat(p)),
  };
}

function logs(): InMemoryFs {
  const fs = new InMemoryFs();
  fs.writeFile("/p/A/one.jsonl", "{}", 2);
  fs.writeFile("/p/B/two.jsonl", "{}", 1);
  return fs;
}

describe("listClaudeSessions", () => {
  it("lists every session, newest first, with zero counts", async () => {
    const r = await listClaudeSessions(logs(), "/p");
    expect(r.sessions.map((s) => s.sessionId)).toEqual(["one", "two"]);
    expect(r.unreadable).toBe(0);
    expect(r.unreadableFolders).toBe(0);
  });

  it("a missing projects folder is not an error", async () => {
    expect(await listClaudeSessions(new InMemoryFs(), "/none")).toEqual({ sessions: [], unreadable: 0, unreadableFolders: 0 });
  });

  it("counts a projects folder that cannot be listed", async () => {
    const r = await listClaudeSessions(failing(logs(), (p, op) => op === "readDir" && p === "/p"), "/p");
    expect(r).toEqual({ sessions: [], unreadable: 0, unreadableFolders: 1 });
  });

  it("counts a project folder that cannot be listed and keeps the others", async () => {
    const r = await listClaudeSessions(failing(logs(), (p, op) => op === "readDir" && p === "/p/B"), "/p");
    expect(r.sessions.map((s) => s.sessionId)).toEqual(["one"]);
    expect(r.unreadableFolders).toBe(1);
  });

  it("counts a transcript that cannot be read", async () => {
    const r = await listClaudeSessions(failing(logs(), (p, op) => op === "stat" && p.endsWith("two.jsonl")), "/p");
    expect(r.sessions.map((s) => s.sessionId)).toEqual(["one"]);
    expect(r.unreadable).toBe(1);
  });

  it("listAllSessions returns the same sessions", async () => {
    expect((await listAllSessions(logs(), "/p")).map((s) => s.sessionId)).toEqual(["one", "two"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/modules/transcript/discover-counts.test.ts`
Expected: FAIL: `listClaudeSessions is not a function` (5 failed; "listAllSessions returns the same sessions" passes).

- [ ] **Step 3: Replace `listAllSessions` with the counting version**

In `src/modules/transcript/discover.ts` replace the whole block from `/**\n * List all sessions across all project directories.` down to and including the closing `}` of `listAllSessions` (the line after `return out.sort((a, b) => b.mtimeMs - a.mtimeMs);`) with:

```ts
/** Claude Code sessions, with what could not be read counted (never silently dropped). */
export interface ClaudeSessionList {
  readonly sessions: SessionMeta[];
  /** Transcript files that were listed but could not be read (stat failed). */
  readonly unreadable: number;
  /** Folders that could not be listed: the projects folder itself, or a project folder. */
  readonly unreadableFolders: number;
}

/**
 * List all sessions across all project directories, counting the folders and
 * files that could not be read. Sorted by mtime descending (most recent
 * first). Observer/telemetry project dirs (see {@link isObserverProjectDir})
 * are skipped. A missing projects folder is not an error (no sessions).
 */
export async function listClaudeSessions(
  fs: FileSystem,
  projectsDir: string,
): Promise<ClaudeSessionList> {
  const out: SessionMeta[] = [];
  let unreadable = 0;
  let unreadableFolders = 0;
  if (!(await fs.exists(projectsDir))) return { sessions: out, unreadable, unreadableFolders };
  let projectDirs;
  try {
    projectDirs = await fs.readDir(projectsDir);
  } catch {
    return { sessions: out, unreadable, unreadableFolders: 1 };
  }
  for (const proj of projectDirs) {
    if (!proj.isDirectory) continue;
    if (isObserverProjectDir(proj.name)) continue;
    const projPath = path.join(projectsDir, proj.name);
    let entries;
    try {
      entries = await fs.readDir(projPath);
    } catch {
      unreadableFolders++;
      continue;
    }
    for (const e of entries) {
      if (!e.isFile || !e.name.endsWith(".jsonl")) continue;
      const filePath = path.join(projPath, e.name);
      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch {
        unreadable++;
        continue;
      }
      out.push({
        sessionId: e.name.replace(/\.jsonl$/, ""),
        filePath,
        projectHash: proj.name,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { sessions: out, unreadable, unreadableFolders };
}

/** listClaudeSessions without the counts (estimate's historical anchors). */
export async function listAllSessions(
  fs: FileSystem,
  projectsDir: string,
): Promise<SessionMeta[]> {
  return (await listClaudeSessions(fs, projectsDir)).sessions;
}
```

- [ ] **Step 4: Return the counts from the adapter**

In `src/modules/agents/claude-code/adapter.ts` replace `  listAllSessions,` (in the import from `../../transcript/discover.js`) with `  listClaudeSessions,`; replace `  RulesBlockInput,` (in the import from `../types.js`) with:

```ts
  RulesBlockInput,
  SessionDiscovery,
```

and replace:

```ts
  ): Promise<Result<SessionMeta[], SipcodeIssue[]>> {
    const projectsDir = resolveProjectsDir(deps.env);
    const sessions = await listAllSessions(deps.fs, projectsDir);
    return ok(sessions);
```

with:

```ts
  ): Promise<Result<SessionDiscovery, SipcodeIssue[]>> {
    const r = await listClaudeSessions(deps.fs, resolveProjectsDir(deps.env));
    return ok({ sessions: r.sessions, unreadable: r.unreadable, unreadableFolders: r.unreadableFolders, issues: [] });
```

- [ ] **Step 5: Update the adapter test (discovery now returns the counts)**

In `tests/modules/agents/claude-code/adapter.test.ts` replace:

```ts
  it("discoverSessions returns ok with empty array when projectsDir is missing", async () => {
    const fs = new InMemoryFs();
    const r = await claudeCodeAgent.discoverSessions(deps(fs));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([]);
```

with:

```ts
  it("discoverSessions returns ok with no sessions and zero counts when projectsDir is missing", async () => {
    const fs = new InMemoryFs();
    const r = await claudeCodeAgent.discoverSessions(deps(fs));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ sessions: [], unreadable: 0, unreadableFolders: 0, issues: [] });
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run tests/modules/transcript tests/modules/agents tests/modules/estimate && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/transcript/discover.ts src/modules/agents/claude-code/adapter.ts tests/modules/agents/claude-code/adapter.test.ts tests/modules/transcript/discover-counts.test.ts
git commit -m "fix(discover): count Claude Code folders and files that cannot be read" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Codex discovery keeps the Codex version

**Files:**
- Modify: `src/modules/transcript/discover.ts` (`SessionMeta`)
- Modify: `src/modules/agents/codex/discover.ts:139`
- Test: `tests/modules/agents/codex/discover-cli-version.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/agents/codex/discover-cli-version.test.ts`:

```ts
/** Codex discovery keeps the Codex version line 1 records (sipcode regress groups by it). */
import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../../../src/lib/fs.js";
import { listCodexSessions } from "../../../../src/modules/agents/codex/discover.js";

const line1 = (payload: Record<string, unknown>) =>
  JSON.stringify({ timestamp: "2026-10-01T10:00:00Z", type: "session_meta", payload });

describe("Codex discovery: cliVersion", () => {
  it("copies cli_version from line 1", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/c/sessions/2026/10/01/rollout-a.jsonl", line1({ id: "a", cwd: "/p", cli_version: "0.142.5" }), 1);
    const r = await listCodexSessions(fs, "/c");
    expect(r.sessions[0]!.cliVersion).toBe("0.142.5");
  });

  it("leaves it unset when line 1 has none", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/c/sessions/2026/10/01/rollout-b.jsonl", line1({ id: "b", cwd: "/p" }), 1);
    const r = await listCodexSessions(fs, "/c");
    expect(r.sessions[0]!.cliVersion).toBeUndefined();
    expect("cliVersion" in r.sessions[0]!).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/modules/agents/codex/discover-cli-version.test.ts`
Expected: FAIL: `expected undefined to be '0.142.5'` (the second test passes).

- [ ] **Step 3: Add `cliVersion` to `SessionMeta`**

In `src/modules/transcript/discover.ts` replace:

```ts
  readonly lineage?: { readonly id: string; readonly linkedIds: readonly string[] } | undefined;
}
```

with:

```ts
  readonly lineage?: { readonly id: string; readonly linkedIds: readonly string[] } | undefined;
  /** Codex: the `cli_version` line 1 records (the Codex version that wrote the file). */
  readonly cliVersion?: string | undefined;
}
```

- [ ] **Step 4: Copy it in Codex discovery**

In `src/modules/agents/codex/discover.ts` replace:

```ts
      ...(m.id ? { lineage: { id: m.id, linkedIds: m.linkedIds } } : {}),
```

with:

```ts
      ...(m.id ? { lineage: { id: m.id, linkedIds: m.linkedIds } } : {}),
      ...(m.cliVersion ? { cliVersion: m.cliVersion } : {}),
```

- [ ] **Step 5: Run the Codex tests and the typecheck**

Run: `npx vitest run tests/modules/agents/codex && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/transcript/discover.ts src/modules/agents/codex/discover.ts tests/modules/agents/codex/discover-cli-version.test.ts
git commit -m "feat(codex): keep the Codex version line 1 records on each discovered session" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Each limit period carries its plan

**Files:**
- Modify: `src/modules/limits/periods.ts`
- Test: `tests/modules/limits/periods-plan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/limits/periods-plan.test.ts`:

```ts
/** A limit period carries the plan of its newest reading (sipcode regress compares same-plan versions). */
import { describe, expect, it } from "vitest";
import type { LimitReading } from "../../../src/modules/agents/codex/rateLimits.js";
import { buildPeriods } from "../../../src/modules/limits/periods.js";

const H = 3_600_000;
const T = Date.parse("2026-10-01T00:00:00Z");

const reading = (at: number, usedPercent: number, planType: string | undefined, resetsAt = T + 168 * H): LimitReading => ({
  at,
  sessionId: "s",
  limitId: "codex",
  planType,
  windowMinutes: 10_080,
  slot: "primary",
  usedPercent,
  resetsAt,
});

describe("buildPeriods: planType", () => {
  it("is the newest reading's plan", () => {
    const [w] = buildPeriods([reading(T + H, 5, "plus"), reading(T + 2 * H, 9, "pro")]);
    expect(w!.periods[0]!.planType).toBe("pro");
  });

  it("each period keeps its own plan", () => {
    const [w] = buildPeriods([reading(T + H, 5, "plus"), reading(T + 200 * H, 3, "pro", T + 368 * H)]);
    expect(w!.periods.map((p) => p.planType)).toEqual(["plus", "pro"]);
  });

  it("is absent when the newest reading has no plan", () => {
    const [w] = buildPeriods([reading(T + H, 5, undefined)]);
    expect("planType" in w!.periods[0]!).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/modules/limits/periods-plan.test.ts`
Expected: FAIL: `expected undefined to be 'pro'` and `expected [ undefined, undefined ] to deeply equal [ 'plus', 'pro' ]` (the third test passes).

- [ ] **Step 3: Implement**

In `src/modules/limits/periods.ts` replace:

```ts
  /** One point per reading, oldest first. */
  readonly points: readonly PeriodPoint[];
}
```

with:

```ts
  /** One point per reading, oldest first. */
  readonly points: readonly PeriodPoint[];
  /** plan_type of the newest reading (undefined when that reading has none). */
  readonly planType?: string | undefined;
}
```

Replace:

```ts
  newestAt: number;
  readonly points: PeriodPoint[];
}
```

with:

```ts
  newestAt: number;
  readonly points: PeriodPoint[];
  planType: string | undefined;
}
```

Replace:

```ts
        newestAt: r.at,
        points: [{ at: r.at, usedPercent: r.usedPercent }],
      });
```

with:

```ts
        newestAt: r.at,
        points: [{ at: r.at, usedPercent: r.usedPercent }],
        planType: r.planType,
      });
```

Replace:

```ts
    cur.newestAt = r.at;
```

with:

```ts
    cur.newestAt = r.at;
    cur.planType = r.planType;
```

Replace:

```ts
        newestAt: p.newestAt,
        points: p.points,
```

with:

```ts
        newestAt: p.newestAt,
        points: p.points,
        ...(p.planType !== undefined ? { planType: p.planType } : {}),
```

- [ ] **Step 4: Run the limits tests and the typecheck**

Run: `npx vitest run tests/modules/limits tests/integration/limits.integration.test.ts && npm run lint`
Expected: PASS (no existing test deep-compares a whole period).

- [ ] **Step 5: Commit**

```bash
git add src/modules/limits/periods.ts tests/modules/limits/periods-plan.test.ts
git commit -m "feat(limits): each period carries the plan of its newest reading" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Regression catalog and shared helpers

**Files:**
- Create: `src/modules/regress/catalog.ts`, `src/modules/regress/helpers.ts`, `src/modules/regress/types.ts`
- Test: `tests/modules/regress/catalog.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/regress/catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { KNOWN, inRange, knownWindowsCovered, matchKnown, releaseOf, vcmp } from "../../../src/modules/regress/catalog.js";

describe("regress catalog", () => {
  it("vcmp compares numerically, three parts", () => {
    expect(vcmp("2.1.9", "2.1.10")).toBeLessThan(0);
    expect(vcmp("2.1.100", "2.1.99")).toBeGreaterThan(0);
    expect(vcmp("0.142.0", "0.142.0-alpha.3")).toBe(0);
    expect(vcmp("1.0", "1.0.0")).toBe(0);
  });

  it("inRange is inclusive", () => {
    expect(inRange("2.1.69", "2.1.69", "2.1.89")).toBe(true);
    expect(inRange("2.1.89", "2.1.69", "2.1.89")).toBe(true);
    expect(inRange("2.1.90", "2.1.69", "2.1.89")).toBe(false);
  });

  it("releaseOf drops a pre-release suffix", () => {
    expect(releaseOf("0.142.0-alpha.3")).toBe("0.142.0");
    expect(releaseOf("0.142.5")).toBe("0.142.5");
  });

  it("holds R1 to R5 with their windows", () => {
    expect(KNOWN.map((k) => [k.id, k.from, k.to, k.fixed])).toEqual([
      ["R1", "2.1.257", "2.1.259", "2.1.260"],
      ["R2", "2.1.69", "2.1.89", "2.1.90"],
      ["R3", "2.1.85", "2.1.100", "2.1.101"],
      ["R4", "2.1.0", "2.1.128", "2.1.129"],
      ["R5", "2.1.0", "2.1.247", "2.1.248"],
    ]);
  });

  it("matchKnown needs the check and an overlapping range", () => {
    expect(matchKnown("warm-cache-miss", "2.1.76", "2.1.76").map((k) => k.id)).toEqual(["R2"]);
    expect(matchKnown("warm-cache-miss", "2.1.76", "2.1.90").map((k) => k.id)).toEqual(["R2", "R3"]);
    expect(matchKnown("ttl-5m", "2.1.129", "2.1.140")).toEqual([]);
    expect(matchKnown("uncached-input", "2.1.76", "2.1.76")).toEqual([]);
    expect(matchKnown("codex-limit-burn", "0.142.0", "0.142.0")).toEqual([]);
  });

  it("knownWindowsCovered lists the entries any version falls in", () => {
    expect(knownWindowsCovered(["2.1.60"])).toEqual(["R4", "R5"]);
    expect(knownWindowsCovered(["2.1.258", "2.1.300"])).toEqual(["R1"]);
    expect(knownWindowsCovered([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/modules/regress/catalog.test.ts`
Expected: FAIL: `Failed to load url ../../../src/modules/regress/catalog.js` (the module does not exist yet).

- [ ] **Step 3: Write the catalog**

Create `src/modules/regress/catalog.ts`:

```ts
/**
 * Known, confirmed Claude Code regressions, and version helpers. Pure.
 *
 * Each catalog entry names the versions where the bug was live and the check
 * whose fingerprint it shows up as. A finding "matches" an entry when the
 * check is one of the entry's and the finding's version range overlaps the
 * entry's. Sources: Claude Code's CHANGELOG, the GitHub issues and the
 * postmortem named in `ref`.
 */

export type CheckId =
  | "warm-cache-miss"
  | "post-idle-cold"
  | "ttl-5m"
  | "uncached-input"
  | "hourly-rebuild"
  | "codex-limit-burn";

export interface KnownRegression {
  readonly id: string;
  readonly checks: readonly CheckId[];
  /** First and last affected version (inclusive). */
  readonly from: string;
  readonly to: string;
  readonly fixed: string;
  readonly what: string;
  readonly ref: string;
}

export const KNOWN: readonly KnownRegression[] = [
  {
    id: "R1",
    checks: ["uncached-input"],
    from: "2.1.257",
    to: "2.1.259",
    fixed: "2.1.260",
    what: "Fable 5.1 context after tool results re-sent as uncached input every tool-call turn",
    ref: "CHANGELOG 2.1.260",
  },
  {
    id: "R2",
    checks: ["warm-cache-miss"],
    from: "2.1.69",
    to: "2.1.89",
    fixed: "2.1.90",
    what: "--resume full prompt-cache miss (every message under --print --resume)",
    ref: "anthropics/claude-code#34629, CHANGELOG 2.1.90",
  },
  {
    id: "R3",
    checks: ["post-idle-cold", "warm-cache-miss"],
    from: "2.1.85",
    to: "2.1.100",
    fixed: "2.1.101",
    what: "thinking history cleared on every turn after an idle >1h, causing repeated cache misses",
    ref: "Anthropic April 23 postmortem",
  },
  {
    id: "R4",
    checks: ["ttl-5m"],
    from: "2.1.0",
    to: "2.1.128",
    fixed: "2.1.129",
    what: "1-hour prompt cache TTL silently downgraded to 5 minutes",
    ref: "anthropics/claude-code#46829, CHANGELOG 2.1.108 + 2.1.129",
  },
  {
    id: "R5",
    checks: ["hourly-rebuild"],
    from: "2.1.0",
    to: "2.1.247",
    fixed: "2.1.248",
    what: "OAuth token refresh re-rendered tool definitions, rebuilding the whole cache about hourly",
    ref: "CHANGELOG 2.1.248",
  },
];

function parts(v: string): [number, number, number] {
  const p = (v || "0.0.0").split(/[.-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
}

/** Compare two versions by their first three numeric parts ("2.1.9" < "2.1.10"). */
export function vcmp(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

export function inRange(v: string, from: string, to: string): boolean {
  return vcmp(v, from) >= 0 && vcmp(v, to) <= 0;
}

/** "0.142.0-alpha.3" → "0.142.0": a pre-release is compared as its release. */
export function releaseOf(v: string): string {
  return v.replace(/-.*/, "");
}

/** Catalog entries of `check` whose range overlaps from..to. */
export function matchKnown(check: CheckId, from: string, to: string): KnownRegression[] {
  return KNOWN.filter((k) => k.checks.includes(check) && vcmp(from, k.to) <= 0 && vcmp(to, k.from) >= 0);
}

/** Catalog ids whose range contains at least one of `versions`. */
export function knownWindowsCovered(versions: readonly string[]): string[] {
  return KNOWN.filter((k) => versions.some((v) => inRange(v, k.from, k.to))).map((k) => k.id);
}
```

- [ ] **Step 4: Write the helpers and the shared `Finding` type**

Create `src/modules/regress/helpers.ts`:

```ts
/** Number and time formatting shared by the regress checks. Pure. */

/** 0.253 → "25.3%". */
export const pct = (x: number): string => (100 * x).toFixed(1) + "%";

/** 12345.6 → "12,346". */
export const fmtN = (n: number): string => Math.round(n).toLocaleString("en-US");

/** Epoch ms → ISO 8601 (UTC). */
export const isoTime = (ms: number): string => new Date(ms).toISOString();

/** The prototype's median: the middle element, or the upper of the two middle ones; 0 for none. */
export function upperMedian(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}
```

Create `src/modules/regress/types.ts`:

```ts
/** Shapes shared by the regress checks, report and formatters. */
import type { CheckId, KnownRegression } from "./catalog.js";

export interface Finding {
  readonly id: CheckId;
  readonly agent: "claude-code" | "codex";
  readonly title: string;
  /** First and last version of the flagged range (equal for one version). */
  readonly from: string;
  readonly to: string;
  /** Catalog entries the range matches (empty: not in the known-issue catalog). */
  readonly known: readonly KnownRegression[];
  /** One line per flagged version (or version and model), numbers as printed. */
  readonly evidence: readonly string[];
  /** Up to 3 sample requests: short session id, time, token counts. */
  readonly examples: readonly string[];
  readonly note: string | null;
}
```

- [ ] **Step 5: Run the test and the typecheck**

Run: `npx vitest run tests/modules/regress/catalog.test.ts && npm run lint`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/regress/catalog.ts src/modules/regress/helpers.ts src/modules/regress/types.ts tests/modules/regress/catalog.test.ts
git commit -m "feat(regress): known-regression catalog R1 to R5 and version helpers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Rows the checks read (and the ported fixtures)

**Files:**
- Create: `src/modules/regress/rows.ts`
- Create: `tests/integration/regress-fixtures.ts` (test helper, used from Task 6 on)
- Test: `tests/modules/regress/rows.test.ts`

- [ ] **Step 1: Write the fixture builders**

Create `tests/integration/regress-fixtures.ts` (a port of the prototype's `make-fixtures.mjs`: same healthy versions and the same five Claude Code regression signatures; Codex laid out as consecutive weekly periods for Sipcode's account-wide limit model):

```ts
/**
 * Synthetic Claude Code transcripts and Codex rollouts for `sipcode regress`,
 * ported from the prototype's ground truth (prototypes/regress/make-fixtures.mjs
 * on the regress-prototype branch). The dirty set reproduces the published
 * signatures of the confirmed regressions R1 to R5 plus a Codex version that
 * drains its limit 10x faster per token; the clean set has the same healthy
 * versions and must produce zero findings.
 *
 * Codex is laid out for Sipcode's account-wide limit model (the prototype
 * compared per-file deltas): each version runs in its own weekly period, one
 * after the other, and its readings rise with its own requests.
 */
import type { InMemoryFs } from "../../src/lib/fs.js";

export const HOME = "/home/u";
export const CLAUDE_PROJECT = `${HOME}/.claude/projects/C--demo`;
export const CODEX_DAY_DIR = `${HOME}/.codex/sessions/2026/06/20`;

const T0 = Date.parse("2026-03-01T09:00:00Z");
const DAY = 86_400_000;

/** One request: minutes since the previous one, uncached input, cache read / 5m write / 1h write, output, after a tool result. */
export interface Turn {
  readonly gap?: number;
  readonly inp?: number;
  readonly cr: number;
  readonly c5?: number;
  readonly c1?: number;
  readonly out?: number;
  readonly tool?: boolean;
}

export interface SessionOpts {
  readonly side?: boolean;
  readonly start?: number;
  readonly entrypoint?: string;
}

let reqN = 0;

/** The JSONL text of one Claude Code session: a user line, then the assistant line, per turn. */
export function claudeSessionText(sid: string, version: string, model: string, turns: readonly Turn[], opts: SessionOpts = {}): string {
  const lines: string[] = [];
  let t = opts.start ?? T0;
  for (const x of turns) {
    t += (x.gap ?? 1) * 60_000;
    lines.push(
      JSON.stringify({
        type: "user",
        sessionId: sid,
        version,
        timestamp: new Date(t - 1000).toISOString(),
        message: { role: "user", content: x.tool ? [{ type: "tool_result", tool_use_id: "t", content: "ok" }] : "next" },
      }),
    );
    reqN++;
    lines.push(
      JSON.stringify({
        type: "assistant",
        sessionId: sid,
        version,
        ...(opts.entrypoint ? { entrypoint: opts.entrypoint } : {}),
        isSidechain: opts.side ?? false,
        requestId: `req_${reqN}`,
        timestamp: new Date(t).toISOString(),
        message: {
          id: `msg_${reqN}`,
          model,
          role: "assistant",
          content: [{ type: "text", text: "." }],
          usage: {
            input_tokens: x.inp ?? 3,
            output_tokens: x.out ?? 400,
            cache_read_input_tokens: x.cr,
            cache_creation_input_tokens: (x.c5 ?? 0) + (x.c1 ?? 0),
            cache_creation: { ephemeral_5m_input_tokens: x.c5 ?? 0, ephemeral_1h_input_tokens: x.c1 ?? 0 },
          },
        },
      }),
    );
  }
  return lines.join("\n") + "\n";
}

export function addClaudeSession(
  fs: InMemoryFs,
  sid: string,
  version: string,
  model: string,
  turns: readonly Turn[],
  opts: SessionOpts = {},
): void {
  const minutes = turns.reduce((a, x) => a + (x.gap ?? 1), 0);
  fs.writeFile(`${CLAUDE_PROJECT}/${sid}.jsonl`, claudeSessionText(sid, version, model, turns, opts), (opts.start ?? T0) + minutes * 60_000);
}

/** Healthy growth: each turn reads the previous context from cache and writes the small delta. */
export function healthy(
  n: number,
  o: { base?: number; step?: number; ttl?: "1h" | "5m"; inp?: number; tool?: boolean; idleAt?: readonly number[] } = {},
): Turn[] {
  const { base = 40e3, step = 3e3, ttl = "1h", inp = 3, tool = true, idleAt = [] } = o;
  const out: Turn[] = [];
  let ctx = base;
  for (let i = 0; i < n; i++) {
    const idle = idleAt.includes(i);
    const write = i === 0 || idle ? ctx : step; // first turn / after idle: one cold turn (expected)
    const read = i === 0 || idle ? 0 : ctx - step;
    out.push({ gap: idle ? 75 : 1, inp, cr: read, ...(ttl === "1h" ? { c1: write } : { c5: write }), tool });
    ctx += step;
  }
  return out;
}

export const HEALTHY_VERSIONS = ["2.1.60", "2.1.95", "2.1.140", "2.1.200", "2.1.250", "2.1.262"] as const;

export function addClaudeDataset(fs: InMemoryFs, { dirty }: { readonly dirty: boolean }): void {
  let s = 0;
  const sid = (): string => `sess${String(++s).padStart(4, "0")}-0000-4000-8000-000000000000`;
  HEALTHY_VERSIONS.forEach((v, k) => {
    for (let j = 0; j < 3; j++) {
      addClaudeSession(fs, sid(), v, "claude-opus-4-8", healthy(30, { idleAt: [15] }), { start: T0 + (k * 10 + j) * DAY, entrypoint: "cli" });
    }
    addClaudeSession(fs, sid(), v, "claude-fable-5-1", healthy(25, { inp: 5 }), { start: T0 + (k * 10 + 5) * DAY, entrypoint: "cli" });
  });
  // Agent SDK and subagent runs with the 5-minute TTL: different cache policy by design, never compared.
  addClaudeSession(fs, sid(), "2.1.201", "claude-opus-4-8", healthy(30, { ttl: "5m" }), { start: T0 + 31 * DAY, entrypoint: "sdk-ts" });
  addClaudeSession(fs, sid(), "2.1.201", "claude-opus-4-8", healthy(30, { ttl: "5m" }), { start: T0 + 32 * DAY, side: true });
  if (!dirty) return;
  // R2 2.1.76: back-to-back turns, cache_read stuck at the system-prompt size, whole conversation re-written (#34629 rows).
  for (let j = 0; j < 3; j++) {
    const turns: Turn[] = [];
    let conv = 40e3;
    for (let i = 0; i < 25; i++) {
      turns.push({ gap: 1, cr: 14569, c1: conv, tool: true });
      conv += 1500;
    }
    addClaudeSession(fs, sid(), "2.1.76", "claude-opus-4-6", turns, { start: T0 + (70 + j) * DAY });
  }
  // R3 2.1.90: after an idle gap > 60 min, the following turns stay cold.
  for (let j = 0; j < 8; j++) {
    const turns = healthy(10);
    let ctx = 40e3 + 10 * 3e3;
    for (let i = 0; i < 4; i++) {
      turns.push({ gap: i === 0 ? 70 : 1, cr: 0, c1: ctx, tool: true });
      ctx += 3e3;
    }
    addClaudeSession(fs, sid(), "2.1.90", "claude-opus-4-6", turns, { start: T0 + (80 + j) * DAY });
  }
  // R4 2.1.100 and 2.1.105: main-chain cache writes at the 5-minute TTL (#46829 daily shares).
  for (const v of ["2.1.100", "2.1.105"]) {
    for (let j = 0; j < 2; j++) addClaudeSession(fs, sid(), v, "claude-opus-4-6", healthy(30, { ttl: "5m" }), { start: T0 + (90 + j) * DAY });
  }
  // R1 fable-5-1 at 2.1.258: context after tool results re-sent uncached on every tool-call turn.
  for (let j = 0; j < 2; j++) {
    addClaudeSession(fs, sid(), "2.1.258", "claude-fable-5-1", healthy(25, { inp: 3200 }), { start: T0 + (180 + j) * DAY });
  }
  // R5 2.1.240: full rebuild about every 60 minutes in long sessions with back-to-back turns.
  for (let j = 0; j < 2; j++) {
    const turns: Turn[] = [];
    let ctx = 80e3;
    for (let i = 0; i < 240; i++) {
      const rebuild = i > 0 && i % 60 === 0;
      turns.push({ gap: 1, cr: rebuild ? 9e3 : ctx - 400, c1: rebuild ? ctx - 9e3 : 400, tool: true });
      ctx += 400;
    }
    addClaudeSession(fs, sid(), "2.1.240", "claude-opus-4-8", turns, { start: T0 + (170 + j) * DAY });
  }
}

const WEEK = 7 * DAY;
const CODEX_W0 = Date.parse("2026-06-01T00:00:00Z");

/**
 * One Codex rollout of `turns` requests in week `week` (its own weekly
 * period). Each request: 120,000 input of which 105,000 cached, 5,000 output
 * (20,000 uncached + output tokens). The reading after it rises by `pctPerM`
 * percent per 1M of those tokens, in whole percent like Codex reports.
 */
export function codexRolloutText(
  id: string,
  version: string,
  week: number,
  pctPerM: number,
  o: { turns?: number; model?: string; plan?: string; windowMinutes?: number } = {},
): string {
  const { turns = 150, model = "gpt-5.5", plan = "plus", windowMinutes = 10_080 } = o;
  const start = CODEX_W0 + week * WEEK;
  const resetsAt = (start + windowMinutes * 60_000) / 1000;
  const lines = [
    JSON.stringify({ timestamp: new Date(start + 3_600_000).toISOString(), type: "session_meta", payload: { id, session_id: id, cwd: "/home/u/proj", cli_version: version } }),
  ];
  for (let i = 0; i < turns; i++) {
    const at = new Date(start + 3_600_000 + (i + 1) * 60_000).toISOString();
    lines.push(JSON.stringify({ timestamp: at, type: "turn_context", payload: { turn_id: `${id}-u${i}`, model } }));
    lines.push(
      JSON.stringify({
        timestamp: at,
        type: "token_usage_record",
        payload: {
          turn_id: `${id}-u${i}`,
          response_id: `${id}-r${i}`,
          usage: { input_tokens: 120_000, cached_input_tokens: 105_000, cache_write_input_tokens: 0, output_tokens: 5_000, reasoning_output_tokens: 0, total_tokens: 125_000 },
        },
      }),
    );
    const used = Math.floor(((i + 1) * 20_000 * pctPerM) / 1e6 + 1e-9);
    lines.push(
      JSON.stringify({
        timestamp: at,
        type: "event_msg",
        payload: {
          type: "token_count",
          info: null,
          rate_limits: { limit_id: "codex", plan_type: plan, primary: { used_percent: used, window_minutes: windowMinutes, resets_at: resetsAt }, secondary: null },
        },
      }),
    );
  }
  return lines.join("\n") + "\n";
}

export function addCodexRollout(fs: InMemoryFs, id: string, version: string, week: number, pctPerM: number, o: Parameters<typeof codexRolloutText>[4] = {}): void {
  const turns = o.turns ?? 150;
  fs.writeFile(`${CODEX_DAY_DIR}/rollout-w${week}-${id}.jsonl`, codexRolloutText(id, version, week, pctPerM, o), CODEX_W0 + week * WEEK + (turns + 70) * 60_000);
}

export function addCodexDataset(fs: InMemoryFs, { dirty }: { readonly dirty: boolean }): void {
  addCodexRollout(fs, "0199a000-0000-7000-8000-00000000000a", "0.140.0", 0, 2);
  addCodexRollout(fs, "0199a000-0000-7000-8000-00000000000b", "0.141.0", 1, 2.2);
  addCodexRollout(fs, "0199a000-0000-7000-8000-00000000000c", "0.142.0", 2, dirty ? 25 : 2.1);
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/modules/regress/rows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { codexAgent } from "../../../src/modules/agents/codex/adapter.js";
import type { SessionMeta } from "../../../src/modules/agents/shared.js";
import { parseTranscript } from "../../../src/modules/transcript/parse.js";
import { claudeRows, codexRequests, isAutomated } from "../../../src/modules/regress/rows.js";
import { claudeSessionText, codexRolloutText, healthy } from "../../integration/regress-fixtures.js";

const meta = (sessionId: string, extra: Partial<SessionMeta> = {}): SessionMeta => ({
  sessionId,
  filePath: `/x/${sessionId}.jsonl`,
  projectHash: "p",
  mtimeMs: 0,
  size: 0,
  ...extra,
});

function parsed(text: string) {
  const r = parseTranscript(text);
  if (!r.ok) throw new Error("parse");
  return r.value;
}

describe("claudeRows", () => {
  it("one row per request with the regress fields; 5m write = write - 1h", () => {
    const text = claudeSessionText("abcdef12-0000", "2.1.100", "claude-opus-4-6", healthy(3, { ttl: "5m" }), { entrypoint: "cli" });
    const rows = claudeRows({ meta: meta("abcdef12-0000"), parsed: parsed(text) });
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual({
      session: "abcdef12",
      version: "2.1.100",
      model: "claude-opus-4-6",
      entry: "cli",
      side: false,
      ts: Date.parse("2026-03-01T09:02:00.000Z"),
      inp: 3,
      cr: 40_000,
      cw: 3_000,
      c5: 3_000,
      c1: 0,
      out: 400,
      ctx: 43_003,
      afterTool: true,
    });
  });

  it("skips requests without a version, without usage, and <synthetic> ones", () => {
    const text = [
      JSON.stringify({ type: "assistant", timestamp: "2026-03-01T09:00:00Z", requestId: "r1", message: { id: "m1", model: "claude-opus-4-8", usage: { input_tokens: 1 } } }),
      JSON.stringify({ type: "assistant", version: "2.1.1", timestamp: "2026-03-01T09:01:00Z", requestId: "r2", message: { id: "m2", model: "claude-opus-4-8" } }),
      JSON.stringify({ type: "assistant", version: "2.1.1", timestamp: "2026-03-01T09:02:00Z", requestId: "r3", message: { id: "m3", model: "<synthetic>", usage: { input_tokens: 0 } } }),
      JSON.stringify({ type: "assistant", version: "2.1.1", timestamp: "2026-03-01T09:03:00Z", requestId: "r4", message: { id: "m4", model: "claude-opus-4-8", usage: { input_tokens: 5 } } }),
    ].join("\n");
    const rows = claudeRows({ meta: meta("s"), parsed: parsed(text) });
    expect(rows.map((r) => r.inp)).toEqual([5]);
  });

  it("isAutomated: sidechain and sdk-* entrypoints", () => {
    const side = claudeRows({ meta: meta("s"), parsed: parsed(claudeSessionText("s", "2.1.1", "m", healthy(1), { side: true })) });
    const sdk = claudeRows({ meta: meta("s"), parsed: parsed(claudeSessionText("s", "2.1.1", "m", healthy(1), { entrypoint: "sdk-py" })) });
    const cli = claudeRows({ meta: meta("s"), parsed: parsed(claudeSessionText("s", "2.1.1", "m", healthy(1), { entrypoint: "cli" })) });
    expect([isAutomated(side[0]!), isAutomated(sdk[0]!), isAutomated(cli[0]!)]).toEqual([true, true, false]);
  });

  it("rows come back in time order", () => {
    const text = claudeSessionText("s", "2.1.1", "m", [{ gap: 5, cr: 1 }, { gap: -3, cr: 2 }]);
    expect(claudeRows({ meta: meta("s"), parsed: parsed(text) }).map((r) => r.cr)).toEqual([2, 1]);
  });
});

describe("codexRequests", () => {
  it("tags each request with the file's Codex version and its uncached + output tokens", () => {
    const p = codexAgent.parseTranscript(codexRolloutText("cx1", "0.142.0-alpha.3", 0, 2, { turns: 2 }));
    if (!p.ok) throw new Error("parse");
    const reqs = codexRequests({ meta: meta("cx1", { cliVersion: "0.142.0-alpha.3", cwd: "/home/u/proj" }), parsed: p.value });
    expect(reqs).toHaveLength(2);
    expect(reqs[0]).toMatchObject({ sessionId: "cx1", version: "0.142.0", model: "gpt-5.5", tokens: 125_000, work: 20_000, cwd: "/home/u/proj" });
  });

  it("an unknown version is '?'", () => {
    const p = codexAgent.parseTranscript(codexRolloutText("cx2", "0.1.0", 0, 2, { turns: 1 }));
    if (!p.ok) throw new Error("parse");
    expect(codexRequests({ meta: meta("cx2"), parsed: p.value })[0]!.version).toBe("?");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/modules/regress/rows.test.ts`
Expected: FAIL: `Failed to load url ../../../src/modules/regress/rows.js`.

- [ ] **Step 4: Implement**

Create `src/modules/regress/rows.ts`:

```ts
/**
 * What the regress checks read from each deduped session (loadSessions
 * `analyze`). Pure.
 *
 * Claude Code: one row per API request (message.id + requestId, merged across
 * the lines of a request and deduped across files by loadSessions) that has a
 * usage block, a Claude Code version, and a real model (not "<synthetic>").
 * Codex: one request per turn with tokens, tagged with the Codex version line 1
 * of its file records.
 */
import type { LoadedSession } from "../agents/loadSessions.js";
import type { LimitRequest } from "../limits/attribute.js";
import { releaseOf } from "./catalog.js";

export interface ClaudeRow {
  /** First 8 characters of the session file's id. */
  readonly session: string;
  readonly version: string;
  readonly model: string;
  /** The line's entrypoint ("cli", "sdk-ts", ...); "?" when it has none. */
  readonly entry: string;
  /** Marked isSidechain: a subagent turn logged inside the main file. */
  readonly side: boolean;
  /** Epoch ms; 0 when the line has no valid timestamp. */
  readonly ts: number;
  /** Uncached input tokens. */
  readonly inp: number;
  /** Cache read tokens. */
  readonly cr: number;
  /** Cache write tokens (both TTLs). */
  readonly cw: number;
  /** Cache write tokens at the 5-minute TTL (0 when the split was not logged). */
  readonly c5: number;
  /** Cache write tokens at the 1-hour TTL. */
  readonly c1: number;
  readonly out: number;
  /** Context of the request: inp + cr + cw. */
  readonly ctx: number;
  /** The user line before the request held a tool_result. */
  readonly afterTool: boolean;
}

/** Subagent (sidechain) and Agent SDK (entrypoint sdk-*) requests: left out of every check. */
export function isAutomated(r: ClaudeRow): boolean {
  return r.side || r.entry.startsWith("sdk");
}

export function claudeRows({ meta, parsed }: LoadedSession): ClaudeRow[] {
  const session = meta.sessionId.slice(0, 8);
  const rows: ClaudeRow[] = [];
  for (const t of parsed.assistantTurns) {
    if (t.missingUsage || !t.version || t.model === "<synthetic>") continue;
    const c1 = t.cacheCreation1hTokens;
    const c5 = t.cacheSplitLogged ? Math.max(0, t.cacheCreationTokens - c1) : 0;
    const ts = t.timestamp ? Date.parse(t.timestamp) : Number.NaN;
    rows.push({
      session,
      version: t.version,
      model: t.model ?? "?",
      entry: t.entrypoint ?? "?",
      side: t.sidechain === true,
      ts: Number.isFinite(ts) ? ts : 0,
      inp: t.inputTokens,
      cr: t.cacheReadTokens,
      cw: t.cacheCreationTokens,
      c5,
      c1,
      out: t.outputTokens,
      ctx: t.inputTokens + t.cacheReadTokens + t.cacheCreationTokens,
      afterTool: t.afterToolResult === true,
    });
  }
  // Stable: requests logged with the same time keep their file order.
  return rows.sort((a, b) => a.ts - b.ts);
}

export interface CodexRequest extends LimitRequest {
  /** Codex version line 1 of the file records (pre-release suffix dropped); "?" when unknown. */
  readonly version: string;
  /** Uncached input + output tokens: the tokens most likely to drive limit use. */
  readonly work: number;
}

export function codexRequests({ meta, parsed }: LoadedSession): CodexRequest[] {
  const cwd = meta.cwd ?? parsed.cwd;
  const version = meta.cliVersion ? releaseOf(meta.cliVersion) : "?";
  const out: CodexRequest[] = [];
  for (const t of parsed.assistantTurns) {
    const at = t.timestamp === undefined ? Number.NaN : Date.parse(t.timestamp);
    const tokens = t.inputTokens + t.cacheReadTokens + t.cacheCreationTokens + t.outputTokens;
    if (!Number.isFinite(at) || tokens <= 0) continue;
    out.push({
      at,
      sessionId: meta.sessionId,
      cwd,
      model: t.model,
      tokens,
      version,
      work: t.inputTokens + t.cacheCreationTokens + t.outputTokens,
    });
  }
  return out;
}
```

- [ ] **Step 5: Run the test and the typecheck**

Run: `npx vitest run tests/modules/regress/rows.test.ts && npm run lint`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/regress/rows.ts tests/modules/regress/rows.test.ts tests/integration/regress-fixtures.ts
git commit -m "feat(regress): per-request rows from the deduped Claude Code and Codex sessions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The five Claude Code checks

**Files:**
- Create: `src/modules/regress/claude.ts`
- Test: `tests/modules/regress/claude.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/regress/claude.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { coverageOf, detectClaude } from "../../../src/modules/regress/claude.js";
import type { ClaudeRow } from "../../../src/modules/regress/rows.js";
import { healthy, type Turn } from "../../integration/regress-fixtures.js";

const T0 = Date.parse("2026-03-01T09:00:00Z");
const DAY = 86_400_000;

/** One session file's rows, built like claudeRows builds them from a transcript. */
function file(
  version: string,
  turns: readonly Turn[],
  o: { model?: string; day?: number; side?: boolean; entry?: string; session?: string } = {},
): ClaudeRow[] {
  let t = T0 + (o.day ?? 0) * DAY;
  return turns.map((x) => {
    t += (x.gap ?? 1) * 60_000;
    const c5 = x.c5 ?? 0;
    const c1 = x.c1 ?? 0;
    const inp = x.inp ?? 3;
    return {
      session: o.session ?? "sess0001",
      version,
      model: o.model ?? "claude-opus-4-8",
      entry: o.entry ?? "cli",
      side: o.side ?? false,
      ts: t,
      inp,
      cr: x.cr,
      cw: c5 + c1,
      c5,
      c1,
      out: x.out ?? 400,
      ctx: inp + x.cr + c5 + c1,
      afterTool: x.tool ?? true,
    };
  });
}

/** n back-to-back turns that each miss the cache (cache read stuck at 14,569). */
function missing(n: number): Turn[] {
  const out: Turn[] = [];
  let conv = 40e3;
  for (let i = 0; i < n; i++) {
    out.push({ gap: 1, cr: 14569, c1: conv });
    conv += 1500;
  }
  return out;
}

const ids = (r: ReturnType<typeof detectClaude>) => r.findings.map((f) => [f.id, f.from, f.to]);

describe("detectClaude: warm-cache-miss", () => {
  it("flags a version whose warm turns miss the cache, compared with the user's other versions", () => {
    const r = detectClaude([file("2.1.60", healthy(30)), file("2.1.76", missing(25), { day: 1 })]);
    expect(ids(r)).toEqual([["warm-cache-miss", "2.1.76", "2.1.76"]]);
    expect(r.findings[0]!.known.map((k) => k.id)).toEqual(["R2"]);
    expect(r.findings[0]!.evidence[0]).toBe(
      "v2.1.76: 100.0% of 24 warm turns were cache misses (your other versions: 0.0% of 29)  [matches known R2]",
    );
    expect(r.findings[0]!.examples).toHaveLength(3);
    expect(r.tables.warmCacheMiss.map((t) => [t.version, t.n])).toEqual([
      ["2.1.60", 29],
      ["2.1.76", 24],
    ]);
  });

  it("needs minN warm turns in the version", () => {
    const r = detectClaude([file("2.1.60", healthy(30)), file("2.1.76", missing(20), { day: 1 })]);
    expect(r.findings).toEqual([]);
    expect(detectClaude([file("2.1.60", healthy(30)), file("2.1.76", missing(20), { day: 1 })], 19).findings).toHaveLength(1);
  });

  it("a turn that shrank the context (compaction, /clear) is not a warm turn", () => {
    const turns: Turn[] = [];
    for (let i = 0; i < 25; i++) turns.push({ gap: 1, cr: 0, c1: i % 2 ? 100e3 : 50e3 });
    const r = detectClaude([file("2.1.60", healthy(30)), file("2.1.76", turns, { day: 1 })]);
    expect(r.tables.warmCacheMiss.find((t) => t.version === "2.1.76")).toBeUndefined();
  });
});

describe("detectClaude: post-idle-cold", () => {
  const coldAfterIdle = (): Turn[] => {
    const turns = healthy(10);
    let ctx = 70e3;
    for (let i = 0; i < 4; i++) {
      turns.push({ gap: i === 0 ? 70 : 1, cr: 0, c1: ctx });
      ctx += 3e3;
    }
    return turns;
  };

  it("flags a version where the cache stays cold after an idle break", () => {
    const files = [file("2.1.60", healthy(30, { idleAt: [15] }))];
    for (let j = 0; j < 5; j++) files.push(file("2.1.90", coldAfterIdle(), { day: 1 + j }));
    const r = detectClaude(files);
    // The cold turns are also warm-turn cache misses (R3 shows up in both checks).
    expect(ids(r)).toContainEqual(["post-idle-cold", "2.1.90", "2.1.90"]);
    expect(r.findings.find((f) => f.id === "post-idle-cold")!.known.map((k) => k.id)).toEqual(["R3"]);
  });

  it("needs max(5, minN/4) idle returns", () => {
    const files = [file("2.1.60", healthy(30, { idleAt: [15] }))];
    for (let j = 0; j < 4; j++) files.push(file("2.1.90", coldAfterIdle(), { day: 1 + j }));
    expect(detectClaude(files, 20).tables.postIdleCold.find((t) => t.version === "2.1.90")).toBeUndefined();
  });
});

describe("detectClaude: ttl-5m", () => {
  it("flags a version whose main-conversation writes are 5-minute while the others are 1-hour", () => {
    const r = detectClaude([file("2.1.60", healthy(30)), file("2.1.100", healthy(30, { ttl: "5m" }), { day: 1 })]);
    expect(ids(r)).toEqual([["ttl-5m", "2.1.100", "2.1.100"]]);
    expect(r.findings[0]!.note).toBe("If you use an API key, cloud provider or usage credits, 5-minute TTL is expected, not a bug.");
  });

  it("does not flag when no other version has minN requests (API-key users are 5-minute everywhere)", () => {
    expect(detectClaude([file("2.1.100", healthy(30, { ttl: "5m" }))]).findings).toEqual([]);
  });

  it("adjacent flagged versions merge into one range", () => {
    const r = detectClaude([
      file("2.1.60", healthy(30)),
      file("2.1.100", healthy(30, { ttl: "5m" }), { day: 1 }),
      file("2.1.105", healthy(30, { ttl: "5m" }), { day: 2 }),
      file("2.1.140", healthy(30), { day: 3 }),
      file("2.1.150", healthy(30), { day: 4 }),
      file("2.1.160", healthy(30), { day: 5 }),
    ]);
    expect(ids(r)).toEqual([["ttl-5m", "2.1.100", "2.1.105"]]);
  });
});

describe("detectClaude: uncached-input", () => {
  it("flags a model and version with a large median uncached input on tool-result turns", () => {
    const r = detectClaude([
      file("2.1.250", healthy(25, { inp: 5 }), { model: "claude-fable-5-1" }),
      file("2.1.258", healthy(25, { inp: 3200 }), { model: "claude-fable-5-1", day: 1 }),
    ]);
    expect(ids(r)).toEqual([["uncached-input", "2.1.258", "2.1.258"]]);
    expect(r.findings[0]!.evidence[0]).toContain("claude-fable-5-1 v2.1.258: median uncached input 3,200 tokens/turn over 25 tool-result turns (same model, other versions: 5)");
  });

  it("499 tokens is under the bar; a same-model baseline of 100 or more is not flagged", () => {
    expect(detectClaude([file("2.1.250", healthy(25, { inp: 5 })), file("2.1.258", healthy(25, { inp: 499 }), { day: 1 })]).findings).toEqual([]);
    expect(detectClaude([file("2.1.250", healthy(25, { inp: 100 })), file("2.1.258", healthy(25, { inp: 3200 }), { day: 1 })]).findings).toEqual([]);
  });

  it("a model seen in only one version is compared with no baseline (the prototype's rule)", () => {
    const r = detectClaude([file("2.1.258", healthy(25, { inp: 3200 }), { model: "claude-fable-5-1" })]);
    expect(r.findings[0]!.evidence[0]).toContain("(same model, other versions: no data)");
  });
});

describe("detectClaude: hourly-rebuild", () => {
  const rebuilding = (): Turn[] => {
    const turns: Turn[] = [];
    let ctx = 80e3;
    for (let i = 0; i < 240; i++) {
      const rebuild = i > 0 && i % 60 === 0;
      turns.push({ gap: 1, cr: rebuild ? 9e3 : ctx - 400, c1: rebuild ? ctx - 9e3 : 400 });
      ctx += 400;
    }
    return turns;
  };

  it("flags a version whose full rebuilds recur every 50 to 70 minutes", () => {
    // 240 turns rebuild at 60, 120 and 180: two 60-minute gaps per file; two files make the 4 gaps needed.
    const r = detectClaude([file("2.1.240", rebuilding()), file("2.1.240", rebuilding(), { day: 1 })]);
    expect(ids(r)).toEqual([["hourly-rebuild", "2.1.240", "2.1.240"]]);
    expect(r.findings[0]!.evidence[0]).toBe("v2.1.240: 4 of 4 gaps between full rebuilds were 50 to 70 minutes  [matches known R5]");
  });

  it("needs 4 gaps: one file with 2 is not flagged", () => {
    const r = detectClaude([file("2.1.240", rebuilding())]);
    expect(r.tables.hourlyRebuild).toEqual([{ version: "2.1.240", n: 2, hourly: 2 }]);
    expect(r.findings).toEqual([]);
  });
});

describe("detectClaude: scope", () => {
  it("subagent and Agent SDK requests are never compared", () => {
    const r = detectClaude([
      file("2.1.60", healthy(30)),
      file("2.1.201", healthy(30, { ttl: "5m" }), { day: 1, entry: "sdk-ts" }),
      file("2.1.201", healthy(30, { ttl: "5m" }), { day: 2, side: true }),
    ]);
    expect(r.findings).toEqual([]);
    expect(r.coverage).toMatchObject({ requests: 30, excludedAutomated: 60, versions: 1 });
  });

  it("coverage counts interactive requests, sessions, versions, dates and the catalog windows", () => {
    const c = coverageOf([file("2.1.60", healthy(3), { session: "a" }), file("2.1.258", healthy(2), { day: 10, session: "b" })]);
    expect(c).toEqual({
      requests: 5,
      excludedAutomated: 0,
      sessions: 2,
      versions: 2,
      firstVersion: "2.1.60",
      lastVersion: "2.1.258",
      from: "2026-03-01",
      to: "2026-03-11",
      knownWindowsCovered: ["R1", "R4", "R5"],
    });
  });

  it("comparable: two versions with minN or more interactive requests", () => {
    expect(detectClaude([file("2.1.60", healthy(30))]).comparable).toBe(false);
    expect(detectClaude([file("2.1.60", healthy(30)), file("2.1.61", healthy(19), { day: 1 })]).comparable).toBe(false);
    expect(detectClaude([file("2.1.60", healthy(30)), file("2.1.61", healthy(20), { day: 1 })]).comparable).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/modules/regress/claude.test.ts`
Expected: FAIL: `Failed to load url ../../../src/modules/regress/claude.js`.

- [ ] **Step 3: Implement**

Create `src/modules/regress/claude.ts` (thresholds and order exactly as the prototype; the header comment is the rule book):

```ts
/**
 * The five Claude Code checks. Pure.
 *
 * Each check compares one version's measure with the pooled measure of the
 * user's OTHER versions (their own baseline; no outside data). Only the
 * interactive main conversation is compared: subagent (sidechain) and Agent
 * SDK (entrypoint sdk-*) requests use a different cache policy by design and
 * would look like regressions. Rows of one file are one sequence, in time
 * order. Thresholds are the prototype's (prototypes/regress/regress.mjs on
 * the regress-prototype branch), unchanged:
 *
 * warm-cache-miss: back-to-back requests (0 to 5 min apart, context >= 30K
 *   and >= 60% of the previous one) where cache read < 30% of context. A
 *   version with >= minN such pairs is flagged when its miss rate is >= 25%
 *   and >= 3x max(rate of all other pairs, 1%).
 * post-idle-cold: a request >= 60 min after the previous one, followed by two
 *   back-to-back requests (<= 5 min apart, context >= 30K each); "cold" when
 *   both have cache read < 30% of context. Flagged at >= max(5, minN/4)
 *   returns when the cold rate is >= 50% and >= 3x max(other versions, 2%).
 * ttl-5m: share of cache-write tokens written with the 5-minute TTL, over
 *   requests that logged the split. Flagged at >= minN requests when the
 *   share is >= 50%, the request-weighted mean share of the other versions
 *   (each with >= minN requests) is <= 20%, and those have >= minN requests.
 * uncached-input: uncached input on requests right after a tool result with
 *   context >= 20K, per model and version. Flagged at >= max(5, minN/4)
 *   requests when the median is >= 500 tokens and the median of the same
 *   model's other versions' medians is < 100 (or there are none).
 * hourly-rebuild: "full rebuilds": back-to-back requests (<= 5 min) after a
 *   request with context >= 50K, keeping >= 60% of it, that read < 20% of
 *   the previous context from cache. Flagged when a version has >= 4 gaps
 *   between rebuilds of one file and >= half of them are 50 to 70 minutes.
 *
 * Adjacent flagged versions (in the check's version order) merge into one
 * finding.
 */
import { knownWindowsCovered, matchKnown, vcmp, type CheckId } from "./catalog.js";
import { fmtN, isoTime as iso, pct, upperMedian } from "./helpers.js";
import { isAutomated, type ClaudeRow } from "./rows.js";
import type { Finding } from "./types.js";

export const DEFAULT_MIN_N = 20;

export interface RateRow {
  readonly version: string;
  readonly n: number;
  readonly rate: number;
  /** Rate over every sample of the other versions (tabled or not). */
  readonly baseline: number;
  readonly baselineN: number;
}

export interface TtlRow {
  readonly version: string;
  readonly n: number;
  readonly share5m: number;
  /** Request-weighted mean share of the other tabled versions (0 when none). */
  readonly baseline: number;
}

export interface UncachedRow {
  readonly model: string;
  readonly version: string;
  readonly n: number;
  readonly median: number;
  /** Median of the same model's other versions' medians; null when there are none. */
  readonly baseline: number | null;
}

export interface HourlyRow {
  readonly version: string;
  /** Gaps between consecutive full rebuilds in one file. */
  readonly n: number;
  /** Gaps of 50 to 70 minutes. */
  readonly hourly: number;
}

export interface ClaudeTables {
  readonly warmCacheMiss: readonly RateRow[];
  readonly postIdleCold: readonly RateRow[];
  readonly ttl5m: readonly TtlRow[];
  readonly uncachedInput: readonly UncachedRow[];
  readonly hourlyRebuild: readonly HourlyRow[];
}

export interface ClaudeCoverage {
  /** Interactive main-conversation requests (the ones compared). */
  readonly requests: number;
  /** Subagent and Agent SDK requests left out. */
  readonly excludedAutomated: number;
  /** Session files with at least one interactive request. */
  readonly sessions: number;
  readonly versions: number;
  readonly firstVersion: string | null;
  readonly lastVersion: string | null;
  /** UTC dates (yyyy-mm-dd) of the first and last interactive request. */
  readonly from: string | null;
  readonly to: string | null;
  /** Catalog ids whose version range the logs include. */
  readonly knownWindowsCovered: readonly string[];
}

export interface ClaudeResult {
  readonly findings: readonly Finding[];
  readonly coverage: ClaudeCoverage;
  readonly tables: ClaudeTables;
  /** At least two versions have minN or more interactive requests. */
  readonly comparable: boolean;
}

interface Sample {
  readonly version: string;
  readonly value: boolean;
  readonly session: string;
  readonly ts: number;
  readonly cr: number;
  readonly cw: number;
  readonly ctx: number;
}

const MIN = 60_000;
function byVersion(samples: readonly Sample[]): Array<[string, Sample[]]> {
  const g = new Map<string, Sample[]>();
  for (const s of samples) {
    const list = g.get(s.version);
    if (list) list.push(s);
    else g.set(s.version, [s]);
  }
  return [...g.entries()].sort((a, b) => vcmp(a[0], b[0]));
}

interface RateRowWithExamples extends RateRow {
  readonly examples: readonly Sample[];
}

function rateTable(samples: readonly Sample[], minN: number): RateRowWithExamples[] {
  const total = samples.length;
  const hits = samples.filter((s) => s.value).length;
  return byVersion(samples)
    .filter(([, a]) => a.length >= minN)
    .map(([version, a]) => {
      const h = a.filter((s) => s.value).length;
      const restN = total - a.length;
      return {
        version,
        n: a.length,
        rate: h / a.length,
        baseline: restN ? (hits - h) / restN : 0,
        baselineN: restN,
        examples: a.filter((s) => s.value).slice(0, 3),
      };
    });
}

interface Range<T> {
  from: string;
  to: string;
  readonly rows: T[];
}

/** Flagged versions adjacent in `order` merge into one range. */
function mergeRanges<T extends { readonly version: string }>(rows: readonly T[], order: readonly string[]): Range<T>[] {
  const idx = new Map(order.map((v, i) => [v, i]));
  const out: Range<T>[] = [];
  for (const r of [...rows].sort((a, b) => vcmp(a.version, b.version))) {
    const last = out[out.length - 1];
    const at = idx.get(r.version);
    const lastAt = last ? idx.get(last.to) : undefined;
    if (last && at !== undefined && lastAt !== undefined && at === lastAt + 1) {
      last.to = r.version;
      last.rows.push(r);
    } else out.push({ from: r.version, to: r.version, rows: [r] });
  }
  return out;
}

function tag(check: CheckId, v: string): string {
  const k = matchKnown(check, v, v);
  return k.length ? `  [matches known ${k.map((x) => x.id).join(", ")}]` : "";
}

function finding(
  id: CheckId,
  title: string,
  rg: Range<unknown>,
  evidence: string[],
  examples: string[],
  note: string | null = null,
): Finding {
  return { id, agent: "claude-code", title, from: rg.from, to: rg.to, known: matchKnown(id, rg.from, rg.to), evidence, examples, note };
}

const strip = ({ version, n, rate, baseline, baselineN }: RateRowWithExamples): RateRow => ({
  version,
  n,
  rate,
  baseline,
  baselineN,
});

export function coverageOf(files: readonly (readonly ClaudeRow[])[]): ClaudeCoverage {
  const all = files.flat();
  const rows = all.filter((r) => !isAutomated(r));
  const versions = [...new Set(rows.map((r) => r.version))].sort(vcmp);
  const ts = rows.map((r) => r.ts).filter((t) => t > 0).sort((a, b) => a - b);
  return {
    requests: rows.length,
    excludedAutomated: all.length - rows.length,
    sessions: files.filter((f) => f.some((r) => !isAutomated(r))).length,
    versions: versions.length,
    firstVersion: versions[0] ?? null,
    lastVersion: versions[versions.length - 1] ?? null,
    from: ts.length ? iso(ts[0]!).slice(0, 10) : null,
    to: ts.length ? iso(ts[ts.length - 1]!).slice(0, 10) : null,
    knownWindowsCovered: knownWindowsCovered(versions),
  };
}

/** `files`: each session file's rows, in time order (claudeRows). */
export function detectClaude(files: readonly (readonly ClaudeRow[])[], minN = DEFAULT_MIN_N): ClaudeResult {
  const findings: Finding[] = [];
  const main = files.map((rows) => rows.filter((r) => !isAutomated(r))).filter((r) => r.length > 0);
  const smallN = Math.max(5, minN >> 2);

  // warm-cache-miss
  const warm: Sample[] = [];
  for (const rows of main) {
    for (let i = 1; i < rows.length; i++) {
      const p = rows[i - 1]!;
      const r = rows[i]!;
      const gapMin = (r.ts - p.ts) / MIN;
      if (gapMin < 0 || gapMin > 5 || r.ctx < 30e3 || r.ctx < 0.6 * p.ctx) continue;
      warm.push({ version: r.version, value: r.cr < 0.3 * r.ctx, session: r.session, ts: r.ts, cr: r.cr, cw: r.cw, ctx: r.ctx });
    }
  }
  const warmT = rateTable(warm, minN);
  const warmBad = warmT.filter((t) => t.rate >= 0.25 && t.rate >= 3 * Math.max(t.baseline, 0.01));
  for (const rg of mergeRanges(warmBad, warmT.map((t) => t.version))) {
    findings.push(
      finding(
        "warm-cache-miss",
        "Prompt cache missing on back-to-back turns",
        rg,
        rg.rows.map(
          (t) =>
            `v${t.version}: ${pct(t.rate)} of ${t.n} warm turns were cache misses (your other versions: ${pct(t.baseline)} of ${t.baselineN})` +
            tag("warm-cache-miss", t.version),
        ),
        rg.rows
          .flatMap((t) => t.examples)
          .slice(0, 3)
          .map((x) => `session ${x.session} ${iso(x.ts)} ctx=${fmtN(x.ctx)} cache_read=${fmtN(x.cr)} cache_write=${fmtN(x.cw)}`),
      ),
    );
  }

  // post-idle-cold
  const idle: Sample[] = [];
  for (const rows of main) {
    for (let i = 1; i + 2 < rows.length; i++) {
      if ((rows[i]!.ts - rows[i - 1]!.ts) / MIN < 60) continue;
      const a = rows[i + 1]!;
      const b = rows[i + 2]!;
      if ((a.ts - rows[i]!.ts) / MIN > 5 || (b.ts - a.ts) / MIN > 5 || a.ctx < 30e3 || b.ctx < 30e3) continue;
      idle.push({
        version: rows[i]!.version,
        value: a.cr < 0.3 * a.ctx && b.cr < 0.3 * b.ctx,
        session: rows[i]!.session,
        ts: rows[i]!.ts,
        cr: b.cr,
        cw: b.cw,
        ctx: b.ctx,
      });
    }
  }
  const idleT = rateTable(idle, smallN);
  const idleBad = idleT.filter((t) => t.rate >= 0.5 && t.rate >= 3 * Math.max(t.baseline, 0.02));
  for (const rg of mergeRanges(idleBad, idleT.map((t) => t.version))) {
    findings.push(
      finding(
        "post-idle-cold",
        "Cache stays cold for several turns after an idle break",
        rg,
        rg.rows.map(
          (t) =>
            `v${t.version}: ${pct(t.rate)} of ${t.n} idle returns stayed cold (other versions: ${pct(t.baseline)})` +
            tag("post-idle-cold", t.version),
        ),
        rg.rows
          .flatMap((t) => t.examples)
          .slice(0, 3)
          .map((x) => `session ${x.session} ${iso(x.ts)} 2 turns later cache_read=${fmtN(x.cr)} of ctx ${fmtN(x.ctx)}`),
      ),
    );
  }

  // ttl-5m
  const ttl = new Map<string, { c5: number; c1: number; n: number }>();
  for (const rows of main) {
    for (const r of rows) {
      if (r.c5 + r.c1 === 0) continue;
      const t = ttl.get(r.version) ?? { c5: 0, c1: 0, n: 0 };
      t.c5 += r.c5;
      t.c1 += r.c1;
      t.n++;
      ttl.set(r.version, t);
    }
  }
  const ttlBase = [...ttl.entries()]
    .sort((a, b) => vcmp(a[0], b[0]))
    .filter(([, t]) => t.n >= minN)
    .map(([version, t]) => ({ version, n: t.n, share5m: t.c5 / (t.c5 + t.c1) }));
  const all5 = ttlBase.reduce((a, r) => a + r.share5m * r.n, 0);
  const allN = ttlBase.reduce((a, r) => a + r.n, 0);
  const ttlRows: TtlRow[] = ttlBase.map((r) => {
    const restN = allN - r.n;
    return { ...r, baseline: restN ? (all5 - r.share5m * r.n) / restN : 0 };
  });
  const ttlBad = ttlRows.filter((r) => r.share5m >= 0.5 && r.baseline <= 0.2 && allN - r.n >= minN);
  for (const rg of mergeRanges(ttlBad, ttlRows.map((t) => t.version))) {
    findings.push(
      finding(
        "ttl-5m",
        "Main-conversation cache written with the 5-minute TTL instead of 1-hour",
        rg,
        rg.rows.map(
          (t) =>
            `v${t.version}: ${pct(t.share5m)} of cache writes were 5-minute over ${t.n} turns (other versions: ${pct(t.baseline)})` +
            tag("ttl-5m", t.version),
        ),
        [],
        "If you use an API key, cloud provider or usage credits, 5-minute TTL is expected, not a bug.",
      ),
    );
  }

  // uncached-input
  const unc = new Map<string, { model: string; version: string; rows: ClaudeRow[] }>();
  for (const rows of main) {
    for (const r of rows) {
      if (!r.afterTool || r.ctx < 20e3) continue;
      const k = `${r.model}\u0000${r.version}`;
      const g = unc.get(k) ?? { model: r.model, version: r.version, rows: [] };
      g.rows.push(r);
      unc.set(k, g);
    }
  }
  const uncGroups = [...unc.values()]
    .filter((g) => g.rows.length >= smallN)
    .map((g) => ({
      model: g.model,
      version: g.version,
      n: g.rows.length,
      median: upperMedian(g.rows.map((r) => r.inp)),
      ex: g.rows.filter((r) => r.inp > 500).slice(0, 3),
    }));
  const uncRows = uncGroups.map((g) => {
    const others = uncGroups.filter((o) => o.model === g.model && o.version !== g.version);
    return { ...g, baseline: others.length ? upperMedian(others.map((o) => o.median)) : null };
  });
  const uncBad = uncRows
    .filter((r) => r.median >= 500 && (r.baseline === null || r.baseline < 100))
    .sort((a, b) => vcmp(a.version, b.version));
  const uncOrder = [...new Set(uncRows.map((t) => t.version))].sort(vcmp);
  for (const rg of mergeRanges(uncBad, uncOrder)) {
    findings.push(
      finding(
        "uncached-input",
        "Large uncached input on tool-result turns (context not being cached)",
        rg,
        rg.rows.map(
          (t) =>
            `${t.model} v${t.version}: median uncached input ${fmtN(t.median)} tokens/turn over ${t.n} tool-result turns (same model, other versions: ${t.baseline === null ? "no data" : fmtN(t.baseline)})` +
            tag("uncached-input", t.version),
        ),
        rg.rows
          .flatMap((t) => t.ex)
          .slice(0, 3)
          .map((x) => `session ${x.session} ${iso(x.ts)} uncached_input=${fmtN(x.inp)} ctx=${fmtN(x.ctx)}`),
      ),
    );
  }

  // hourly-rebuild
  const hb = new Map<string, { iv: number[] }>();
  for (const rows of main) {
    let lastEv: number | null = null;
    for (let i = 1; i < rows.length; i++) {
      const p = rows[i - 1]!;
      const r = rows[i]!;
      if ((r.ts - p.ts) / MIN > 5 || p.ctx < 50e3 || r.ctx < 0.6 * p.ctx || r.cr >= 0.2 * p.ctx) continue;
      const g = hb.get(r.version) ?? { iv: [] };
      if (lastEv !== null) g.iv.push((r.ts - lastEv) / MIN);
      lastEv = r.ts;
      hb.set(r.version, g);
    }
  }
  const hbRows: HourlyRow[] = [...hb.entries()]
    .sort((a, b) => vcmp(a[0], b[0]))
    .map(([version, g]) => ({ version, n: g.iv.length, hourly: g.iv.filter((x) => x >= 50 && x <= 70).length }));
  const hbBad = hbRows.filter((r) => r.n >= 4 && r.hourly / r.n >= 0.5);
  for (const rg of mergeRanges(hbBad, hbRows.map((t) => t.version))) {
    findings.push(
      finding(
        "hourly-rebuild",
        "Whole prompt cache rebuilt about every hour",
        rg,
        rg.rows.map(
          (t) => `v${t.version}: ${t.hourly} of ${t.n} gaps between full rebuilds were 50 to 70 minutes` + tag("hourly-rebuild", t.version),
        ),
        [],
      ),
    );
  }

  const perVersion = new Map<string, number>();
  for (const rows of main) for (const r of rows) perVersion.set(r.version, (perVersion.get(r.version) ?? 0) + 1);
  return {
    findings,
    coverage: coverageOf(files),
    tables: {
      warmCacheMiss: warmT.map(strip),
      postIdleCold: idleT.map(strip),
      ttl5m: ttlRows,
      uncachedInput: uncRows.map(({ model, version, n, median, baseline }) => ({ model, version, n, median, baseline })),
      hourlyRebuild: hbRows,
    },
    comparable: [...perVersion.values()].filter((n) => n >= minN).length >= 2,
  };
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/modules/regress/claude.test.ts && npm run lint`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/regress/claude.ts tests/modules/regress/claude.test.ts
git commit -m "feat(regress): the five Claude Code checks, each version against your other versions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The Codex limit-burn check

**Files:**
- Create: `src/modules/regress/codex.ts`
- Test: `tests/modules/regress/codex.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/regress/codex.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LimitReading } from "../../../src/modules/agents/codex/rateLimits.js";
import { burnTable, detectCodex } from "../../../src/modules/regress/codex.js";
import type { CodexRequest } from "../../../src/modules/regress/rows.js";

const MIN = 60_000;
const W0 = Date.parse("2026-06-01T00:00:00Z");
const WEEK = 7 * 1440 * MIN;

interface Run {
  readonly readings: LimitReading[];
  readonly requests: CodexRequest[];
}

/**
 * `turns` requests of 20,000 work tokens (125,000 total) in week `week`, one a
 * minute; after each, a reading rising `pctPerM` percent per 1M work tokens
 * in whole percent.
 */
function week(
  version: string,
  w: number,
  pctPerM: number,
  o: { turns?: number; model?: string; plan?: string; windowMinutes?: number; session?: string } = {},
): Run {
  const { turns = 150, model = "gpt-5.5", plan = "plus", windowMinutes = 10_080, session = `s-${version}` } = o;
  const start = W0 + w * WEEK + 60 * MIN;
  const resetsAt = W0 + w * WEEK + windowMinutes * MIN;
  const readings: LimitReading[] = [];
  const requests: CodexRequest[] = [];
  for (let i = 0; i < turns; i++) {
    const at = start + (i + 1) * MIN;
    requests.push({ at, sessionId: session, cwd: "/p", model, tokens: 125_000, version, work: 20_000 });
    const used = Math.floor(((i + 1) * 20_000 * pctPerM) / 1e6 + 1e-9);
    readings.push({ at, sessionId: session, limitId: "codex", planType: plan, windowMinutes, slot: "primary", usedPercent: used, resetsAt });
  }
  return { readings, requests };
}

const join = (...runs: Run[]): Run => ({ readings: runs.flatMap((r) => r.readings), requests: runs.flatMap((r) => r.requests) });

describe("burnTable", () => {
  it("one row per version, model, plan and window, with percent per 1M work tokens", () => {
    const { readings, requests } = join(week("0.140.0", 0, 2), week("0.141.0", 1, 4));
    const t = burnTable(readings, requests);
    expect(t.map((r) => [r.version, r.model, r.plan, r.limitId, r.windowMinutes])).toEqual([
      ["0.140.0", "gpt-5.5", "plus", "codex", 10080],
      ["0.141.0", "gpt-5.5", "plus", "codex", 10080],
    ]);
    // 150 requests at 2% per 1M = 6%; requests after the last rise are not charged yet.
    expect(t[0]!.percent).toBeCloseTo(6, 9);
    expect(t[0]!.requests).toBe(150);
    expect(t[0]!.percentPerMillion).toBeCloseTo(2, 9);
    expect(t[1]!.percentPerMillion).toBeCloseTo(4, 9);
  });

  it("requests after a period's last rise are left out", () => {
    // 3% per 1M over 140 requests: the last rise (to 8%) is at request 134; requests 135 to 140 are not charged.
    const { readings, requests } = week("0.140.0", 0, 3, { turns: 140 });
    const [row] = burnTable(readings, requests);
    expect(row!.requests).toBe(134);
    expect(row!.percent).toBeCloseTo(8, 9);
    expect(row!.percentPerMillion).toBeCloseTo(row!.percent / (row!.workTokens / 1e6), 9);
  });

  it("groups under 200,000 work tokens are dropped", () => {
    const { readings, requests } = week("0.140.0", 0, 50, { turns: 9 });
    expect(burnTable(readings, requests)).toEqual([]);
  });

  it("a rise with no local request (another device) is not charged to any version", () => {
    const base = week("0.140.0", 0, 2);
    const other: LimitReading = { ...base.readings[0]!, at: base.readings[0]!.at - 30 * MIN, usedPercent: 0 };
    const jump: LimitReading = { ...base.readings[0]!, at: base.readings[0]!.at - 10 * MIN, usedPercent: 40 };
    const shifted = base.readings.map((r) => ({ ...r, usedPercent: r.usedPercent + 40 }));
    const t = burnTable([other, jump, ...shifted], base.requests);
    expect(t[0]!.percent).toBeCloseTo(6, 9);
  });
});

describe("detectCodex", () => {
  it("flags a version at 2x or more the median of the others on the same plan and window", () => {
    const { readings, requests } = join(week("0.140.0", 0, 2), week("0.141.0", 1, 2.2), week("0.142.0", 2, 25));
    const r = detectCodex(readings, requests);
    expect(r.findings.map((f) => [f.id, f.agent, f.from, f.to])).toEqual([["codex-limit-burn", "codex", "0.142.0", "0.142.0"]]);
    expect(r.findings[0]!.known).toEqual([]);
    expect(r.findings[0]!.evidence[0]).toMatch(
      /^v0\.142\.0 gpt-5\.5 \(plus, weekly window\): 25\.00% of the limit per 1M uncached\+output tokens vs 2\.\d\d% on your other versions \(\d+\.\dx\)$/,
    );
    expect(r.findings[0]!.note).toContain("A limit change on your plan at the same time as the update would look the same");
    expect(r.comparable).toBe(true);
  });

  it("does not flag under 2x", () => {
    const { readings, requests } = join(week("0.140.0", 0, 2), week("0.141.0", 1, 2.2), week("0.142.0", 2, 4.2));
    expect(detectCodex(readings, requests).findings).toEqual([]);
  });

  it("compares only within a plan and window: a lone window has no peers", () => {
    const { readings, requests } = join(week("0.140.0", 0, 2), week("0.142.0", 2, 25, { windowMinutes: 43_200, session: "s2" }));
    const r = detectCodex(readings, requests);
    expect(r.findings).toEqual([]);
    expect(r.comparable).toBe(false);
  });

  it("says when the plan's window changed and when the model differs from every peer", () => {
    const { readings, requests } = join(
      week("0.140.0", 0, 2),
      week("0.141.0", 1, 2.2),
      week("0.142.0", 2, 25, { model: "gpt-6.1-sol" }),
      week("0.143.0", 3, 2, { windowMinutes: 300, session: "s5" }),
      week("0.143.0", 4, 2, { windowMinutes: 300, session: "s6", model: "gpt-6.1-sol" }),
    );
    const f = detectCodex(readings, requests).findings.find((x) => x.from === "0.142.0")!;
    expect(f.note).toContain("Your plan's limit window changed during this period; only same-window versions were compared.");
    expect(f.note).toContain("This version ran a different model than your other versions; the model may explain the difference.");
  });

  it("coverage counts requests, sessions, versions, dates, readings and groups", () => {
    const { readings, requests } = join(week("0.140.0", 0, 2), week("0.141.0", 1, 2.2));
    expect(detectCodex(readings, requests).coverage).toEqual({
      requests: 300,
      sessions: 2,
      versions: 2,
      firstVersion: "0.140.0",
      lastVersion: "0.141.0",
      from: "2026-06-01",
      to: "2026-06-08",
      readings: 300,
      groups: 2,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/modules/regress/codex.test.ts`
Expected: FAIL: `Failed to load url ../../../src/modules/regress/codex.js`.

- [ ] **Step 3: Implement**

Create `src/modules/regress/codex.ts`:

```ts
/**
 * codex-limit-burn: how much of a Codex usage limit each Codex version used
 * per 1M uncached input + output tokens, compared with the user's other
 * versions on the same plan and limit window. Pure.
 *
 * Built on the limits module, not on per-file deltas: every reading of every
 * file goes into one account-wide series per limit window (buildPeriods), and
 * each rise of a period's percent is shared by the local requests made since
 * the previous rise, in proportion to their tokens (attribute). So a rise
 * seen by two concurrent sessions is counted once, and a rise with no request
 * on this computer (Codex on another device or in the cloud) is left out.
 * Requests after a period's last rise have not been charged yet and are left
 * out too.
 *
 * Group = Codex version (line 1 of the file, pre-release suffix dropped) +
 * model + plan (the period's newest reading) + limit id + window length. A
 * group counts with >= 200,000 work tokens. It is flagged when its percent
 * per 1M work tokens is >= 2x the median of the other counted groups with the
 * same plan, limit id and window length (any model, like the prototype; the
 * note says when no other group ran the same model).
 */
import type { LimitReading } from "../agents/codex/rateLimits.js";
import { attribute, type LimitRequest } from "../limits/attribute.js";
import { buildPeriods } from "../limits/periods.js";
import { windowLabel } from "../limits/report.js";
import { vcmp } from "./catalog.js";
import { isoTime, upperMedian } from "./helpers.js";
import type { CodexRequest } from "./rows.js";
import type { Finding } from "./types.js";

export const MIN_WORK_TOKENS = 200_000;
export const BURN_RATIO = 2;

export interface CodexBurnRow {
  readonly version: string;
  readonly model: string;
  readonly plan: string;
  readonly limitId: string;
  readonly windowMinutes: number;
  /** Requests charged with part of a rise. */
  readonly requests: number;
  /** Percent of the limit those requests used. */
  readonly percent: number;
  readonly workTokens: number;
  /** percent ÷ (workTokens / 1,000,000). */
  readonly percentPerMillion: number;
}

export interface CodexCoverage {
  /** Codex requests read (every request with tokens). */
  readonly requests: number;
  readonly sessions: number;
  readonly versions: number;
  readonly firstVersion: string | null;
  readonly lastVersion: string | null;
  readonly from: string | null;
  readonly to: string | null;
  /** Limit readings found in the logs. */
  readonly readings: number;
  /** Version / model groups with enough limit data (the table's rows). */
  readonly groups: number;
}

export interface CodexResult {
  readonly findings: readonly Finding[];
  readonly coverage: CodexCoverage;
  readonly table: readonly CodexBurnRow[];
  /** At least one counted group has another on the same plan, limit and window. */
  readonly comparable: boolean;
}

const CAVEAT =
  "Limits are shared with Codex on your other devices and in the cloud. A limit change on your plan at the same time as the update would look the same: run `sipcode limits` to see whether a limit may have shrunk.";

const sameWindow = (a: CodexBurnRow, b: CodexBurnRow): boolean =>
  a.plan === b.plan && a.limitId === b.limitId && a.windowMinutes === b.windowMinutes;

export function burnTable(readings: readonly LimitReading[], requests: readonly CodexRequest[]): CodexBurnRow[] {
  const byRef = new Map<LimitRequest, CodexRequest>(requests.map((r) => [r, r]));
  const groups = new Map<string, { row: Omit<CodexBurnRow, "requests" | "percent" | "workTokens" | "percentPerMillion">; requests: number; percent: number; work: number }>();
  for (const w of buildPeriods(readings)) {
    for (const period of w.periods) {
      let lastRise = Number.NEGATIVE_INFINITY;
      let max = 0;
      for (const p of period.points) {
        if (p.usedPercent > max) {
          max = p.usedPercent;
          lastRise = p.at;
        }
      }
      const plan = period.planType ?? "?";
      for (const share of attribute(period, requests).shares) {
        if (share.request.at > lastRise) continue;
        const r = byRef.get(share.request);
        if (!r) continue;
        const model = r.model ?? "?";
        const key = [r.version, model, plan, w.limitId, w.windowMinutes].join("\u0000");
        let g = groups.get(key);
        if (!g) {
          g = { row: { version: r.version, model, plan, limitId: w.limitId, windowMinutes: w.windowMinutes }, requests: 0, percent: 0, work: 0 };
          groups.set(key, g);
        }
        g.requests++;
        g.percent += share.percent;
        g.work += r.work;
      }
    }
  }
  return [...groups.values()]
    .filter((g) => g.work >= MIN_WORK_TOKENS)
    .map((g) => ({
      ...g.row,
      requests: g.requests,
      percent: g.percent,
      workTokens: g.work,
      percentPerMillion: g.percent / (g.work / 1e6),
    }))
    .sort(
      (a, b) =>
        vcmp(a.version, b.version) ||
        (a.model < b.model ? -1 : a.model > b.model ? 1 : 0) ||
        a.windowMinutes - b.windowMinutes ||
        (a.limitId < b.limitId ? -1 : a.limitId > b.limitId ? 1 : 0),
    );
}

function windowName(r: CodexBurnRow): string {
  const label = windowLabel(r.windowMinutes).toLowerCase();
  return r.limitId === "codex" ? `${label} window` : `${r.limitId} ${label} window`;
}

export function detectCodex(readings: readonly LimitReading[], requests: readonly CodexRequest[]): CodexResult {
  const table = burnTable(readings, requests);
  const findings: Finding[] = [];
  for (const r of table) {
    const peers = table.filter((o) => o !== r && sameWindow(o, r));
    if (peers.length === 0) continue;
    const base = upperMedian(peers.map((o) => o.percentPerMillion));
    if (!(base > 0 && r.percentPerMillion >= BURN_RATIO * base)) continue;
    const notes = [CAVEAT];
    if (table.some((o) => o.plan === r.plan && o.windowMinutes !== r.windowMinutes)) {
      notes.push("Your plan's limit window changed during this period; only same-window versions were compared.");
    }
    if (!peers.some((o) => o.model === r.model)) {
      notes.push("This version ran a different model than your other versions; the model may explain the difference.");
    }
    findings.push({
      id: "codex-limit-burn",
      agent: "codex",
      title: "Codex rate limit drains faster per token",
      from: r.version,
      to: r.version,
      known: [],
      evidence: [
        `v${r.version} ${r.model} (${r.plan}, ${windowName(r)}): ${r.percentPerMillion.toFixed(2)}% of the limit per 1M uncached+output tokens vs ${base.toFixed(2)}% on your other versions (${(r.percentPerMillion / base).toFixed(1)}x)`,
      ],
      examples: [],
      note: notes.join(" "),
    });
  }
  const versions = [...new Set(requests.map((r) => r.version))].sort(vcmp);
  const times = requests.map((r) => r.at).sort((a, b) => a - b);
  return {
    findings,
    coverage: {
      requests: requests.length,
      sessions: new Set(requests.map((r) => r.sessionId)).size,
      versions: versions.length,
      firstVersion: versions[0] ?? null,
      lastVersion: versions[versions.length - 1] ?? null,
      from: times.length ? isoTime(times[0]!).slice(0, 10) : null,
      to: times.length ? isoTime(times[times.length - 1]!).slice(0, 10) : null,
      readings: readings.length,
      groups: table.length,
    },
    table,
    comparable: table.some((r) => table.some((o) => o !== r && sameWindow(o, r))),
  };
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run tests/modules/regress/codex.test.ts && npm run lint`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/regress/codex.ts tests/modules/regress/codex.test.ts
git commit -m "feat(regress): Codex limit burn per version, on the account-wide limit periods" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Report, messages, terminal, JSON and bug-report output

**Files:**
- Modify: `src/lib/messages.ts` (before `codexNotSupportedYet`)
- Create: `src/modules/regress/report.ts`, `src/modules/regress/bug-report.ts`, `src/modules/regress/format-terminal.ts`, `src/modules/regress/format-json.ts`
- Test: `tests/modules/regress/format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/regress/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatBugReport } from "../../../src/modules/regress/bug-report.js";
import { formatRegressJson } from "../../../src/modules/regress/format-json.js";
import { formatRegressTerminal } from "../../../src/modules/regress/format-terminal.js";
import { buildRegressReport, type BuildRegressInput } from "../../../src/modules/regress/report.js";
import type { ClaudeRow } from "../../../src/modules/regress/rows.js";
import { healthy, type Turn } from "../../integration/regress-fixtures.js";

const T0 = Date.parse("2026-03-01T09:00:00Z");

function file(version: string, turns: readonly Turn[], day = 0): ClaudeRow[] {
  let t = T0 + day * 86_400_000;
  return turns.map((x) => {
    t += (x.gap ?? 1) * 60_000;
    const c5 = x.c5 ?? 0;
    const c1 = x.c1 ?? 0;
    const inp = x.inp ?? 3;
    return { session: "sess0001", version, model: "claude-opus-4-8", entry: "cli", side: false, ts: t, inp, cr: x.cr, cw: c5 + c1, c5, c1, out: 400, ctx: inp + x.cr + c5 + c1, afterTool: true };
  });
}

const NO_ACCESS_ISSUES = { missingDirs: [], unreadableFiles: 0, unreadableFolders: 0, skippedCompressed: 0 };

function report(over: Partial<BuildRegressInput> = {}) {
  return buildRegressReport({
    minN: 20,
    claudeDir: "/h/.claude/projects",
    codexDir: "/h/.codex",
    claude: [file("2.1.60", healthy(30)), file("2.1.61", healthy(30), 1), file("2.1.100", healthy(30, { ttl: "5m" }), 2), file("2.1.62", healthy(30), 3), file("2.1.63", healthy(30), 4)],
    codex: null,
    access: NO_ACCESS_ISSUES,
    ...over,
  });
}

const OPTS = { bugReport: false, version: "1.7.2" };

describe("formatRegressTerminal", () => {
  it("Claude Code only: no Codex line; a known finding has no signal-not-proof line", () => {
    const out = formatRegressTerminal(report(), OPTS);
    expect(out).not.toContain("Codex:");
    expect(out).toContain("● Main-conversation cache written with the 5-minute TTL instead of 1-hour  [ttl-5m]  Claude Code 2.1.100  = known R4");
    expect(out).not.toContain("signal worth reporting");
  });

  it("Codex only: no Claude Code or known-windows line", () => {
    const out = formatRegressTerminal(report({ claude: null, codex: { readings: [], requests: [] } }), OPTS);
    expect(out.split("\n").slice(0, 3)).toEqual([
      "sipcode regress · local only, no network",
      "Codex: no readable requests in /h/.codex",
      "",
    ]);
  });

  it("names compressed logs it skipped", () => {
    const out = formatRegressTerminal(report({ access: { ...NO_ACCESS_ISSUES, skippedCompressed: 2 } }), OPTS);
    expect(out).toContain("note: 2 compressed Codex log(s) (.jsonl.zst) skipped: Sipcode cannot read compressed logs yet.");
  });
});

describe("formatRegressJson", () => {
  it("has the schema, agents, coverage, access, findings and per-check tables", () => {
    const j = JSON.parse(formatRegressJson(report(), OPTS));
    expect(Object.keys(j)).toEqual(["schemaVersion", "agents", "minN", "coverage", "access", "comparable", "findings", "checks"]);
    expect(j.schemaVersion).toBe("sipcode-regress/1");
    expect(j.agents).toEqual(["claude-code"]);
    expect(j.coverage.codex).toBeNull();
    expect(j.findings[0]).toEqual({
      id: "ttl-5m",
      agent: "claude-code",
      title: "Main-conversation cache written with the 5-minute TTL instead of 1-hour",
      from: "2.1.100",
      to: "2.1.100",
      known: [{ id: "R4", what: "1-hour prompt cache TTL silently downgraded to 5 minutes", ref: "anthropics/claude-code#46829, CHANGELOG 2.1.108 + 2.1.129", fixed: "2.1.129" }],
      evidence: ["v2.1.100: 100.0% of cache writes were 5-minute over 30 turns (other versions: 0.0%)  [matches known R4]"],
      examples: [],
      note: "If you use an API key, cloud provider or usage credits, 5-minute TTL is expected, not a bug.",
    });
    expect(Object.keys(j.checks.claudeCode)).toEqual(["warmCacheMiss", "postIdleCold", "ttl5m", "uncachedInput", "hourlyRebuild"]);
  });
});

describe("formatBugReport", () => {
  it("null without findings; otherwise token counts, versions and the catalog match", () => {
    expect(formatBugReport(report({ claude: [file("2.1.60", healthy(30))] }), "1.7.2")).toBeNull();
    const b = formatBugReport(report(), "1.7.2")!;
    expect(b.split("\n").slice(0, 5)).toEqual([
      "### Main-conversation cache written with the 5-minute TTL instead of 1-hour",
      "",
      "**Detected by** sipcode regress 1.7.2 from local logs only (no data left the machine).",
      "**Affected Claude Code versions (from my logs):** 2.1.100",
      "**My data:** 150 requests, 5 sessions, 2026-03-01 to 2026-03-05",
    ]);
    expect(b).toContain("**Matches known issue:** R4 1-hour prompt cache TTL silently downgraded to 5 minutes (anthropics/claude-code#46829, CHANGELOG 2.1.108 + 2.1.129, fixed in 2.1.129)");
    expect(b).not.toContain("/h/");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/modules/regress/format.test.ts`
Expected: FAIL: `Failed to load url ../../../src/modules/regress/bug-report.js`.

- [ ] **Step 3: Add the messages**

In `src/lib/messages.ts` replace:

```ts
  codexNotSupportedYet: (command: string) =>
```

with:

```ts
  // ---- regress (v1.7.2) ----

  regressCursor: [
    `[E009] sipcode regress reads Claude Code and Codex logs only.`,
    ``,
    `why: Sipcode does not read Cursor's session logs.`,
    ``,
    `fix: run it without --agent, or with --agent claude-code or --agent codex.`,
    ``,
    `next: npx sipcode regress`,
  ].join("\n"),

  regressBadMinN: (raw: string) =>
    [
      `[E010] couldn't parse --min-n "${raw}".`,
      ``,
      `why: --min-n wants a whole number from 1 to 1000 (requests per version a check needs).`,
      ``,
      `fix: try --min-n 20 (the default).`,
      ``,
      `next: npx sipcode regress --min-n 20`,
    ].join("\n"),

  regressUnreadable: (n: number, claudeDir: string, codexDir: string) =>
    `WARNING: ${n} log file(s) or folder(s) could not be read. Results cover only what was readable. If this runs inside a sandbox (for example Codex), allow read access to ${claudeDir} and ${codexDir} and run it again.`,

  regressNothingToAnalyse:
    "Nothing to analyse: no Claude Code or Codex requests could be read. This is NOT a clean result.",

  regressNoFindings: "No regressions detected in your logs.",

  regressNotEnoughData: (minN: number) =>
    `Not enough data to compare versions yet: Claude Code needs 2 versions with ${minN} or more requests each, Codex needs 2 versions with 200,000 or more tokens on the same plan and limit window. This is not a clean result.`,

  regressSignalNotProof:
    "A finding that is not in the known-issue catalog is a signal worth reporting, not proof of a bug.",

  codexNotSupportedYet: (command: string) =>
```

- [ ] **Step 4: Write the report**

Create `src/modules/regress/report.ts`:

```ts
/**
 * The `sipcode regress` report: both agents' checks and what could not be
 * read. Pure.
 *
 * "Nothing read" (exit code 2) = no interactive Claude Code request and no
 * Codex request was read, from the agents asked for. It is never reported as
 * a clean result: a sandbox that blocks the log folders looks exactly like it.
 */
import type { LimitReading } from "../agents/codex/rateLimits.js";
import { detectClaude, type ClaudeResult } from "./claude.js";
import { detectCodex, type CodexResult } from "./codex.js";
import type { ClaudeRow, CodexRequest } from "./rows.js";
import type { Finding } from "./types.js";

export type RegressAgent = "claude-code" | "codex";

export interface RegressAccess {
  /** Log folders that do not exist (or that a sandbox hides). */
  readonly missingDirs: readonly string[];
  /** Log files that could not be read or parsed. */
  readonly unreadableFiles: number;
  /** Log folders that could not be listed. */
  readonly unreadableFolders: number;
  /** Compressed Codex logs (.jsonl.zst) skipped on purpose. */
  readonly skippedCompressed: number;
}

export interface RegressReport {
  readonly agents: readonly RegressAgent[];
  readonly minN: number;
  /** Claude Code's projects folder and Codex's home folder, as read. */
  readonly claudeDir: string;
  readonly codexDir: string;
  /** null when the agent was not asked for. */
  readonly claude: ClaudeResult | null;
  readonly codex: CodexResult | null;
  readonly access: RegressAccess & { readonly nothingRead: boolean };
  /** Claude Code findings, then Codex findings. */
  readonly findings: readonly Finding[];
  /** At least one check had versions to compare. */
  readonly comparable: boolean;
}

export interface BuildRegressInput {
  readonly minN: number;
  readonly claudeDir: string;
  readonly codexDir: string;
  /** Each Claude Code session file's rows; null when Claude Code was not asked for. */
  readonly claude: readonly (readonly ClaudeRow[])[] | null;
  readonly codex: { readonly readings: readonly LimitReading[]; readonly requests: readonly CodexRequest[] } | null;
  readonly access: RegressAccess;
}

export function buildRegressReport(input: BuildRegressInput): RegressReport {
  const claude = input.claude ? detectClaude(input.claude, input.minN) : null;
  const codex = input.codex ? detectCodex(input.codex.readings, input.codex.requests) : null;
  const agents: RegressAgent[] = [];
  if (claude) agents.push("claude-code");
  if (codex) agents.push("codex");
  const nothingRead = (claude?.coverage.requests ?? 0) === 0 && (codex?.coverage.requests ?? 0) === 0;
  return {
    agents,
    minN: input.minN,
    claudeDir: input.claudeDir,
    codexDir: input.codexDir,
    claude,
    codex,
    access: { ...input.access, nothingRead },
    findings: [...(claude?.findings ?? []), ...(codex?.findings ?? [])],
    comparable: (claude?.comparable ?? false) || (codex?.comparable ?? false),
  };
}
```

- [ ] **Step 5: Write the bug-report block**

Create `src/modules/regress/bug-report.ts`:

```ts
/**
 * The `--bug-report` block: one GitHub-issue-ready section per finding.
 * Token counts, versions, dates and short session ids only; never prompts,
 * code, paths or commands. Pure.
 */
import { fmtN } from "./helpers.js";
import type { RegressReport } from "./report.js";
import type { Finding } from "./types.js";

function myData(f: Finding, report: RegressReport): string {
  if (f.agent === "claude-code") {
    const c = report.claude?.coverage;
    return c ? `${fmtN(c.requests)} requests, ${fmtN(c.sessions)} sessions, ${c.from} to ${c.to}` : "Claude Code sessions";
  }
  const c = report.codex?.coverage;
  return c ? `${fmtN(c.requests)} Codex requests, ${fmtN(c.sessions)} sessions, ${c.from} to ${c.to}` : "Codex sessions";
}

function section(f: Finding, report: RegressReport, version: string): string {
  const tool = f.agent === "claude-code" ? "Claude Code" : "Codex";
  return [
    `### ${f.title}`,
    "",
    `**Detected by** sipcode regress ${version} from local logs only (no data left the machine).`,
    `**Affected ${tool} versions (from my logs):** ${f.from}${f.to !== f.from ? ` to ${f.to}` : ""}`,
    `**My data:** ${myData(f, report)}`,
    "",
    "**Evidence**",
    ...f.evidence.map((e) => `- ${e}`),
    ...(f.examples.length ? ["", "**Sample requests (token counts only)**", ...f.examples.map((e) => `- ${e}`)] : []),
    ...(f.known.length
      ? ["", `**Matches known issue:** ${f.known.map((k) => `${k.id} ${k.what} (${k.ref}, fixed in ${k.fixed})`).join("; ")}`]
      : []),
    ...(f.note ? ["", `_Note: ${f.note}_`] : []),
    "",
  ].join("\n");
}

/** The block, or null when there are no findings. */
export function formatBugReport(report: RegressReport, version: string): string | null {
  if (report.findings.length === 0) return null;
  return report.findings.map((f) => section(f, report, version)).join("\n");
}
```

- [ ] **Step 6: Write the terminal and JSON formatters**

Create `src/modules/regress/format-terminal.ts`:

```ts
/** Terminal renderer for `sipcode regress`. Pure. */
import { MESSAGES } from "../../lib/messages.js";
import { compressedSkippedMessage } from "../agents/loadSessions.js";
import { formatBugReport } from "./bug-report.js";
import { fmtN } from "./helpers.js";
import type { RegressReport } from "./report.js";
import type { Finding } from "./types.js";

function claudeLine(report: RegressReport): string {
  const c = report.claude!.coverage;
  if (c.requests === 0) return `Claude Code: no readable interactive requests in ${report.claudeDir}`;
  return (
    `Claude Code: ${fmtN(c.requests)} interactive requests in ${fmtN(c.sessions)} sessions ` +
    `(${fmtN(c.excludedAutomated)} subagent and Agent SDK requests left out of the comparison), ` +
    `${c.from} to ${c.to}, versions ${c.firstVersion} to ${c.lastVersion}`
  );
}

function codexLine(report: RegressReport): string {
  const c = report.codex!.coverage;
  if (c.requests === 0) return `Codex: no readable requests in ${report.codexDir}`;
  return (
    `Codex: ${fmtN(c.requests)} requests in ${fmtN(c.sessions)} sessions, ${c.from} to ${c.to}, ` +
    `versions ${c.firstVersion} to ${c.lastVersion}, ${fmtN(c.groups)} version/model groups with enough limit data`
  );
}

function findingLines(f: Finding): string[] {
  const tool = f.agent === "claude-code" ? "Claude Code" : "Codex";
  const range = f.to !== f.from ? `${f.from} to ${f.to}` : f.from;
  const known = f.known.length ? `  = known ${f.known.map((k) => k.id).join(", ")}` : "  (not in the known-issue catalog)";
  return [
    `● ${f.title}  [${f.id}]  ${tool} ${range}${known}`,
    ...f.evidence.map((e) => `    ${e}`),
    ...f.examples.map((e) => `    e.g. ${e}`),
    ...(f.note ? [`    note: ${f.note}`] : []),
  ];
}

export function formatRegressTerminal(
  report: RegressReport,
  opts: { readonly bugReport: boolean; readonly version: string },
): string {
  const lines = ["sipcode regress · local only, no network"];
  if (report.claude) {
    lines.push(claudeLine(report));
    const k = report.claude.coverage.knownWindowsCovered;
    lines.push(`Known-regression windows your logs cover: ${k.length ? k.join(", ") : "none"}`);
  }
  if (report.codex) lines.push(codexLine(report));
  const a = report.access;
  for (const d of a.missingDirs) lines.push(`Not found or not readable: ${d}`);
  const unreadable = a.unreadableFiles + a.unreadableFolders;
  if (unreadable > 0) lines.push(MESSAGES.regressUnreadable(unreadable, report.claudeDir, report.codexDir));
  if (a.skippedCompressed > 0) lines.push(`note: ${compressedSkippedMessage(a.skippedCompressed)}`);
  lines.push("");
  if (a.nothingRead) {
    lines.push(MESSAGES.regressNothingToAnalyse);
    return lines.join("\n");
  }
  if (report.findings.length === 0) {
    lines.push(report.comparable ? MESSAGES.regressNoFindings : MESSAGES.regressNotEnoughData(report.minN));
    return lines.join("\n");
  }
  for (const f of report.findings) lines.push(...findingLines(f));
  if (report.findings.some((f) => f.known.length === 0)) lines.push("", MESSAGES.regressSignalNotProof);
  if (opts.bugReport) {
    lines.push("", "---- paste into a GitHub issue (review it first) ----", "", formatBugReport(report, opts.version)!);
  }
  return lines.join("\n");
}
```

Create `src/modules/regress/format-json.ts`:

```ts
/**
 * JSON renderer for `sipcode regress --json`. Pure. `checks` carries every
 * check's per-version table (scripts/verify-counts.mjs compares them);
 * `bugReport` is present only with --bug-report (null when no findings).
 */
import { formatBugReport } from "./bug-report.js";
import type { RegressReport } from "./report.js";

export function formatRegressJson(
  report: RegressReport,
  opts: { readonly bugReport: boolean; readonly version: string },
): string {
  return JSON.stringify(
    {
      schemaVersion: "sipcode-regress/1",
      agents: report.agents,
      minN: report.minN,
      coverage: {
        claudeCode: report.claude ? report.claude.coverage : null,
        codex: report.codex ? report.codex.coverage : null,
      },
      access: report.access,
      comparable: report.comparable,
      findings: report.findings.map((f) => ({
        id: f.id,
        agent: f.agent,
        title: f.title,
        from: f.from,
        to: f.to,
        known: f.known.map((k) => ({ id: k.id, what: k.what, ref: k.ref, fixed: k.fixed })),
        evidence: f.evidence,
        examples: f.examples,
        note: f.note,
      })),
      checks: {
        claudeCode: report.claude ? report.claude.tables : null,
        codex: report.codex ? report.codex.table : null,
      },
      ...(opts.bugReport ? { bugReport: formatBugReport(report, opts.version) } : {}),
    },
    null,
    2,
  );
}
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `npx vitest run tests/modules/regress && npm run lint`
Expected: PASS (all regress unit tests, 42).

- [ ] **Step 8: Commit**

```bash
git add src/lib/messages.ts src/modules/regress/report.ts src/modules/regress/bug-report.ts src/modules/regress/format-terminal.ts src/modules/regress/format-json.ts tests/modules/regress/format.test.ts
git commit -m "feat(regress): report, terminal and JSON output, GitHub-ready bug report" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The `sipcode regress` command

**Files:**
- Create: `src/modules/regress/load.ts`, `src/commands/regress.ts`
- Modify: `src/cli.ts` (before the `trend` command)
- Modify: `tests/e2e/release-smoke.test.ts:200-201`
- Test: `tests/integration/regress.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/regress.integration.test.ts`:

```ts
/** `sipcode regress` end to end on in-memory Claude Code and Codex logs. */
import { describe, expect, it } from "vitest";
import { runRegress } from "../../src/commands/regress.js";
import { InMemoryFs, type FileSystem } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import {
  addClaudeDataset,
  addClaudeSession,
  addCodexDataset,
  addCodexRollout,
  CLAUDE_PROJECT,
  claudeSessionText,
  healthy,
  HOME,
} from "./regress-fixtures.js";

const NOW = new Date("2026-10-12T10:00:00.000Z");

async function run(opts: Parameters<typeof runRegress>[0], fs: FileSystem) {
  const out: string[] = [];
  const err: string[] = [];
  const r = await runRegress(opts, {
    fs,
    env: new FakeProcessEnv({ homeDir: HOME, platform: "linux", vars: { NO_COLOR: "1" } }),
    clock: new FakeClock(NOW),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    version: "1.7.2",
  });
  return { exitCode: r.exitCode, out: out.join("\n"), err: err.join("\n") };
}

function dataset(dirty: boolean): InMemoryFs {
  const fs = new InMemoryFs();
  addClaudeDataset(fs, { dirty });
  addCodexDataset(fs, { dirty });
  return fs;
}

/** Fails listing or reading the paths `fail` names, like a sandbox that blocks them. */
function blocked(base: InMemoryFs, fail: (p: string) => boolean): FileSystem {
  const guard = (p: string) => {
    if (fail(p.replace(/\\/g, "/"))) throw Object.assign(new Error(`EACCES: ${p}`), { code: "EACCES" });
  };
  return {
    exists: (p) => base.exists(p),
    readFile: async (p) => (guard(p), base.readFile(p)),
    readHead: async (p, n) => (guard(p), base.readHead(p, n)),
    readDir: async (p) => (guard(p), base.readDir(p)),
    stat: (p) => base.stat(p),
  };
}

describe("sipcode regress: ground truth (the prototype's confirmed regressions)", () => {
  it("every confirmed regression fires and maps to its known issue; the Codex drain fires", async () => {
    const r = await run({ json: true }, dataset(true));
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(r.out);
    const got = (id: string) => j.findings.find((f: { id: string }) => f.id === id);
    const expected: Array<[string, string | null, string, string]> = [
      // 2.1.90 (R3) also misses the cache on 25% of its warm turns, next to 2.1.76: one range.
      ["warm-cache-miss", "R2", "2.1.76", "2.1.90"],
      ["post-idle-cold", "R3", "2.1.90", "2.1.90"],
      ["ttl-5m", "R4", "2.1.100", "2.1.105"],
      ["uncached-input", "R1", "2.1.258", "2.1.258"],
      ["hourly-rebuild", "R5", "2.1.240", "2.1.240"],
      ["codex-limit-burn", null, "0.142.0", "0.142.0"],
    ];
    for (const [id, known, from, to] of expected) {
      const f = got(id);
      expect(f, id).toBeDefined();
      expect([f.from, f.to], id).toEqual([from, to]);
      if (known) expect(f.known.map((k: { id: string }) => k.id), id).toContain(known);
      else expect(f.known, id).toEqual([]);
    }
    expect(j.findings).toHaveLength(6);
  });

  it("the clean dataset produces zero findings and says so", async () => {
    const fs = dataset(false);
    const j = JSON.parse((await run({ json: true }, fs)).out);
    expect(j.findings).toEqual([]);
    expect(j.comparable).toBe(true);
    const t = await run({}, fs);
    expect(t.exitCode).toBe(0);
    expect(t.out).toContain("No regressions detected in your logs.");
  });

  it("coverage: interactive requests only; subagent and Agent SDK requests are counted apart", async () => {
    const j = JSON.parse((await run({ json: true }, dataset(false))).out);
    // 6 healthy versions x (3 x 30 + 25) requests; the SDK and sidechain sessions (2 x 30) are left out.
    expect(j.coverage.claudeCode).toEqual({
      requests: 690,
      excludedAutomated: 60,
      sessions: 24,
      versions: 6,
      firstVersion: "2.1.60",
      lastVersion: "2.1.262",
      from: "2026-03-01",
      to: "2026-04-25",
      knownWindowsCovered: ["R3", "R4", "R5"],
    });
    expect(j.coverage.codex).toMatchObject({ requests: 450, sessions: 3, versions: 3, firstVersion: "0.140.0", lastVersion: "0.142.0", groups: 3 });
    expect(j.access).toEqual({ missingDirs: [], unreadableFiles: 0, unreadableFolders: 0, skippedCompressed: 0, nothingRead: false });
  });

  it("a request copied into a resumed session file counts once", async () => {
    const fs = dataset(false);
    const before = JSON.parse((await run({ json: true }, fs)).out).coverage.claudeCode.requests;
    const original = await fs.readFile(`${CLAUDE_PROJECT}/sess0001-0000-4000-8000-000000000000.jsonl`);
    fs.writeFile(`${CLAUDE_PROJECT}/resumed-copy.jsonl`, original, Date.parse("2026-09-01T00:00:00Z"));
    const after = JSON.parse((await run({ json: true }, fs)).out).coverage.claudeCode.requests;
    expect(after).toBe(before);
  });
});

describe("sipcode regress: terminal output", () => {
  it("prints the coverage lines, each finding, the catalog status and the signal-not-proof line", async () => {
    const r = await run({}, dataset(true));
    expect(r.exitCode).toBe(0);
    const lines = r.out.split("\n");
    expect(lines[0]).toBe("sipcode regress · local only, no network");
    expect(lines[1]).toMatch(/^Claude Code: [\d,]+ interactive requests in \d+ sessions \(60 subagent and Agent SDK requests left out of the comparison\), 2026-03-01 to 2026-\d\d-\d\d, versions 2\.1\.60 to 2\.1\.262$/);
    expect(lines[2]).toBe("Known-regression windows your logs cover: R1, R2, R3, R4, R5");
    expect(lines[3]).toMatch(/^Codex: 450 requests in 3 sessions, 2026-06-01 to 2026-06-15, versions 0\.140\.0 to 0\.142\.0, 3 version\/model groups with enough limit data$/);
    expect(r.out).toContain("● Prompt cache missing on back-to-back turns  [warm-cache-miss]  Claude Code 2.1.76 to 2.1.90  = known R2, R3");
    expect(r.out).toContain("● Main-conversation cache written with the 5-minute TTL instead of 1-hour  [ttl-5m]  Claude Code 2.1.100 to 2.1.105  = known R4");
    expect(r.out).toContain("● Codex rate limit drains faster per token  [codex-limit-burn]  Codex 0.142.0  (not in the known-issue catalog)");
    expect(r.out).toContain("A finding that is not in the known-issue catalog is a signal worth reporting, not proof of a bug.");
    expect(r.out).toContain("run `sipcode limits` to see whether a limit may have shrunk");
    expect(r.out).not.toContain("---- paste into a GitHub issue");
    expect(r.out).not.toMatch(/[\u2013\u2014]/);
  });

  it("--bug-report adds one GitHub-ready section per finding, token counts only", async () => {
    const r = await run({ bugReport: true }, dataset(true));
    expect(r.out).toContain("---- paste into a GitHub issue (review it first) ----");
    expect(r.out).toContain("### Prompt cache missing on back-to-back turns");
    expect(r.out).toContain("**Detected by** sipcode regress 1.7.2 from local logs only (no data left the machine).");
    expect(r.out).toContain("**Affected Claude Code versions (from my logs):** 2.1.100 to 2.1.105");
    expect(r.out).toContain("**Affected Codex versions (from my logs):** 0.142.0");
    expect(r.out).toContain("**Matches known issue:** R2 --resume full prompt-cache miss");
    expect(r.out).not.toContain(HOME);
  });

  it("--json --bug-report carries the block; without findings it is null", async () => {
    const dirty = JSON.parse((await run({ json: true, bugReport: true }, dataset(true))).out);
    expect(dirty.bugReport).toContain("### Codex rate limit drains faster per token");
    const clean = JSON.parse((await run({ json: true, bugReport: true }, dataset(false))).out);
    expect(clean.bugReport).toBeNull();
    const plain = JSON.parse((await run({ json: true }, dataset(true))).out);
    expect("bugReport" in plain).toBe(false);
  });
});

describe("sipcode regress: nothing read is never a clean result", () => {
  it("no logs at all: exit 2, 'Nothing to analyse', both folders named", async () => {
    const r = await run({}, new InMemoryFs());
    expect(r.exitCode).toBe(2);
    expect(r.out).toMatch(/Not found or not readable: [\\/]home[\\/]u[\\/]\.claude[\\/]projects/);
    expect(r.out).toMatch(/Not found or not readable: [\\/]home[\\/]u[\\/]\.codex[\\/]sessions/);
    expect(r.out).toContain("Nothing to analyse: no Claude Code or Codex requests could be read. This is NOT a clean result.");
    expect(r.out).not.toContain("No regressions detected");
  });

  it("--json: exit 2 and access.nothingRead", async () => {
    const r = await run({ json: true }, new InMemoryFs());
    expect(r.exitCode).toBe(2);
    const j = JSON.parse(r.out);
    expect(j.access.nothingRead).toBe(true);
    expect(j.access.missingDirs).toHaveLength(2);
    expect(j.findings).toEqual([]);
  });

  it("a sandbox that blocks the Claude Code folder: counted, warned, and exit 2 when nothing else is readable", async () => {
    const mem = new InMemoryFs();
    addClaudeDataset(mem, { dirty: true });
    const fs = blocked(mem, (p) => p.startsWith("/home/u/.claude"));
    const r = await run({ agent: "claude-code" }, fs);
    expect(r.exitCode).toBe(2);
    expect(r.out).toContain("WARNING: 1 log file(s) or folder(s) could not be read.");
    expect(r.out).toContain("If this runs inside a sandbox (for example Codex), allow read access to");
    expect(r.out).toContain("This is NOT a clean result.");
  });

  it("an unreadable file is counted and the result is marked partial", async () => {
    const mem = dataset(false);
    const fs = blocked(mem, (p) => p.endsWith("sess0002-0000-4000-8000-000000000000.jsonl"));
    const r = await run({ json: true }, fs);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.out).access.unreadableFiles).toBe(1);
    const t = await run({}, fs);
    expect(t.out).toContain("WARNING: 1 log file(s) or folder(s) could not be read.");
  });

  it("logs with too little data: not a clean result either", async () => {
    const fs = new InMemoryFs();
    addClaudeSession(fs, "only-0000-4000-8000-000000000000", "2.1.200", "claude-opus-4-8", healthy(10));
    const r = await run({}, fs);
    expect(r.exitCode).toBe(0);
    expect(r.out).toContain(
      "Not enough data to compare versions yet: Claude Code needs 2 versions with 20 or more requests each, Codex needs 2 versions with 200,000 or more tokens on the same plan and limit window. This is not a clean result.",
    );
    expect(r.out).not.toContain("No regressions detected");
    expect(JSON.parse((await run({ json: true }, fs)).out).comparable).toBe(false);
  });
});

describe("sipcode regress: flags", () => {
  it("--agent codex reads only Codex; --agent claude-code only Claude Code", async () => {
    const fs = dataset(true);
    const cx = JSON.parse((await run({ json: true, agent: "codex" }, fs)).out);
    expect(cx.agents).toEqual(["codex"]);
    expect(cx.coverage.claudeCode).toBeNull();
    expect(cx.findings.map((f: { id: string }) => f.id)).toEqual(["codex-limit-burn"]);
    const cc = JSON.parse((await run({ json: true, agent: "claude-code" }, fs)).out);
    expect(cc.agents).toEqual(["claude-code"]);
    expect(cc.coverage.codex).toBeNull();
    expect(cc.findings).toHaveLength(5);
  });

  it("--agent cursor stops with E009; an unknown agent is rejected", async () => {
    const c = await run({ agent: "cursor" }, dataset(false));
    expect(c.exitCode).toBe(1);
    expect(c.err).toContain("[E009] sipcode regress reads Claude Code and Codex logs only.");
    const u = await run({ agent: "gemini" }, dataset(false));
    expect(u.exitCode).toBe(1);
    expect(u.err).toContain("gemini");
  });

  it("--min-n must be a whole number from 1 to 1000", async () => {
    for (const bad of ["0", "abc", "2.5", "1001"]) {
      const r = await run({ minN: bad }, dataset(false));
      expect(r.exitCode, bad).toBe(1);
      expect(r.err, bad).toContain(`[E010] couldn't parse --min-n "${bad}".`);
    }
    const ok = JSON.parse((await run({ json: true, minN: "40" }, dataset(false))).out);
    expect(ok.minN).toBe(40);
  });

  it("a larger --min-n drops versions below it from the tables", async () => {
    const fs = dataset(true);
    const low = JSON.parse((await run({ json: true, minN: "20" }, fs)).out);
    const high = JSON.parse((await run({ json: true, minN: "500" }, fs)).out);
    expect(low.checks.claudeCode.warmCacheMiss.length).toBeGreaterThan(0);
    expect(high.checks.claudeCode.warmCacheMiss).toEqual([]);
  });
});

describe("sipcode regress: Codex", () => {
  it("a rise with no request on this computer is left out (other devices)", async () => {
    const fs = new InMemoryFs();
    addCodexDataset(fs, { dirty: false });
    // Another device's use: a reading in week 1 rising 30% with no local request before it.
    const id = "0199a000-0000-7000-8000-0000000000ff";
    fs.writeFile(
      `${HOME}/.codex/sessions/2026/06/09/rollout-other-${id}.jsonl`,
      [
        JSON.stringify({ timestamp: "2026-06-08T00:30:00.000Z", type: "session_meta", payload: { id, session_id: id, cwd: "/x", cli_version: "0.141.0" } }),
        JSON.stringify({
          timestamp: "2026-06-08T00:30:00.000Z",
          type: "event_msg",
          payload: { type: "token_count", info: null, rate_limits: { limit_id: "codex", plan_type: "plus", primary: { used_percent: 30, window_minutes: 10080, resets_at: Date.parse("2026-06-15T00:00:00Z") / 1000 }, secondary: null } },
        }),
      ].join("\n"),
      Date.parse("2026-06-08T00:31:00Z"),
    );
    const j = JSON.parse((await run({ json: true, agent: "codex" }, fs)).out);
    expect(j.findings).toEqual([]);
  });

  it("the table carries percent, work tokens and percent per 1M for each group", async () => {
    const j = JSON.parse((await run({ json: true, agent: "codex" }, dataset(true))).out);
    const rows = j.checks.codex;
    expect(rows.map((r: { version: string }) => r.version)).toEqual(["0.140.0", "0.141.0", "0.142.0"]);
    for (const r of rows) {
      expect(r).toMatchObject({ model: "gpt-5.5", plan: "plus", limitId: "codex", windowMinutes: 10080 });
      expect(r.percentPerMillion).toBeCloseTo(r.percent / (r.workTokens / 1e6), 9);
    }
    expect(rows[2].percentPerMillion / rows[1].percentPerMillion).toBeGreaterThan(2);
  });

  it("a version that ran another model says the model may explain it", async () => {
    const fs = new InMemoryFs();
    addCodexRollout(fs, "0199a000-0000-7000-8000-0000000000a1", "0.140.0", 0, 2);
    addCodexRollout(fs, "0199a000-0000-7000-8000-0000000000a2", "0.141.0", 1, 2.2);
    addCodexRollout(fs, "0199a000-0000-7000-8000-0000000000a3", "0.142.0", 2, 25, { model: "gpt-6.1-sol" });
    const j = JSON.parse((await run({ json: true, agent: "codex" }, fs)).out);
    expect(j.findings).toHaveLength(1);
    expect(j.findings[0].note).toContain("This version ran a different model than your other versions; the model may explain the difference.");
  });
});

describe("sipcode regress: Claude Code session text helper", () => {
  it("writes one user and one assistant line per turn", () => {
    expect(claudeSessionText("s", "2.1.1", "m", healthy(3)).trim().split("\n")).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/integration/regress.integration.test.ts`
Expected: FAIL: `Failed to load url ../../src/commands/regress.js`.

- [ ] **Step 3: Write the disk side**

Create `src/modules/regress/load.ts`:

```ts
/**
 * regress inputs from disk, through the shared loaders: discovery, cross-file
 * dedupe (a request copied into a resumed or forked file counts once) and the
 * usage cache. Everything that could not be read is counted, never dropped
 * silently: a sandbox that blocks a log folder must not look like a clean
 * result.
 */
import path from "node:path";
import type { SipcodeIssue } from "../../lib/errors.js";
import { err, ok, type Result } from "../../lib/result.js";
import { resolveCodexHome } from "../agents/codex/discover.js";
import type { LimitReading } from "../agents/codex/rateLimits.js";
import { loadSessions, type LoadCounts } from "../agents/loadSessions.js";
import { getAgentById } from "../agents/registry.js";
import type { AgentDeps } from "../agents/types.js";
import type { UsageCaches } from "../agents/usageSessions.js";
import { loadCodexReadings } from "../limits/load.js";
import { resolveProjectsDir } from "../transcript/discover.js";
import type { RegressAccess } from "./report.js";
import { claudeRows, codexRequests, type ClaudeRow, type CodexRequest } from "./rows.js";

export interface ClaudeInput {
  readonly dir: string;
  /** Each session file's rows (claudeRows), discovery order. */
  readonly files: ClaudeRow[][];
  readonly counts: LoadCounts;
  readonly missing: boolean;
}

export interface CodexInput {
  readonly dir: string;
  readonly readings: LimitReading[];
  /** Limit reading lines or windows that could not be read. */
  readonly malformedReadings: number;
  readonly requests: CodexRequest[];
  readonly counts: LoadCounts;
  readonly missing: boolean;
}

export async function loadClaudeInput(
  deps: AgentDeps,
  cwd: string,
  caches: UsageCaches,
): Promise<Result<ClaudeInput, SipcodeIssue[]>> {
  const dir = resolveProjectsDir(deps.env);
  const missing = !(await deps.fs.exists(dir));
  const loaded = await loadSessions({
    agent: getAgentById("claude-code"),
    deps,
    cwd,
    cache: caches("claude-code"),
    needsToolCalls: () => false,
    analyze: claudeRows,
  });
  if (!loaded.ok) return err(loaded.error);
  return ok({ dir, files: loaded.value.sessions.map((s) => s.value), counts: loaded.value, missing });
}

export async function loadCodexInput(
  deps: AgentDeps,
  cwd: string,
  caches: UsageCaches,
): Promise<Result<CodexInput, SipcodeIssue[]>> {
  const dir = resolveCodexHome(deps.env);
  const missing =
    !(await deps.fs.exists(path.join(dir, "sessions"))) && !(await deps.fs.exists(path.join(dir, "archived_sessions")));
  const scan = await loadCodexReadings(deps);
  const loaded = await loadSessions({
    agent: getAgentById("codex"),
    deps,
    cwd,
    cache: caches("codex"),
    needsToolCalls: () => false,
    analyze: codexRequests,
  });
  if (!loaded.ok) return err(loaded.error);
  const requests: CodexRequest[] = [];
  for (const s of loaded.value.sessions) for (const r of s.value) requests.push(r);
  return ok({
    dir,
    readings: scan.readings,
    malformedReadings: scan.malformed,
    requests,
    counts: loaded.value,
    missing,
  });
}

/** What the report says could not be read, across the agents loaded. */
export function accessOf(claude: ClaudeInput | null, codex: CodexInput | null): RegressAccess {
  const missingDirs: string[] = [];
  if (claude?.missing) missingDirs.push(claude.dir);
  if (codex?.missing) missingDirs.push(path.join(codex.dir, "sessions"));
  const counts = [claude?.counts, codex?.counts].filter((c): c is LoadCounts => c !== undefined);
  return {
    missingDirs,
    unreadableFiles: counts.reduce((n, c) => n + c.unreadable + c.issues.length, 0),
    unreadableFolders: counts.reduce((n, c) => n + c.unreadableFolders, 0),
    skippedCompressed: counts.reduce((n, c) => n + c.skippedCompressed, 0),
  };
}
```

- [ ] **Step 4: Write the command**

Create `src/commands/regress.ts`:

```ts
/**
 * `sipcode regress`: did Claude Code or Codex get worse after an update?
 * Compares each version with the user's own other versions, from their local
 * logs only. Zero network calls.
 *
 * Thin orchestrator: flags → loadClaudeInput / loadCodexInput (shared
 * loaders) → buildRegressReport → terminal or JSON. Exit codes: 0 ran (with
 * or without findings), 1 bad flag or load error, 2 nothing could be read
 * (never a clean result).
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import { MESSAGES } from "../lib/messages.js";
import { parseAgentFlag } from "../modules/agents/cli.js";
import { defaultUsageCaches, type UsageCaches } from "../modules/agents/usageSessions.js";
import { DEFAULT_MIN_N } from "../modules/regress/claude.js";
import { formatRegressJson } from "../modules/regress/format-json.js";
import { formatRegressTerminal } from "../modules/regress/format-terminal.js";
import { accessOf, loadClaudeInput, loadCodexInput, type ClaudeInput, type CodexInput } from "../modules/regress/load.js";
import { buildRegressReport } from "../modules/regress/report.js";

export interface RegressOptions {
  json?: boolean;
  /** Add the GitHub-issue-ready evidence block. */
  bugReport?: boolean;
  /** Minimum requests per version a check needs (default 20). */
  minN?: string;
  agent?: string;
  cwd?: string;
}

export interface RegressDeps {
  fs?: FileSystem;
  clock?: Clock;
  env?: ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  usageCaches?: UsageCaches;
  /** Installed Sipcode version (cli.ts reads package.json), named in the bug report. */
  version?: string;
}

export interface RegressExit {
  readonly exitCode: 0 | 1 | 2;
}

function parseMinN(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_MIN_N;
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= 1 && n <= 1000 ? n : null;
}

export async function runRegress(opts: RegressOptions = {}, deps: RegressDeps = {}): Promise<RegressExit> {
  const fs = deps.fs ?? new RealFileSystem();
  const clock = deps.clock ?? new RealClock();
  const env = deps.env ?? new RealProcessEnv();
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s + "\n"));
  const version = deps.version ?? "unknown";

  const agent = parseAgentFlag(opts.agent);
  if (!agent.ok) {
    stderr(agent.message);
    return { exitCode: 1 };
  }
  if (agent.selector === "cursor") {
    stderr(MESSAGES.regressCursor);
    return { exitCode: 1 };
  }
  const minN = parseMinN(opts.minN);
  if (minN === null) {
    stderr(MESSAGES.regressBadMinN(String(opts.minN)));
    return { exitCode: 1 };
  }

  const agentDeps = { fs, env, clock };
  const cwd = opts.cwd ?? process.cwd();
  const caches = deps.usageCaches ?? defaultUsageCaches(fs, env);
  let claude: ClaudeInput | null = null;
  let codex: CodexInput | null = null;
  if (agent.selector !== "codex") {
    const r = await loadClaudeInput(agentDeps, cwd, caches);
    if (!r.ok) {
      stderr(r.error.map((e) => e.message).join("\n"));
      return { exitCode: 1 };
    }
    claude = r.value;
  }
  if (agent.selector !== "claude-code") {
    const r = await loadCodexInput(agentDeps, cwd, caches);
    if (!r.ok) {
      stderr(r.error.map((e) => e.message).join("\n"));
      return { exitCode: 1 };
    }
    codex = r.value;
    if (codex.malformedReadings > 0) stderr(MESSAGES.limitsMalformed(codex.malformedReadings));
  }

  const report = buildRegressReport({
    minN,
    claudeDir: claude?.dir ?? "",
    codexDir: codex?.dir ?? "",
    claude: claude ? claude.files : null,
    codex: codex ? { readings: codex.readings, requests: codex.requests } : null,
    access: accessOf(claude, codex),
  });
  const fmt = { bugReport: opts.bugReport === true, version };
  stdout(opts.json ? formatRegressJson(report, fmt) : formatRegressTerminal(report, fmt));
  return { exitCode: report.access.nothingRead ? 2 : 0 };
}
```

- [ ] **Step 5: Run the integration test**

Run: `npx vitest run tests/integration/regress.integration.test.ts`
Expected: PASS (20 tests). Ground truth: `warm-cache-miss` 2.1.76 to 2.1.90 (R2, R3; 2.1.90's cold turns are also warm misses, exactly as in the prototype), `post-idle-cold` 2.1.90 (R3), `ttl-5m` 2.1.100 to 2.1.105 (R4), `uncached-input` 2.1.258 (R1), `hourly-rebuild` 2.1.240 (R5), `codex-limit-burn` 0.142.0; the clean set: zero findings.

- [ ] **Step 6: Register the command**

In `src/cli.ts` replace:

```ts
program
  .command("trend")
```

with:

```ts
program
  .command("regress")
  .description("Did Claude Code or Codex get worse after an update? Compares each version with your other versions, from your local logs.")
  .option("--json", "machine-readable output")
  .option("--bug-report", "add a GitHub-issue-ready evidence block (token counts only)")
  .option("--min-n <n>", "minimum requests per version a check needs", "20")
  .option("--agent <id>", "claude-code | codex | auto (both, the default)")
  .action(async (opts) => {
    const { runRegress } = await import("./commands/regress.js");
    const r = await runRegress(opts, { version: pkg.version });
    if (r?.exitCode) process.exit(r.exitCode);
  });

program
  .command("trend")
```

- [ ] **Step 7: Add `regress` to the release smoke test's help list**

In `tests/e2e/release-smoke.test.ts` replace:

```ts
      "benchmark",
      "limits",
    ]) {
```

with:

```ts
      "benchmark",
      "limits",
      "regress",
    ]) {
```

- [ ] **Step 8: Check the command by hand on an empty home (no real logs)**

```bash
mkdir -p "$TMPDIR/sip-empty" && HOME="$TMPDIR/sip-empty" USERPROFILE="$TMPDIR/sip-empty" SIPCODE_PROJECTS_DIR="$TMPDIR/sip-empty/none" CODEX_HOME="$TMPDIR/sip-empty/none" npx tsx src/cli.ts regress; echo "exit $?"
```

Expected: the header line, `Claude Code: no readable interactive requests in ...`, `Known-regression windows your logs cover: none`, `Codex: no readable requests in ...`, two `Not found or not readable:` lines, a blank line, `Nothing to analyse: no Claude Code or Codex requests could be read. This is NOT a clean result.`, then `exit 2`. Then `npx tsx src/cli.ts regress --min-n 0; echo "exit $?"` prints the E010 message and `exit 1`. Remove the folder: `rm -rf "$TMPDIR/sip-empty"`.

- [ ] **Step 9: Run the regress tests, the CLI-related tests and the typecheck**

Run: `npx vitest run tests/modules/regress tests/integration/regress.integration.test.ts tests/privacy tests/guards && npm run lint`
Expected: PASS (the privacy guard scans the new files: no network imports).

- [ ] **Step 10: Commit**

```bash
git add src/modules/regress/load.ts src/commands/regress.ts src/cli.ts tests/e2e/release-smoke.test.ts tests/integration/regress.integration.test.ts
git commit -m "feat(regress): sipcode regress, did Claude Code or Codex get worse after an update" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The Codex plugin, its marketplace and the validation test

**Files:**
- Create: `plugins/sipcode/plugin.json`, `plugins/sipcode/.codex-plugin/plugin.json`, `plugins/sipcode/assets/logo.png`
- Create: `plugins/sipcode/skills/sipcode-spend/SKILL.md`, `plugins/sipcode/skills/sipcode-limits/SKILL.md`, `plugins/sipcode/skills/sipcode-why/SKILL.md`, `plugins/sipcode/skills/sipcode-regress/SKILL.md`
- Create: `.agents/plugins/marketplace.json`
- Modify: `package.json`, `package-lock.json` (version 1.7.2: the plugin declares the npm version it needs)
- Test: `tests/plugin/codex-plugin.test.ts`

Layout and fields follow https://developers.openai.com/codex/plugins/build, https://developers.openai.com/plugins/build/plugins and the limits in https://developers.openai.com/plugins/deploy/submission. Skills only (no hooks, apps or MCP config) so the plugin stays eligible for the public directory.

- [ ] **Step 1: Write the failing validation test**

Create `tests/plugin/codex-plugin.test.ts`:

```ts
/**
 * The Codex plugin (plugins/sipcode) and its marketplace entry
 * (.agents/plugins/marketplace.json): structure per the official docs
 * (developers.openai.com/codex/plugins/build, /plugins/deploy/submission),
 * public-directory eligibility (skills only: no hooks, MCP servers or apps),
 * listing limits, and every `sipcode` command a skill tells Codex to run
 * exists in the CLI with the flags and values used.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLUGIN = path.join(ROOT, "plugins", "sipcode");
const SKILLS = ["sipcode-limits", "sipcode-regress", "sipcode-spend", "sipcode-why"];

const json = (p: string) => JSON.parse(readFileSync(p, "utf-8")) as Record<string, any>;
const manifest = json(path.join(PLUGIN, "plugin.json"));
const overlay = json(path.join(PLUGIN, ".codex-plugin", "plugin.json"));
const marketplace = json(path.join(ROOT, ".agents", "plugins", "marketplace.json"));
const pkg = json(path.join(ROOT, "package.json"));
const iface = manifest.extensions["com.openai"].interface as Record<string, any>;

/** All files under a folder, relative, with forward slashes. */
function filesUnder(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p, base) : [path.relative(base, p).replace(/\\/g, "/")];
  });
}

function frontmatter(text: string): { fields: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error("no frontmatter");
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]!] = kv[2]!;
  }
  return { fields, body: m[2]! };
}

const skillText = (name: string) => readFileSync(path.join(PLUGIN, "skills", name, "SKILL.md"), "utf-8");

/** Every `sipcode ...` command in a skill: inline code spans and lines of fenced blocks. */
function commands(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`(sipcode [^`]+)`/g)) out.add(m[1]!.trim());
  for (const block of text.matchAll(/```[a-z]*\r?\n([\s\S]*?)```/g)) {
    for (const line of block[1]!.split(/\r?\n/)) if (line.trim().startsWith("sipcode ")) out.add(line.trim());
  }
  return [...out];
}

/** `sipcode <args> --help` from the TypeScript source (no build needed). */
const helpCache = new Map<string, string>();
function help(sub?: string): string {
  const key = sub ?? "";
  if (!helpCache.has(key)) {
    const r = spawnSync(process.execPath, ["--import", "tsx", path.join(ROOT, "src", "cli.ts"), ...(sub ? [sub] : []), "--help"], {
      cwd: ROOT,
      encoding: "utf-8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    if (r.status !== 0) throw new Error(`sipcode ${key} --help failed: ${r.stderr}`);
    helpCache.set(key, r.stdout);
  }
  return helpCache.get(key)!;
}

/** PNG width and height from the IHDR chunk. */
function pngSize(p: string): [number, number] {
  const b = readFileSync(p);
  expect(b.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe("Codex plugin: manifest", () => {
  it("root plugin.json is the portable manifest: schema, kebab-case name, version = package version", () => {
    expect(manifest.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
    expect(manifest.name).toBe("sipcode");
    expect(manifest.name).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.description.length).toBeLessThanOrEqual(4000);
    expect(manifest.author.name.length).toBeLessThanOrEqual(120);
    expect(manifest.author.url).toMatch(/^https:\/\//);
    expect(manifest.homepage).toMatch(/^https:\/\//);
  });

  it("only the fields the 1.0.0 schema allows (it has additionalProperties: false; no `skills` at the root)", () => {
    const allowed = ["$schema", "name", "version", "description", "author", "homepage", "repository", "license", "keywords", "extensions"];
    for (const k of Object.keys(manifest)) expect(allowed, k).toContain(k);
    expect(Object.keys(manifest.extensions)).toEqual(["com.openai"]);
  });

  it("directory listing fields within the submission limits", () => {
    expect(iface.displayName).toBe("Sipcode");
    expect(iface.displayName.length).toBeLessThanOrEqual(30);
    expect(iface.shortDescription.length).toBeLessThanOrEqual(30);
    expect(iface.longDescription.length).toBeLessThanOrEqual(4000);
    expect(iface.developerName.length).toBeLessThanOrEqual(80);
    expect(iface.category).toBe("Developer Tools");
    expect(iface.capabilities).toEqual(["Read"]);
    expect(iface.defaultPrompt.length).toBeLessThanOrEqual(3);
    for (const p of iface.defaultPrompt) expect(p.length).toBeLessThanOrEqual(128);
    expect(new Set(iface.defaultPrompt).size).toBe(iface.defaultPrompt.length);
    for (const u of [iface.websiteURL, iface.privacyPolicyURL]) {
      expect(u).toMatch(/^https:\/\//);
      expect(u.length).toBeLessThanOrEqual(1024);
    }
    expect(iface.brandColor).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("logo and composer icon: ./assets paths, square PNG of at least 48 px, under 5 MiB", () => {
    for (const rel of [iface.logo, iface.composerIcon]) {
      expect(rel).toMatch(/^\.\/assets\//);
      const p = path.join(PLUGIN, rel);
      expect(existsSync(p), rel).toBe(true);
      const [w, h] = pngSize(p);
      expect(w).toBe(h);
      expect(w).toBeGreaterThanOrEqual(48);
      expect(statSync(p).size).toBeLessThan(5 * 1024 * 1024);
    }
  });

  it("the .codex-plugin overlay (older Codex) matches the root manifest", () => {
    for (const k of ["name", "version", "description", "author", "homepage", "repository", "license", "keywords"]) {
      expect(overlay[k], k).toEqual(manifest[k]);
    }
    expect(overlay.skills).toBe("./skills/");
    expect(overlay.interface).toEqual(iface);
    expect(readdirSync(path.join(PLUGIN, ".codex-plugin"))).toEqual(["plugin.json"]);
  });
});

describe("Codex plugin: eligible for the public directory", () => {
  it("skills only: no hooks, no MCP servers, no apps", () => {
    const files = filesUnder(PLUGIN).sort();
    expect(files).toEqual([
      ".codex-plugin/plugin.json",
      "assets/logo.png",
      "plugin.json",
      ...SKILLS.map((s) => `skills/${s}/SKILL.md`),
    ]);
    const openai = manifest.extensions["com.openai"];
    for (const k of ["hooks", "apps", "mcpServers"]) {
      expect(openai[k], k).toBeUndefined();
      expect(overlay[k], k).toBeUndefined();
    }
  });
});

describe("Codex plugin: marketplace", () => {
  it("lists the plugin from ./plugins/sipcode with the required policy and category", () => {
    expect(marketplace.name).toBe("sipcode");
    expect(marketplace.interface.displayName).toBe("Sipcode");
    expect(marketplace.plugins).toEqual([
      {
        name: "sipcode",
        source: { source: "local", path: "./plugins/sipcode" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Developer Tools",
      },
    ]);
    expect(existsSync(path.join(ROOT, marketplace.plugins[0].source.path, "plugin.json"))).toBe(true);
  });
});

describe("Codex plugin: skills", () => {
  it("one folder per skill, each with a SKILL.md whose name matches", () => {
    expect(readdirSync(path.join(PLUGIN, "skills")).sort()).toEqual(SKILLS);
    for (const s of SKILLS) {
      const { fields } = frontmatter(skillText(s));
      expect(fields.name, s).toBe(s);
      expect(fields.description!.length, s).toBeGreaterThan(80);
      expect(fields.description!.length, s).toBeLessThanOrEqual(1024);
    }
  });

  it("every skill: published CLI only, install hint, no npx, sandbox escalation, no reading logs, exact numbers", () => {
    for (const s of SKILLS) {
      const t = skillText(s);
      expect(t, s).toContain("Run `npm i -g sipcode` once in a terminal, then ask again.");
      expect(t, s).toContain("Do not try `npx`");
      expect(t, s).toContain("request permission to run the same command again with read access");
      expect(t, s).toContain("Never open, read, search or summarise the log files yourself");
      expect(t, s).toContain("Quote numbers exactly as");
      expect(t, s).not.toMatch(/\bnpx sipcode\b/);
    }
  });

  it("copy rules: no em or en dashes, no 'stops hallucinations', 'nerfed' only in a prohibition", () => {
    const texts = [...SKILLS.map(skillText), JSON.stringify(manifest), JSON.stringify(overlay), JSON.stringify(marketplace)];
    for (const t of texts) {
      expect(t).not.toMatch(/[\u2013\u2014]/);
      expect(t.toLowerCase()).not.toContain("hallucination");
      for (const line of t.split("\n")) if (/nerfed/i.test(line)) expect(line).toMatch(/never|do not/i);
    }
  });

  it("limit cuts are always 'possible' with the other-devices caveat; regress findings outside the catalog are signals, not proof", () => {
    expect(skillText("sipcode-limits")).toContain('say "a possible limit cut"');
    expect(skillText("sipcode-limits")).toContain("Codex use on other devices or in the cloud raises the percent without local tokens");
    expect(skillText("sipcode-regress")).toContain("is a signal worth reporting, not proof of a bug");
    expect(skillText("sipcode-regress")).toContain("this is not a clean result. Never say \"no regressions\".");
  });
});

describe("Codex plugin: every command a skill runs exists in the CLI", () => {
  const all = SKILLS.flatMap((s) => commands(skillText(s)).map((c) => [s, c] as const));

  it("the skills name the commands the design calls for", () => {
    const cmds = all.map(([, c]) => c);
    for (const c of [
      "sipcode --version",
      "sipcode today --agent codex --json",
      "sipcode forecast --agent codex --json",
      "sipcode stats --agent codex --since 7d --json",
      "sipcode limits --json",
      "sipcode limits --json --since all",
      "sipcode why --agent codex --json",
      "sipcode why --agent codex --list",
      "sipcode why --agent codex --session <id> --json",
      "sipcode regress --bug-report",
      "sipcode regress --bug-report --agent codex",
      "sipcode regress --bug-report --agent claude-code",
    ]) {
      expect(cmds).toContain(c);
    }
  });

  it(
    "each subcommand and flag is in `sipcode --help` / `sipcode <command> --help`, with valid values",
    () => {
      const top = help();
      for (const [skill, cmd] of all) {
        const words = cmd.split(/\s+/).slice(1);
        if (words[0]!.startsWith("--")) {
          expect(top, `${skill}: ${cmd}`).toContain(words[0]!);
          continue;
        }
        const sub = words[0]!;
        expect(top, `${skill}: ${cmd}`).toMatch(new RegExp(`^\\s+${sub}\\b`, "m"));
        const subHelp = help(sub);
        for (let i = 1; i < words.length; i++) {
          const w = words[i]!;
          if (!w.startsWith("--")) continue;
          expect(subHelp, `${skill}: ${cmd}`).toMatch(new RegExp(`(^|\\s|,)${w}(\\s|,|$)`, "m"));
          const value = words[i + 1];
          if (w === "--agent") expect(["codex", "claude-code"], `${skill}: ${cmd}`).toContain(value);
          if (w === "--since") expect(value, `${skill}: ${cmd}`).toMatch(/^(\d+d|all|\d{4}-\d{2}-\d{2})$/);
          if (w === "--session") expect(value).toBe("<id>");
        }
      }
    },
    120_000,
  );
});

describe("Codex plugin: not shipped in the npm package", () => {
  it("package.json `files` does not include plugins/ or .agents/", () => {
    for (const f of pkg.files as string[]) {
      expect(f.startsWith("plugins")).toBe(false);
      expect(f.startsWith(".agents")).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/plugin/codex-plugin.test.ts`
Expected: FAIL at load: `ENOENT: no such file or directory, open '...plugins/sipcode/plugin.json'`.

- [ ] **Step 3: Add the logo (180 x 180 PNG, the site's icon)**

```bash
mkdir -p plugins/sipcode/assets plugins/sipcode/.codex-plugin .agents/plugins
cp docs/site/public/apple-touch-icon.png plugins/sipcode/assets/logo.png
```

- [ ] **Step 4: Write the portable manifest**

Create `plugins/sipcode/plugin.json`:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "sipcode",
  "version": "1.7.2",
  "description": "Ask about your Codex usage in plain words: spend, usage limits, why a session was expensive, and whether Codex or Claude Code got worse after an update. Runs the Sipcode CLI on this computer, which reads your local Codex and Claude Code logs and makes no network calls.",
  "author": {
    "name": "Anuj Ojha",
    "url": "https://github.com/Anuj7411"
  },
  "homepage": "https://anuj7411.github.io/sipcode/",
  "repository": "https://github.com/Anuj7411/sipcode",
  "license": "MIT",
  "keywords": ["codex", "usage", "limits", "tokens", "spend", "regression"],
  "extensions": {
    "com.openai": {
      "interface": {
        "displayName": "Sipcode",
        "shortDescription": "Spend, limits and regressions",
        "longDescription": "Sipcode answers questions about your own Codex use from the logs Codex already writes on this computer: how much you spent today or this month (at API prices), how close you are to your usage limits and whether a limit may have shrunk, why a session used so many tokens, and whether Codex or Claude Code got worse after an update. Each answer comes from the Sipcode command-line tool (npm package sipcode), which reads the logs locally and makes no network calls. Install it once with npm i -g sipcode.",
        "developerName": "Anuj Ojha",
        "category": "Developer Tools",
        "capabilities": ["Read"],
        "websiteURL": "https://anuj7411.github.io/sipcode/",
        "privacyPolicyURL": "https://github.com/Anuj7411/sipcode/blob/main/PRIVACY.md",
        "defaultPrompt": [
          "How much did I spend on Codex this month?",
          "How close am I to my Codex usage limit?",
          "Did Codex or Claude Code get worse after an update?"
        ],
        "brandColor": "#5B4FCF",
        "composerIcon": "./assets/logo.png",
        "logo": "./assets/logo.png"
      }
    }
  }
}
```

- [ ] **Step 5: Write the compatibility overlay for older Codex builds**

Create `plugins/sipcode/.codex-plugin/plugin.json` (the docs say only this file goes in `.codex-plugin/`, and Codex uses it only when the root manifest has no `extensions["com.openai"]`; the validation test keeps it identical to the root manifest):

```json
{
  "name": "sipcode",
  "version": "1.7.2",
  "description": "Ask about your Codex usage in plain words: spend, usage limits, why a session was expensive, and whether Codex or Claude Code got worse after an update. Runs the Sipcode CLI on this computer, which reads your local Codex and Claude Code logs and makes no network calls.",
  "author": {
    "name": "Anuj Ojha",
    "url": "https://github.com/Anuj7411"
  },
  "homepage": "https://anuj7411.github.io/sipcode/",
  "repository": "https://github.com/Anuj7411/sipcode",
  "license": "MIT",
  "keywords": ["codex", "usage", "limits", "tokens", "spend", "regression"],
  "skills": "./skills/",
  "interface": {
    "displayName": "Sipcode",
    "shortDescription": "Spend, limits and regressions",
    "longDescription": "Sipcode answers questions about your own Codex use from the logs Codex already writes on this computer: how much you spent today or this month (at API prices), how close you are to your usage limits and whether a limit may have shrunk, why a session used so many tokens, and whether Codex or Claude Code got worse after an update. Each answer comes from the Sipcode command-line tool (npm package sipcode), which reads the logs locally and makes no network calls. Install it once with npm i -g sipcode.",
    "developerName": "Anuj Ojha",
    "category": "Developer Tools",
    "capabilities": ["Read"],
    "websiteURL": "https://anuj7411.github.io/sipcode/",
    "privacyPolicyURL": "https://github.com/Anuj7411/sipcode/blob/main/PRIVACY.md",
    "defaultPrompt": [
      "How much did I spend on Codex this month?",
      "How close am I to my Codex usage limit?",
      "Did Codex or Claude Code get worse after an update?"
    ],
    "brandColor": "#5B4FCF",
    "composerIcon": "./assets/logo.png",
    "logo": "./assets/logo.png"
  }
}
```

- [ ] **Step 6: Write the marketplace**

Create `.agents/plugins/marketplace.json`:

```json
{
  "name": "sipcode",
  "interface": {
    "displayName": "Sipcode"
  },
  "plugins": [
    {
      "name": "sipcode",
      "source": {
        "source": "local",
        "path": "./plugins/sipcode"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Developer Tools"
    }
  ]
}
```

- [ ] **Step 7: Write the spend skill**

Create `plugins/sipcode/skills/sipcode-spend/SKILL.md`:

````markdown
---
name: sipcode-spend
description: Report how much the user spent on Codex (tokens and cost at API prices) today, this month, the projected month end, or over a period, from their local Codex logs, using the Sipcode CLI. Use when the user asks how much they spent on Codex, how many tokens Codex used today or this month, or what this month will cost.
---

# Codex spend

Answer from the user's own Codex logs on this computer, through the published `sipcode` command. Explicit instructions from the user take priority over this skill.

## Run Sipcode

1. Run `sipcode --version`. If the command is not found, tell the user: "Sipcode is not installed. Run `npm i -g sipcode` once in a terminal, then ask again." and stop. Do not try `npx` (the sandbox usually blocks network access) and do not install anything yourself. If the version is lower than 1.7.2, tell the user to run `npm i -g sipcode@latest` and stop.
2. Sipcode reads `~/.codex` (or the folder `CODEX_HOME` points to). If the sandbox blocks that folder (a permission error, or a result that says no sessions while the user clearly uses Codex), request permission to run the same command again with read access to that folder, for example by running it outside the sandbox. Do not report an empty result caused by the sandbox.
3. Never open, read, search or summarise the log files yourself, and never paste their contents. Work only from Sipcode's output.

## Pick one command

| The user asks about | Run |
|---|---|
| today | `sipcode today --agent codex --json` |
| this month, month end, "what will this month cost" | `sipcode forecast --agent codex --json` |
| a period: last 7 days, since a date, all time | `sipcode stats --agent codex --since 7d --json` (use `7d`, `30d`, `90d`, `all` or a `yyyy-mm-dd` date) |

Run it once. Lines Sipcode prints on stderr that start with `note:` are part of the answer.

## Report the result

- Quote numbers exactly as Sipcode prints them. Do not round, add up or recompute them.
- Dollar amounts are what the tokens would cost at OpenAI's API prices. On a ChatGPT plan the user is not billed per token: say "at API prices", never "you were charged".
- `today`: give `today.totalSpendUSD` and `today.totalTokens`, then the comparison with the usual day (`comparison.spendDeltaPct` against `baseline.medianSpendPerDayUSD`). If `status` is `no-sessions-today`, `no-baseline` or `no-data`, say that plainly (no Codex use today, not enough history to compare, or no Codex logs).
- `forecast`: give `monthEnd.spendSoFarUSD`, then `monthEnd.projectedSpendUSD` with its range (`confidenceLowUSD` to `confidenceHighUSD`), and last month when `comparison.lastMonthSpendUSD` is not null. If `status` is not `ok`, say what it means (too little data, too close to month end, no recent activity, or no data) instead of giving a projection.
- `stats`: give `totals.estCostUSD`, `totals.totalTokens` and `sessionCount` for the window, then `topExpensive` if the user asked which sessions cost most.
- If Sipcode says some tokens are on models without a known price, say that those tokens are counted but not in the dollar figure.
- Do not speculate about causes. If the user wants to know why a session cost so much, that is the sipcode-why skill.
````

- [ ] **Step 8: Write the limits skill**

Create `plugins/sipcode/skills/sipcode-limits/SKILL.md`:

````markdown
---
name: sipcode-limits
description: Report how close the user is to their Codex usage limits (5-hour, weekly or 30-day), when they run out at the current pace, what used them, and whether a limit may have shrunk, from the limit readings in their local Codex logs, using the Sipcode CLI. Use when the user asks how close they are to their Codex limit, when it resets, what used it up, or whether their limit got smaller.
---

# Codex usage limits

Answer from the limit readings Codex writes into its own logs on this computer, through the published `sipcode` command. Explicit instructions from the user take priority over this skill.

## Run Sipcode

1. Run `sipcode --version`. If the command is not found, tell the user: "Sipcode is not installed. Run `npm i -g sipcode` once in a terminal, then ask again." and stop. Do not try `npx` (the sandbox usually blocks network access) and do not install anything yourself. If the version is lower than 1.7.2, tell the user to run `npm i -g sipcode@latest` and stop.
2. Sipcode reads `~/.codex` (or the folder `CODEX_HOME` points to). If the sandbox blocks that folder (a permission error, or a result that says no sessions while the user clearly uses Codex), request permission to run the same command again with read access to that folder, for example by running it outside the sandbox. Do not report an empty result caused by the sandbox.
3. Never open, read, search or summarise the log files yourself, and never paste their contents. Work only from Sipcode's output.

## Pick one command

| The user asks about | Run |
|---|---|
| how close they are, when it resets, what used it | `sipcode limits --json` |
| whether a limit shrank, or the history | `sipcode limits --json --since all` |

Run it once. Lines Sipcode prints on stderr that start with `note:` are part of the answer.

## Report the result

- Quote numbers exactly as Sipcode prints them. Do not round or recompute them.
- If `windows` is empty, say Sipcode found no Codex limit readings yet (Codex records them after each request).
- For each window: its `label` (for example "Weekly"), `usedPercent`, and `resetsAt`. Then `projection.kind`: `runs-out` (say when: `projection.at`), `lasts` (it lasts until the reset at this pace), `reached` (the limit is used up), `reset-since` (it has reset since the last reading, so the old percent no longer applies), `too-early` (too soon after the reset to judge the pace).
- `asOf` is the user's last Codex request: the percent is only as fresh as that.
- What used it: the sessions in `usedBy` (folder names and percent). `unattributedPercent` is use with no request on this computer: Codex on another device or in the cloud.
- Did it shrink: `tokensPerPercent` lists how many tokens 1% bought in each finished period. If `possibleCut` is not null, say "a possible limit cut" around `possibleCut.at`, about `possibleCut.factor` times fewer tokens per 1%, and always add that Codex use on other devices or in the cloud raises the percent without local tokens, so it can look like a cut. Never say it is confirmed, and never say Codex was "nerfed".
````

- [ ] **Step 9: Write the why skill**

Create `plugins/sipcode/skills/sipcode-why/SKILL.md`:

````markdown
---
name: sipcode-why
description: Explain why a Codex session used so many tokens (largest requests, files read more than once, context carried while idle) from the user's local Codex logs, using the Sipcode CLI. Use when the user asks why their last Codex session was so expensive, where the tokens went, or what made a session cost so much.
---

# Why a Codex session was expensive

Answer from the user's own Codex logs on this computer, through the published `sipcode` command. Explicit instructions from the user take priority over this skill.

## Run Sipcode

1. Run `sipcode --version`. If the command is not found, tell the user: "Sipcode is not installed. Run `npm i -g sipcode` once in a terminal, then ask again." and stop. Do not try `npx` (the sandbox usually blocks network access) and do not install anything yourself. If the version is lower than 1.7.2, tell the user to run `npm i -g sipcode@latest` and stop.
2. Sipcode reads `~/.codex` (or the folder `CODEX_HOME` points to). If the sandbox blocks that folder (a permission error, or a result that says no sessions while the user clearly uses Codex), request permission to run the same command again with read access to that folder, for example by running it outside the sandbox. Do not report an empty result caused by the sandbox.
3. Never open, read, search or summarise the log files yourself, and never paste their contents. Work only from Sipcode's output.

## Pick one command

| The user asks about | Run |
|---|---|
| the last (most recent) session | `sipcode why --agent codex --json` |
| a specific session | `sipcode why --agent codex --list` to find its id, then `sipcode why --agent codex --session <id> --json` |

The session you are in right now is also a Codex session: if the user means an earlier one, use `--list` and ask which one when it is not clear. Lines Sipcode prints on stderr that start with `note:` are part of the answer.

## Report the result

- Quote numbers exactly as Sipcode prints them. Do not round or recompute them.
- Start with the session (`header`), its total tokens (`punchline.totalTokens`) and cost at API prices (`totals.estCostUSD`). On a ChatGPT plan the user is not billed per token: say "at API prices".
- Then where the tokens went, largest first: `topExpensive` (the costliest tool calls), `duplicates` (files read more than once, with the tokens the re-reads cost), `idle` (files kept in context without being used), and `topLeaks`.
- `estimatedSavings` describes what Sipcode's setup saves in Claude Code. Sipcode does not act inside Codex, so do not present it as a saving the user can get in Codex.
- Do not speculate beyond the output. If the user asks whether Codex itself got more expensive after an update, that is the sipcode-regress skill.
````

- [ ] **Step 10: Write the regress skill**

Create `plugins/sipcode/skills/sipcode-regress/SKILL.md`:

````markdown
---
name: sipcode-regress
description: Check the user's own local Claude Code and Codex logs for regressions after an update (prompt-cache misses, 5-minute cache TTL, uncached context, hourly cache rebuilds, Codex usage limit draining faster per token) and pin each one to the version that introduced it, using the Sipcode CLI. Use when the user asks whether Codex or Claude Code got worse or more expensive after an update, why their usage limit burns faster than before, or whether an update changed their costs.
---

# Did Codex or Claude Code get worse after an update?

Answer "is it the tool or is it me?" from the user's own logs on this computer, through the published `sipcode` command, with evidence they can attach to a bug report. Explicit instructions from the user take priority over this skill.

## Run Sipcode

1. Run `sipcode --version`. If the command is not found, tell the user: "Sipcode is not installed. Run `npm i -g sipcode` once in a terminal, then ask again." and stop. Do not try `npx` (the sandbox usually blocks network access) and do not install anything yourself. If the version is lower than 1.7.2, tell the user to run `npm i -g sipcode@latest` and stop.
2. Run this once:

   ```bash
   sipcode regress --bug-report
   ```

   It reads `~/.claude/projects` and `~/.codex` and compares each version with the user's other versions. If the user asked only about Codex, run `sipcode regress --bug-report --agent codex`; only about Claude Code, `sipcode regress --bug-report --agent claude-code`. Use no other options.
3. If the sandbox blocks a log folder (the output says "Not found or not readable", prints a WARNING that files could not be read, or the command exits with code 2), request permission to run the same command again with read access to those folders, for example by running it outside the sandbox. Do not report a result from a blocked run.
4. Never open, read, search or summarise the log files yourself, and never paste their contents. Work only from Sipcode's output.

## Report the result

1. Start with the coverage lines, quoted exactly as printed: requests, sessions, date range and versions, and which known-regression windows the logs cover.
   - If the output says "Nothing to analyse", or the command exited with code 2, tell the user no logs could be read and that this is not a clean result. Never say "no regressions".
   - If it prints a WARNING that files could not be read, say the result is partial and ask the user to allow read access, then run it again.
   - If it says "Not enough data to compare versions yet", say that, and that it is not a clean result either.
2. If there are findings, list each one with its versions, the evidence numbers and whether it matches a known, confirmed issue (R1 to R5). Quote numbers exactly as printed; do not round or recompute them.
3. A finding not in the known-issue catalog is a signal worth reporting, not proof of a bug. Say so plainly.
4. A Codex finding ("Codex rate limit drains faster per token") could also be a limit change on the user's plan at the same time as the update, and Codex use on other devices or in the cloud shares the same limit: always say so, and call any limit change "possible".
5. If there are no findings, say "No regressions detected in your logs" and repeat the coverage, so the user knows what was checked. Do not speculate about causes.
6. Offer the bug-report block (after "paste into a GitHub issue") for a GitHub issue. It holds token counts, versions, dates and short session ids only, never prompts or code. Tell the user to review it before posting.

## Rules

- Never say the model was "nerfed". Sipcode measures cache, token and limit behaviour, not answer quality.
- Subagent and Agent SDK runs are left out on purpose, because their cache policy differs by design. If the user asks, explain this.
- Codex versions are compared only with other versions on the same plan and limit window. If the plan or window changed, a missing finding does not mean nothing changed.
````

- [ ] **Step 11: Move the npm version to 1.7.2**

The manifest's `version` must equal `package.json`'s (the skills need `regress`, new in 1.7.2). Patch bump only, no tag:

```bash
npm version 1.7.2 --no-git-tag-version
```

Expected: `v1.7.2`; `package.json` and `package-lock.json` (two places) now say 1.7.2. `server.json`, the site and the docs move in Task 14.

- [ ] **Step 12: Run the validation test**

Run: `npx vitest run tests/plugin/codex-plugin.test.ts`
Expected: PASS (14 tests). The command check spawns `node --import tsx src/cli.ts <command> --help` for each command the skills name (about 5 s).

- [ ] **Step 13: Commit**

```bash
git add plugins .agents tests/plugin/codex-plugin.test.ts package.json package-lock.json
git commit -m "feat(plugin): Sipcode plugin for Codex: spend, limits, why and regress skills" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Independent regress check in `scripts/verify-counts.mjs`

The script imports nothing from Sipcode. This task teaches its own readers the few extra facts `regress` uses and recomputes every regress number from the raw logs.

**Files:**
- Modify: `scripts/verify-counts.mjs` (header comment, `readClaudeFile`, `readCodexFile`, `limitWindows`, a new "Regress" section before "Main", `main()`)

- [ ] **Step 1: Document the rules in the header**

Replace:

```js
//   from one model; a cut is the first period at or below half the median of
//   2+ earlier ones (same model).
import { readFileSync,
```

with:

```js
//   from one model; a cut is the first period at or below half the median of
//   2+ earlier ones (same model).
// - Regress (`regress --json`): Claude Code requests with usage, a `version`
//   and a model other than <synthetic>; the kept copy is the owner's with the
//   largest usage; automated = isSidechain or entrypoint sdk-*; 5-minute write
//   = write - 1h when the nested split was logged; the prototype's five checks
//   and thresholds (min n 20). Codex: per (line 1 cli_version without
//   pre-release, model, plan of the period's newest reading, limit, window),
//   the percent its requests were charged rise by rise (by tokens), per 1M
//   uncached input + output tokens; groups of 200,000+ such tokens; flagged
//   at 2x the upper median of the others on the same plan, limit and window.
import { readFileSync,
```

- [ ] **Step 2: Record each Claude Code request's tags**

In `readClaudeFile` replace:

```js
  const requests = [];
  let start;
  let end;
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('"assistant"') && !line.includes('"user"')) continue;
```

with:

```js
  const requests = [];
  let start;
  let end;
  let lastUserTool = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('"assistant"') && !line.includes('"user"')) continue;
```

Replace:

```js
    if (e.type !== "assistant") continue;
    const m = e.message && typeof e.message === "object" ? e.message : {};
```

with:

```js
    if (e.type !== "assistant") {
      const c = e.message && typeof e.message === "object" ? e.message.content : undefined;
      lastUserTool = Array.isArray(c) && c.some((b) => b && typeof b === "object" && b.type === "tool_result");
      continue;
    }
    const m = e.message && typeof e.message === "object" ? e.message : {};
```

Replace:

```js
    const prev = key ? byKey.get(key) : undefined;
    if (prev) {
      for (const f of FIELDS) prev[f] = Math.max(prev[f], v[f]);
      continue;
    }
    const r = { key, model: typeof m.model === "string" ? m.model : undefined, ts, ...v };
```

with:

```js
    const split = !!(u?.cache_creation && typeof u.cache_creation === "object");
    const prev = key ? byKey.get(key) : undefined;
    if (prev) {
      for (const f of FIELDS) prev[f] = Math.max(prev[f], v[f]);
      prev.hasUsage ||= !!u;
      prev.split ||= split;
      continue;
    }
    const r = {
      key,
      model: typeof m.model === "string" ? m.model : undefined,
      ts,
      ...v,
      // regress: the request's tags (its first line wins, like Sipcode).
      version: typeof e.version === "string" && e.version ? e.version : undefined,
      entry: typeof e.entrypoint === "string" && e.entrypoint ? e.entrypoint : "?",
      side: e.isSidechain === true,
      afterTool: lastUserTool,
      hasUsage: !!u,
      split,
    };
```

- [ ] **Step 3: Record each Codex file's version**

In `readCodexFile` replace:

```js
    metaId: typeof meta?.id === "string" && meta.id ? meta.id : undefined,
```

with:

```js
    metaId: typeof meta?.id === "string" && meta.id ? meta.id : undefined,
    cliVersion: typeof meta?.cli_version === "string" && meta.cli_version ? meta.cli_version : undefined,
```

- [ ] **Step 4: Record each limit period's plan**

In `limitWindows` replace:

```js
      w.periods.push({ resetsAt: r.resetsAt, max: r.pct, first: r.at, newest: r.at, rises: r.pct > 0 ? [{ at: r.at, rise: r.pct }] : [] });
```

with:

```js
      w.periods.push({ resetsAt: r.resetsAt, max: r.pct, first: r.at, newest: r.at, plan: r.plan, rises: r.pct > 0 ? [{ at: r.at, rise: r.pct }] : [] });
```

and replace:

```js
    cur.resetsAt = r.resetsAt;
    cur.newest = r.at;
```

with:

```js
    cur.resetsAt = r.resetsAt;
    cur.newest = r.at;
    cur.plan = r.plan;
```

- [ ] **Step 5: Add the regress section**

Replace:

```js
// ---------------------------------------------------------------------------
// Main
```

with the block below followed by those same two lines:

```js
// ---------------------------------------------------------------------------
// Regress (`regress --json`)
// ---------------------------------------------------------------------------

const REGRESS_MIN_N = 20;
const KNOWN_REGRESSIONS = [
  { id: "R1", checks: ["uncached-input"], from: "2.1.257", to: "2.1.259" },
  { id: "R2", checks: ["warm-cache-miss"], from: "2.1.69", to: "2.1.89" },
  { id: "R3", checks: ["post-idle-cold", "warm-cache-miss"], from: "2.1.85", to: "2.1.100" },
  { id: "R4", checks: ["ttl-5m"], from: "2.1.0", to: "2.1.128" },
  { id: "R5", checks: ["hourly-rebuild"], from: "2.1.0", to: "2.1.247" },
];
const vparts = (v) => {
  const p = (v || "0.0.0").split(/[.-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  while (p.length < 3) p.push(0);
  return p;
};
const vcmp = (a, b) => {
  const x = vparts(a);
  const y = vparts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
const upperMedian = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : 0);

/** Claude Code rows per file: requests with usage, a version and a real model, in time order (the owner's copy, largest usage). */
function regressClaudeFiles(files) {
  return files
    .map((f) =>
      f.own
        .filter((r) => (r.hasUsage || tokensOf(r) > 0) && r.version && r.model !== "<synthetic>")
        .map((r) => ({
          version: r.version,
          model: r.model ?? "?",
          automated: r.side || r.entry.startsWith("sdk"),
          ts: ms(r.ts) ?? 0,
          inp: r.inp,
          cr: r.cr,
          cw: r.cw,
          c1: r.cw1h,
          c5: r.split ? Math.max(0, r.cw - r.cw1h) : 0,
          ctx: r.inp + r.cr + r.cw,
          afterTool: r.afterTool,
        }))
        .sort((a, b) => a.ts - b.ts),
    )
    .filter((rows) => rows.length > 0);
}

/** Per-version rate table: versions with >= minN samples; baseline = every other sample. */
function rates(samples, minN) {
  const by = new Map();
  for (const s of samples) by.set(s.version, [...(by.get(s.version) ?? []), s]);
  const hits = samples.filter((s) => s.value).length;
  return [...by.entries()]
    .sort((a, b) => vcmp(a[0], b[0]))
    .filter(([, a]) => a.length >= minN)
    .map(([version, a]) => {
      const h = a.filter((s) => s.value).length;
      const restN = samples.length - a.length;
      return { version, n: a.length, rate: h / a.length, baseline: restN ? (hits - h) / restN : 0, baselineN: restN };
    });
}

/** Flagged versions adjacent in `order` → [from, to] ranges. */
function ranges(flagged, order) {
  const out = [];
  for (const v of [...flagged].sort(vcmp)) {
    const last = out.at(-1);
    if (last && order.indexOf(v) >= 0 && order.indexOf(v) === order.indexOf(last[1]) + 1) last[1] = v;
    else out.push([v, v]);
  }
  return out;
}

function regressClaude(files) {
  const main = files.map((rows) => rows.filter((r) => !r.automated)).filter((rows) => rows.length);
  const min = 60_000;
  const findings = [];
  const warm = [];
  const idle = [];
  for (const rows of main) {
    for (let i = 1; i < rows.length; i++) {
      const p = rows[i - 1];
      const r = rows[i];
      const gap = (r.ts - p.ts) / min;
      if (gap >= 0 && gap <= 5 && r.ctx >= 30e3 && r.ctx >= 0.6 * p.ctx) warm.push({ version: r.version, value: r.cr < 0.3 * r.ctx });
    }
    for (let i = 1; i + 2 < rows.length; i++) {
      if ((rows[i].ts - rows[i - 1].ts) / min < 60) continue;
      const a = rows[i + 1];
      const b = rows[i + 2];
      if ((a.ts - rows[i].ts) / min > 5 || (b.ts - a.ts) / min > 5 || a.ctx < 30e3 || b.ctx < 30e3) continue;
      idle.push({ version: rows[i].version, value: a.cr < 0.3 * a.ctx && b.cr < 0.3 * b.ctx });
    }
  }
  const warmT = rates(warm, REGRESS_MIN_N);
  const idleT = rates(idle, Math.max(5, REGRESS_MIN_N >> 2));
  for (const [id, t, minRate, floor] of [
    ["warm-cache-miss", warmT, 0.25, 0.01],
    ["post-idle-cold", idleT, 0.5, 0.02],
  ]) {
    const bad = t.filter((x) => x.rate >= minRate && x.rate >= 3 * Math.max(x.baseline, floor)).map((x) => x.version);
    for (const [from, to] of ranges(bad, t.map((x) => x.version))) findings.push({ id, from, to });
  }

  const ttl = new Map();
  for (const rows of main)
    for (const r of rows) {
      if (r.c5 + r.c1 === 0) continue;
      const t = ttl.get(r.version) ?? { c5: 0, c1: 0, n: 0 };
      t.c5 += r.c5;
      t.c1 += r.c1;
      t.n++;
      ttl.set(r.version, t);
    }
  const ttlBase = [...ttl.entries()]
    .sort((a, b) => vcmp(a[0], b[0]))
    .filter(([, t]) => t.n >= REGRESS_MIN_N)
    .map(([version, t]) => ({ version, n: t.n, share5m: t.c5 / (t.c5 + t.c1) }));
  const all5 = ttlBase.reduce((a, r) => a + r.share5m * r.n, 0);
  const allN = ttlBase.reduce((a, r) => a + r.n, 0);
  const ttlT = ttlBase.map((r) => ({ ...r, baseline: allN - r.n ? (all5 - r.share5m * r.n) / (allN - r.n) : 0 }));
  const ttlBad = ttlT.filter((r) => r.share5m >= 0.5 && r.baseline <= 0.2 && allN - r.n >= REGRESS_MIN_N).map((r) => r.version);
  for (const [from, to] of ranges(ttlBad, ttlT.map((r) => r.version))) findings.push({ id: "ttl-5m", from, to });

  const unc = new Map();
  for (const rows of main)
    for (const r of rows) {
      if (!r.afterTool || r.ctx < 20e3) continue;
      const k = `${r.model}\u0000${r.version}`;
      unc.set(k, [...(unc.get(k) ?? []), r]);
    }
  const groups = [...unc.values()]
    .filter((a) => a.length >= Math.max(5, REGRESS_MIN_N >> 2))
    .map((a) => ({ model: a[0].model, version: a[0].version, n: a.length, median: upperMedian(a.map((r) => r.inp)) }));
  const uncT = groups.map((g) => {
    const others = groups.filter((o) => o.model === g.model && o.version !== g.version);
    return { ...g, baseline: others.length ? upperMedian(others.map((o) => o.median)) : null };
  });
  const uncBad = uncT.filter((r) => r.median >= 500 && (r.baseline === null || r.baseline < 100)).map((r) => r.version);
  for (const [from, to] of ranges(uncBad, [...new Set(uncT.map((r) => r.version))].sort(vcmp)))
    findings.push({ id: "uncached-input", from, to });

  const hb = new Map();
  for (const rows of main) {
    let last = null;
    for (let i = 1; i < rows.length; i++) {
      const p = rows[i - 1];
      const r = rows[i];
      if ((r.ts - p.ts) / min > 5 || p.ctx < 50e3 || r.ctx < 0.6 * p.ctx || r.cr >= 0.2 * p.ctx) continue;
      const g = hb.get(r.version) ?? [];
      if (last !== null) g.push((r.ts - last) / min);
      last = r.ts;
      hb.set(r.version, g);
    }
  }
  const hbT = [...hb.entries()]
    .sort((a, b) => vcmp(a[0], b[0]))
    .map(([version, iv]) => ({ version, n: iv.length, hourly: iv.filter((x) => x >= 50 && x <= 70).length }));
  const hbBad = hbT.filter((r) => r.n >= 4 && r.hourly / r.n >= 0.5).map((r) => r.version);
  for (const [from, to] of ranges(hbBad, hbT.map((r) => r.version))) findings.push({ id: "hourly-rebuild", from, to });

  const all = files.flat();
  const rows = all.filter((r) => !r.automated);
  const versions = [...new Set(rows.map((r) => r.version))].sort(vcmp);
  const ts = rows.map((r) => r.ts).filter((t) => t > 0).sort((a, b) => a - b);
  const coverage = {
    requests: rows.length,
    excludedAutomated: all.length - rows.length,
    sessions: files.filter((f) => f.some((r) => !r.automated)).length,
    versions: versions.length,
    firstVersion: versions[0] ?? null,
    lastVersion: versions.at(-1) ?? null,
    from: ts.length ? new Date(ts[0]).toISOString().slice(0, 10) : null,
    to: ts.length ? new Date(ts.at(-1)).toISOString().slice(0, 10) : null,
    knownWindowsCovered: KNOWN_REGRESSIONS.filter((k) => versions.some((v) => vcmp(v, k.from) >= 0 && vcmp(v, k.to) <= 0)).map((k) => k.id),
  };
  return { coverage, findings, tables: { warmCacheMiss: warmT, postIdleCold: idleT, ttl5m: ttlT, uncachedInput: uncT, hourlyRebuild: hbT } };
}

/** Codex: per version / model / plan / window, the percent its requests were charged (rise by rise, by tokens) per 1M uncached + output tokens. */
function regressCodex(codexFiles, readings) {
  const requests = codexFiles
    .flatMap((f) =>
      f.own.map((r) => ({
        at: ms(r.ts),
        tokens: tokensOf(r),
        work: r.inp + r.cw + r.out,
        model: r.model ?? "?",
        version: (f.cliVersion ?? "?").replace(/-.*/, ""),
      })),
    )
    .filter((r) => r.at !== undefined && r.tokens > 0);
  const groups = new Map();
  for (const w of limitWindows(readings).values()) {
    for (const p of w.periods) {
      const rs = inPeriod(p, requests);
      let k = 0;
      for (const { at, rise } of p.rises) {
        const group = [];
        while (k < rs.length && rs[k].at <= at) group.push(rs[k++]);
        const t = group.reduce((a, r) => a + r.tokens, 0);
        if (t === 0) continue;
        for (const r of group) {
          const key = [r.version, r.model, p.plan ?? "?", w.limitId, w.wm].join("|");
          const g = groups.get(key) ?? { version: r.version, model: r.model, plan: p.plan ?? "?", limitId: w.limitId, windowMinutes: w.wm, requests: 0, percent: 0, workTokens: 0 };
          g.requests++;
          g.percent += (rise * r.tokens) / t;
          g.workTokens += r.work;
          groups.set(key, g);
        }
      }
    }
  }
  const table = [...groups.values()]
    .filter((g) => g.workTokens >= 200_000)
    .map((g) => ({ ...g, percentPerMillion: g.percent / (g.workTokens / 1e6) }))
    .sort((a, b) => vcmp(a.version, b.version) || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0) || a.windowMinutes - b.windowMinutes || (a.limitId < b.limitId ? -1 : 1));
  const findings = [];
  for (const r of table) {
    const peers = table.filter((o) => o !== r && o.plan === r.plan && o.limitId === r.limitId && o.windowMinutes === r.windowMinutes);
    if (!peers.length) continue;
    const base = upperMedian(peers.map((o) => o.percentPerMillion));
    if (base > 0 && r.percentPerMillion >= 2 * base) findings.push({ id: "codex-limit-burn", from: r.version, to: r.version });
  }
  const versions = [...new Set(requests.map((r) => r.version))].sort(vcmp);
  return { requests: requests.length, versions: versions.length, table, findings };
}

function regressChecks(claudeFiles, codexFiles, pass) {
  const tag = `[regress ${pass}]`;
  const j = sipcode(["regress", "--json"]).json;
  const c = regressClaude(regressClaudeFiles(claudeFiles));
  const sipCov = j?.coverage?.claudeCode ?? {};
  for (const k of Object.keys(c.coverage)) {
    check(`${tag} claude-code coverage ${k}`, JSON.stringify(c.coverage[k]), JSON.stringify(sipCov[k]));
  }
  // Rows compared in (version, model) order: table order is not part of the result.
  const byKey = (a, b) => vcmp(a.version, b.version) || String(a.model ?? "").localeCompare(String(b.model ?? ""));
  for (const [name, rows] of Object.entries(c.tables)) {
    const mine = [...rows].sort(byKey);
    const theirs = [...(j?.checks?.claudeCode?.[name] ?? [])].sort(byKey);
    check(`${tag} ${name} rows`, mine.length, theirs.length);
    let differing = 0;
    mine.forEach((m, i) => {
      const t = theirs[i];
      if (!t) return differing++;
      for (const [k, v] of Object.entries(m)) {
        const ok = typeof v === "number" ? Math.abs(v - t[k]) <= EPS : v === t[k];
        if (!ok) return differing++;
      }
    });
    check(`${tag} ${name} rows differing`, 0, differing);
  }
  const { readings } = limitReadings();
  const x = regressCodex(codexFiles, readings);
  check(`${tag} codex requests`, x.requests, j?.coverage?.codex?.requests);
  check(`${tag} codex versions`, x.versions, j?.coverage?.codex?.versions);
  const theirs = j?.checks?.codex ?? [];
  check(`${tag} codex groups`, x.table.length, theirs.length);
  let differing = 0;
  x.table.forEach((m, i) => {
    const t = theirs[i];
    if (!t) return differing++;
    for (const k of ["version", "model", "plan", "limitId", "windowMinutes", "requests", "workTokens"]) if (m[k] !== t[k]) return differing++;
    for (const k of ["percent", "percentPerMillion"]) if (Math.abs(m[k] - t[k]) > 1e-6) return differing++;
  });
  check(`${tag} codex groups differing`, 0, differing);
  const mineF = [...c.findings, ...x.findings].map((f) => `${f.id} ${f.from} ${f.to}`).sort();
  const sipF = (j?.findings ?? []).map((f) => `${f.id} ${f.from} ${f.to}`).sort();
  check(`${tag} findings`, JSON.stringify(mineF), JSON.stringify(sipF));
  check(`${tag} nothing read`, c.coverage.requests === 0 && x.requests === 0, j?.access?.nothingRead);
  console.log(`${tag} ${c.coverage.requests} interactive requests, ${c.coverage.excludedAutomated} automated left out, ${x.table.length} Codex groups, ${mineF.length} finding(s)`);
}
```

- [ ] **Step 6: Run it in both cache passes**

In `main()` replace:

```js
      limitsChecks(codex, pass);
    }
```

with:

```js
      limitsChecks(codex, pass);
      regressChecks(claude, codex, pass);
    }
```

- [ ] **Step 7: Syntax check**

Run: `node --check scripts/verify-counts.mjs`
Expected: no output, exit 0. (The full run on real logs is Task 15.)

- [ ] **Step 8: Commit**

```bash
git add scripts/verify-counts.mjs
git commit -m "test(verify): independent recomputation of every regress number" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Docs: README, PRIVACY, CHANGELOG, llms files

**Files:**
- Modify: `README.md`, `PRIVACY.md`, `CHANGELOG.md`, `docs/site/public/llms.txt`, `docs/site/public/llms-full.txt`

Copy rules apply to every line: no em or en dashes as dashes, no hype, no roadmap promises, never "stops hallucinations", never "nerfed".

- [ ] **Step 1: README: `regress` reads Codex too**

Replace:

```markdown
**Commands that read Codex:** `stats`, `today`, `forecast`, `trend`, `impact`, `why`, `receipt`, `drift` and `limits` (Codex only),
```

with:

```markdown
**Commands that read Codex:** `stats`, `today`, `forecast`, `trend`, `impact`, `why`, `receipt`, `drift`, `regress` and `limits` (Codex only),
```

- [ ] **Step 2: README: the two new sections**

Replace:

```markdown
- Claude Code's logs do not record limits, so `limits --agent claude-code` stops with error E009.

---

## How to install (more detail)
```

with:

````markdown
- Claude Code's logs do not record limits, so `limits --agent claude-code` stops with error E009.

### Did it get worse after an update? `sipcode regress`

`sipcode regress` checks your own Claude Code and Codex logs for regressions that arrive with an update, and names the version that brought each one. Each version is compared with your other versions, so no outside baseline is needed, and nothing leaves your machine.

```
sipcode regress · local only, no network
Claude Code: 27,671 interactive requests in 42 sessions (710 subagent and Agent SDK requests left out of the comparison), 2026-05-04 to 2026-10-12, versions 2.1.121 to 2.1.295
Known-regression windows your logs cover: R1, R4, R5
Codex: 930 requests in 15 sessions, 2026-03-28 to 2026-10-08, versions 0.118.0 to 0.162.0, 3 version/model groups with enough limit data

No regressions detected in your logs.
```

| Check | What it looks for | Confirmed regression it catches |
|---|---|---|
| `warm-cache-miss` | back-to-back requests (under 5 minutes apart) that re-write most of the context | R2: `--resume` prompt-cache miss (2.1.69 to 2.1.89) |
| `post-idle-cold` | the cache staying cold for the next requests after a break of an hour or more | R3: thinking history cleared after an idle hour (2.1.85 to 2.1.100) |
| `ttl-5m` | main-conversation cache written with the 5-minute TTL instead of 1 hour | R4: 1-hour cache TTL downgraded to 5 minutes (fixed in 2.1.129) |
| `uncached-input` | large uncached input on requests right after a tool result | R1: Fable 5.1 tool context re-sent uncached (2.1.257 to 2.1.259) |
| `hourly-rebuild` | the whole prompt cache rebuilt about every hour | R5: OAuth refresh rebuilt the cache hourly (fixed in 2.1.248) |
| `codex-limit-burn` | a Codex version using more of your limit per token than your other versions on the same plan and window | none in the catalog |

- A finding outside the known catalog is a signal worth reporting, not proof of a bug. A Codex finding could also be a limit change on your plan at the same time, and Codex on your other devices or in the cloud shares the same limit.
- Subagent and Agent SDK requests are left out: their cache policy differs by design.
- `--bug-report` adds a block to paste into a GitHub issue: token counts, versions, dates and short session ids only. Review it before posting.
- `--json` for scripts, `--agent claude-code` or `--agent codex` for one tool, `--min-n <n>` for the minimum requests per version a check needs (default 20).
- If no logs can be read (for example a sandbox blocks the folders), it prints "Nothing to analyse ... This is NOT a clean result." and exits with code 2. With too little data it says "Not enough data to compare versions yet".
- An independent counter that shares no code with Sipcode ([`scripts/verify-counts.mjs`](scripts/verify-counts.mjs)) recomputes the coverage, every check's table and the findings of `regress --json` from the same logs.

### Use Sipcode inside Codex

The Sipcode plugin lets you ask Codex (the ChatGPT desktop app or the Codex CLI) about your own usage in plain words. Each answer comes from the `sipcode` CLI on your computer, reading your local logs.

1. Install Sipcode once: `npm i -g sipcode` (Node.js 20 or newer). The plugin runs the installed `sipcode`; it does not use `npx`, because Codex's sandbox usually blocks downloads.
2. Add the plugin:
   - Codex CLI: run `codex plugin marketplace add Anuj7411/sipcode`, then open `/plugins` in Codex and install **Sipcode**.
   - ChatGPT desktop app: open **Plugins**, add a marketplace with `https://github.com/Anuj7411/sipcode`, then install **Sipcode**.
3. Ask:

| Ask | Sipcode runs |
|---|---|
| "How much did I spend on Codex this month?" | `sipcode forecast --agent codex --json` (also `today` and `stats`) |
| "How close am I to my Codex limit? Did it shrink?" | `sipcode limits --json` |
| "Why was my last Codex session so expensive?" | `sipcode why --agent codex --json` |
| "Did Codex or Claude Code get worse after an update?" | `sipcode regress --bug-report` |

If Codex's sandbox blocks `~/.codex` or `~/.claude`, the plugin asks for permission to run the command with read access instead of reporting an empty result. Dollar figures are at API prices; on a ChatGPT plan you are not billed per token. The plugin is instructions only (four skills): no hooks, no MCP server, no network calls. Update it with `codex plugin marketplace upgrade sipcode`.

---

## How to install (more detail)
````

- [ ] **Step 3: README: commands table, "What you get", FAQ**

Replace:

```markdown
| `sipcode limits` | Codex usage limits: when you run out at this pace, what used them, tokens per 1% over time |
| `sipcode trend` |
```

with:

```markdown
| `sipcode limits` | Codex usage limits: when you run out at this pace, what used them, tokens per 1% over time |
| `sipcode regress` | Did Claude Code or Codex get worse after an update? Each version against your other versions |
| `sipcode trend` |
```

Replace:

```markdown
| Codex limits | When you will hit your Codex limit, what used it, and whether it may have shrunk |
```

with:

```markdown
| Codex limits | When you will hit your Codex limit, what used it, and whether it may have shrunk |
| Regression check | Whether a Claude Code or Codex update changed cache or limit behaviour, pinned to the version |
| Codex plugin | Ask Codex about your spend, limits and regressions in plain words |
```

Replace:

```markdown
see [Codex](#codex) for what works and what is not supported for Codex yet.
```

with:

```markdown
see [Codex](#codex) for what works and what is not supported for Codex yet. Inside Codex itself, the Sipcode plugin answers spend, limit and regression questions (see [Use Sipcode inside Codex](#use-sipcode-inside-codex)).
```

- [ ] **Step 4: PRIVACY.md**

Replace:

```markdown
`sipcode why`, `stats`, `receipt`, `benchmark` parse these read-only.
```

with:

```markdown
`sipcode why`, `stats`, `receipt`, `benchmark`, `regress` parse these read-only.
```

Replace:

```markdown
`drift` and `limits` (and the MCP session tools and `get_codex_limits`) when Codex is installed.
```

with:

```markdown
`drift`, `regress` and `limits` (and the MCP session tools and `get_codex_limits`) when Codex is installed. The Sipcode plugin for Codex runs these same commands on your computer; it adds no network calls and stores nothing of its own.
```

Replace:

```markdown
(`today`, `forecast`, `limits`): for each session log, its size and modified time plus token counts, model names, timestamps, request ids, the session's working folder and the paths of files the agent read.
```

with:

```markdown
(`today`, `forecast`, `limits`, `regress`): for each session log, its size and modified time plus token counts, model names, timestamps, request ids, each Claude Code request's version and entrypoint and whether it followed a tool result, the session's working folder and the paths of files the agent read.
```

- [ ] **Step 5: CHANGELOG**

Replace:

```markdown
## [Unreleased]

_Nothing landed since [1.7.1]._
```

with (use the actual release date if it is not 2026-10-12):

```markdown
## [Unreleased]

_Nothing landed since [1.7.2]._

## [1.7.2] - 2026-10-12

Ask Codex about your usage in plain words with the new Sipcode plugin, and check whether a Claude Code or Codex update made things worse with `sipcode regress`.

### Added
- **`sipcode regress`.** Checks your own Claude Code and Codex logs for regressions and pins each one to the version that brought it, comparing each version with your other versions: prompt-cache misses on back-to-back turns, a cache that stays cold after an idle break, main-conversation cache written with the 5-minute TTL, large uncached input after tool results, the whole cache rebuilt about every hour, and a Codex version using more of your limit per token than your other versions on the same plan and window. Findings that match a confirmed regression (R1 to R5) say so; others are a signal worth reporting, not proof. `--bug-report` adds a GitHub-ready block (token counts only), `--json`, `--agent`, `--min-n` (default 20). Exit code 2 and "Nothing to analyse ... This is NOT a clean result." when no logs could be read.
- **Sipcode plugin for Codex** (`plugins/sipcode`, marketplace in `.agents/plugins/marketplace.json`): four skills that answer "how much did I spend", "how close am I to my limit", "why was that session expensive" and "did it get worse after an update" by running the installed `sipcode` CLI. Add it with `codex plugin marketplace add Anuj7411/sipcode` or from the ChatGPT desktop app's Plugins screen. Skills only: no hooks, no MCP server, no network calls.
- **Independent check:** `scripts/verify-counts.mjs` recomputes every `regress --json` number (coverage, the five Claude Code tables, the Codex table, the findings) from the raw logs without Sipcode code. All match on the maintainer's logs.

### Changed
- Period commands now also note Claude Code log folders they could not read (they already did for Codex).
- The usage cache stores each Claude Code request's version, entrypoint and two flags, so `regress` reuses it; the cache is rebuilt once after the update.

### Notes
- `regress` is not an MCP tool: a first run reads every transcript and can take longer than the MCP time limit. The MCP server still has 16 tools.
- Test count: 2,108 to 2,201 (`npx vitest run`, which includes the 20 e2e tests).
```

- [ ] **Step 6: llms.txt**

In `docs/site/public/llms.txt` replace:

```markdown
with a cautious possible-limit-cut flag.
```

with:

```markdown
with a cautious possible-limit-cut flag. `sipcode regress` checks the user's own Claude Code and Codex logs for regressions after an update (prompt-cache misses, 5-minute cache TTL, uncached context, hourly cache rebuilds, Codex limit draining faster per token) and pins each one to the version, comparing each version with the user's other versions. A Sipcode plugin for Codex (`codex plugin marketplace add Anuj7411/sipcode`) lets users ask about spend, limits and regressions in plain words; it runs the installed `sipcode` CLI.
```

Replace:

```markdown
- `sipcode forecast`: month-end spend projection with a confidence range
```

with:

```markdown
- `sipcode forecast`: month-end spend projection with a confidence range
- `sipcode regress`: did Claude Code or Codex get worse after an update, each version against the user's other versions
```

- [ ] **Step 7: llms-full.txt**

In `docs/site/public/llms-full.txt` replace:

```markdown
| `sipcode limits` | Codex usage limits: when you run out at this pace, what used them, tokens per 1% over time |
```

with:

```markdown
| `sipcode limits` | Codex usage limits: when you run out at this pace, what used them, tokens per 1% over time |
| `sipcode regress` | Did Claude Code or Codex get worse after an update? Each version against your other versions |
```

and replace:

```markdown
Writing rules to `AGENTS.md`, registering the MCP server in Codex, the proxy and hooks, `estimate` and `benchmark` are not supported for Codex yet.
```

with:

```markdown
Writing rules to `AGENTS.md`, registering the MCP server in Codex, the proxy and hooks, `estimate` and `benchmark` are not supported for Codex yet. Inside Codex, the Sipcode plugin (`codex plugin marketplace add Anuj7411/sipcode`, then install Sipcode) answers spend, limit, why-expensive and regression questions by running the installed `sipcode` CLI (`npm i -g sipcode` once).
```

- [ ] **Step 8: Check the copy rules on everything this release touched**

Run:

```bash
git diff -U0 -- README.md PRIVACY.md CHANGELOG.md docs/site/public | grep '^+' | grep -nP '[\x{2013}\x{2014}]|hallucinat|nerfed' || echo "clean"
```

Expected: `clean`. (The plugin's own copy rules are checked by `tests/plugin/codex-plugin.test.ts`.)

- [ ] **Step 9: Commit**

```bash
git add README.md PRIVACY.md CHANGELOG.md docs/site/public/llms.txt docs/site/public/llms-full.txt
git commit -m "docs: sipcode regress and the Sipcode plugin for Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Version 1.7.2 everywhere and the test count

`package.json` and `package-lock.json` are already 1.7.2 (Task 11).

**Files:**
- Modify: `server.json`, `docs/site/src/components/Hero.astro`, `docs/site/src/components/Footer.astro`, `README.md` (badge, "You should see"), `docs/site/public/llms.txt`, `docs/site/public/llms-full.txt`

- [ ] **Step 1: Count the tests**

Run in the background: `npx vitest run > "$SCRATCH/count.log" 2>&1; echo EXIT $? >> "$SCRATCH/count.log"` (this includes the 20 e2e tests, which need `npm run build` first: run `npm run build` before it).
Expected: `Tests  2201 passed (2201)`, no failed, no skipped: 2,108 + 93 (6 + 6 + 2 + 3 shared-module tests, 42 regress unit tests, 20 regress integration tests, 14 plugin tests). If it prints another total N with nothing failed (for example after review fixes in Task 16), use that N below and in the CHANGELOG line instead of 2,201.

- [ ] **Step 2: Bump the versions and the count**

| File | Old | New |
|---|---|---|
| `server.json` (2 places) | `"version": "1.7.1"` | `"version": "1.7.2"` |
| `docs/site/src/components/Hero.astro` | `// Last bumped: 2026-10-12 (v1.7.1: Codex limits; ...` and `const TEST_COUNT = 2108;` | `// Last bumped: 2026-10-12 (v1.7.2: Codex plugin and regress; \`npx vitest run\` count, e2e included).` and `const TEST_COUNT = 2201;` |
| `docs/site/src/components/Hero.astro` | `v1.7.1 · MIT licensed` | `v1.7.2 · MIT licensed` |
| `docs/site/src/components/Footer.astro` | `v1.7.1` and `2,108 tests passing` | `v1.7.2` and `2,201 tests passing` |
| `README.md` | `tests-2%2C108%20passing` and `alt="2108 tests passing"` | `tests-2%2C201%20passing` and `alt="2201 tests passing"` |
| `README.md` | ``You should see `1.7.1` or higher.`` | ``You should see `1.7.2` or higher.`` |
| `docs/site/public/llms.txt` and `llms-full.txt` | `has 2,108 passing tests` | `has 2,201 passing tests` |
| `docs/site/public/llms.txt` | `MIT licensed source, 2,108 tests` and `current version 1.7.1` | `MIT licensed source, 2,201 tests` and `current version 1.7.2` |
| `docs/site/public/llms-full.txt` | `should show 1.7.1 or higher` | `should show 1.7.2 or higher` |

- [ ] **Step 3: Confirm nothing still says 1.7.1 where it should not**

Run: `git grep -n "1\.7\.1" -- server.json README.md docs/site package.json`
Expected: no output (CHANGELOG keeps its `[1.7.1]` history and is not in the list).

- [ ] **Step 4: Commit**

```bash
git add server.json README.md CHANGELOG.md docs/site
git commit -m "release: v1.7.2 (Codex plugin, sipcode regress)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Full verification

- [ ] **Step 1: Typecheck and build**

Run: `npm run lint && npm run build`
Expected: no type errors; build ends `copy-assets: 7 file(s) copied to dist/.`

- [ ] **Step 2: Whole suite (background)**

Run: `npx vitest run > "$SCRATCH/vitest.log" 2>&1; echo EXIT $? >> "$SCRATCH/vitest.log"` with `run_in_background`, then read the tail.
Expected: `EXIT 0`, 2,201 passed (or the N from Task 14), no failed, no skipped.

- [ ] **Step 3: Release smoke**

Run: `npm run test:e2e`
Expected: 20 passed (`--version` prints `1.7.2`, `16 tools`, `regress` in `--help`).

- [ ] **Step 4: Freeze a copy of the real logs (background: about 5 GB)**

```bash
rm -rf "$SCRATCH/frozen" && mkdir -p "$SCRATCH/frozen/codex"
cp -r ~/.claude/projects "$SCRATCH/frozen/claude-projects"
cp -r ~/.codex/sessions "$SCRATCH/frozen/codex/" 2>/dev/null; cp -r ~/.codex/archived_sessions "$SCRATCH/frozen/codex/" 2>/dev/null; true
```

- [ ] **Step 5: Independent check on the frozen copy (background, about 20 minutes)**

```bash
SIPCODE_PROJECTS_DIR="$SCRATCH/frozen/claude-projects" CODEX_HOME="$SCRATCH/frozen/codex" node --max-old-space-size=8192 scripts/verify-counts.mjs > "$SCRATCH/verify.log" 2>&1; echo EXIT $? >> "$SCRATCH/verify.log"
```

Then: `grep -E "MISMATCH|\[regress|all checks match|mismatch|EXIT" "$SCRATCH/verify.log"`
Expected: no `MISMATCH`; for both `[regress cold cache]` and `[regress warm cache]`: coverage fields, the five Claude Code tables (`rows` and `rows differing: independent 0, sipcode 0`), `codex requests`, `codex versions`, `codex groups`, `codex groups differing`, `findings`, `nothing read` all `MATCH`; last lines `all checks match` and `EXIT 0`. On the copy this plan was written against (2026-10-12): 27,685 interactive requests, 710 automated left out, 42 sessions, 32 versions (2.1.121 to 2.1.295), windows R1, R4, R5; tables 29 / 23 / 29 / 57 / 19 rows; Codex 930 requests, 4 versions, 3 groups; zero findings.

- [ ] **Step 6: `regress` on the frozen copy, numbers only**

```bash
HOME="$SCRATCH/home" USERPROFILE="$SCRATCH/home" SIPCODE_PROJECTS_DIR="$SCRATCH/frozen/claude-projects" CODEX_HOME="$SCRATCH/frozen/codex" node dist/cli.js regress --json > "$SCRATCH/regress.json"; echo "exit $?"
node -e "const j=require(process.argv[1]);console.log(JSON.stringify({c:j.coverage,a:{...j.access,missingDirs:j.access.missingDirs.length},f:j.findings.map(f=>[f.id,f.from,f.to])}))" "$SCRATCH/regress.json"
```

Expected: `exit 0`, the coverage above, `nothingRead: false`, zero unreadable, findings `[]` (zero false positives, as with the prototype on the same machine). Report only these numbers.

- [ ] **Step 7: Delete the frozen copy and scratch files**

Run: `rm -rf "$SCRATCH/frozen" "$SCRATCH/home" "$SCRATCH/regress.json"`

---

### Task 16: Independent review

- [ ] **Step 1: Review the branch**

Dispatch a reviewer (superpowers:requesting-code-review, or the `code-review` skill at high effort) on `git diff main...codex-plugin` with this brief: "Check `sipcode regress` against `docs/superpowers/specs/2026-10-12-codex-plugin-design.md` sections 5 and 6 (every prototype behaviour carried, thresholds unchanged, nothing-read never clean), the four shared-module changes for regressions in existing commands, the plugin files against the official docs cited in section 8, and every user-facing string against the copy rules."

- [ ] **Step 2: Fix what it finds**

For each confirmed finding: write a failing test, fix, run the affected tests and `npm run lint`, commit (`fix(regress): ...`). Re-run Task 15 Steps 2 and 3 after the last fix.

---

### Task 17: Manual acceptance in the Codex desktop app (maintainer)

After the branch is merged, `v1.7.2` is published to npm and `main` holds the plugin:

- [ ] **Step 1:** `npm i -g sipcode@1.7.2`, then `sipcode --version` prints `1.7.2`.
- [ ] **Step 2:** In the ChatGPT desktop app open Plugins, add the marketplace `https://github.com/Anuj7411/sipcode`, install **Sipcode**. If the app's labels differ from README "Use Sipcode inside Codex" step 2, correct the README wording in a follow-up commit.
- [ ] **Step 3:** In a new chat ask: "How much did I spend on Codex this month?", "How close am I to my Codex usage limit?", "Why was my last Codex session so expensive?", "Did Codex or Claude Code get worse after an update?".
- [ ] **Step 4:** Pass when: each answer used the matching skill and command; every number equals the CLI's own output for the same command in a terminal; spend is described "at API prices"; any limit change is "possible" with the other-devices caveat; the regress answer quotes the coverage lines; nothing says "nerfed".
- [ ] **Step 5:** Edge cases: (a) temporarily `npm rm -g sipcode` and ask one question: the reply says to run `npm i -g sipcode` and stops (reinstall after); (b) if the sandbox blocks `~/.claude`, the regress skill asks for read access instead of reporting "No regressions detected".
- [ ] **Step 6:** Repeat Step 3's last question once in the Codex CLI after `codex plugin marketplace add Anuj7411/sipcode` and installing from `/plugins`.
