# Codex Analytics Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sipcode's analytics read OpenAI Codex rollout logs as accurately as Claude Code transcripts, show both tools side by side when both are installed, and stop counting requests that are repeated across log files (an 11.4% Claude over-count today).

**Architecture:** A shared `loadSessions` loader (discover → `--here` → read → parse → cross-file dedupe) replaces the copy-pasted loop in every period command. A new `codex` Agent adapter (discovery, parser, shell-read detector) plugs into the existing `Agent` interface and returns the same `ParsedSession` type, so every analyzer and renderer is reused. A `resolveDisplayAgents` helper decides which tools to show and renders section headers plus a combined line.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), Node ≥ 20, Vitest, Commander. Pure modules with I/O behind `FileSystem` / `ProcessEnv` / `Clock` seams (`InMemoryFs`, `FakeProcessEnv`, `FakeClock` in tests).

**Spec:** `docs/superpowers/specs/2026-10-08-codex-analytics-core-design.md`. Branch: `codex-support`. Ships as v1.7.0.

**Conventions for every task**
- Files may be CRLF. Edit with the Edit tool or a Node script that normalises `\r\n` → `\n`, edits, and writes back with the original line endings.
- Run a single test file with `npx vitest run <path>`; the full non-e2e suite with `npm test`; typecheck with `npm run lint`.
- Every behaviour fix gets a test that fails on the old code. Prove it once by temporarily restoring the old file (`git show HEAD:<path> > <path>`), running the test, and restoring the new file.
- Commit after each task. Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/modules/transcript/parse.ts` | modify | `AssistantTurn.requestKey`; `ParsedSession.agent`, `ParsedSession.isSubagent` |
| `src/modules/transcript/dedupe.ts` | create | Drop requests already counted in another session |
| `src/modules/transcript/discover.ts` | modify | `SessionMeta.cwd` (optional) |
| `src/modules/agents/types.ts` | modify | `AgentId` gains `"codex"`; `Agent.matchesCwd` |
| `src/modules/agents/claude-code/adapter.ts` | modify | `matchesCwd` (project-hash rule, moved from commands) |
| `src/modules/agents/cursor/adapter.ts` | modify | `matchesCwd` → `false` |
| `src/modules/agents/loadSessions.ts` | create | Shared discover → here → read → parse → dedupe |
| `src/lib/pricing/openai-2026-10-08.json` | create | OpenAI price table |
| `src/lib/pricing/load.ts` | modify | Merge newest OpenAI table into the returned model map |
| `src/modules/agents/codex/readDetect.ts` | create | Shell command → whole/partial file read target |
| `src/modules/agents/codex/parse.ts` | create | Rollout JSONL → `ParsedSession` |
| `src/modules/agents/codex/discover.ts` | create | List rollouts in `$CODEX_HOME` |
| `src/modules/agents/codex/adapter.ts` | create | `Agent` implementation for Codex |
| `src/modules/agents/registry.ts` | modify | Register `codex` |
| `src/modules/agents/multi.ts` | create | Which agents to show; section header; combined line |
| `src/commands/{stats,today,forecast,trend,impact}.ts` | modify | Use `loadSessions`; render one section per agent |
| `src/modules/agents/latest.ts` | create | Newest non-empty session across agents (+ hint) |
| `src/commands/{why,receipt,drift}.ts` | modify | Use `latest.ts` and the agent interface |
| `src/mcp/server.ts` | modify | Optional `agent` input; agent-aware session tools |
| `scripts/verify-counts.mjs` | create | Independent from-scratch counter (dev only, not shipped) |
| `tests/...` | create/modify | One test file per new module; command tests extended |

---

## Phase 1: shared loader and the cross-file dedupe fix (Claude)

### Task 1: Per-request key on Claude turns

**Files:**
- Modify: `src/modules/transcript/parse.ts` (`AssistantTurn` interface; turn creation in the `entry.type === "assistant"` branch)
- Test: `tests/modules/transcript/parse.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `tests/modules/transcript/parse.test.ts`:

```ts
describe("parseTranscript: request keys", () => {
  it("stamps each turn with message.id|requestId", () => {
    const line = JSON.stringify({
      type: "assistant", requestId: "req_9", timestamp: "2026-09-01T10:00:00.000Z",
      message: { id: "msg_9", model: "claude-opus-5", role: "assistant",
        content: [{ type: "text", text: "." }],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    });
    const r = parseTranscript(line);
    if (!r.ok) throw new Error("parse failed");
    expect(r.value.assistantTurns[0]!.requestKey).toBe("msg_9|req_9");
  });
});
```

- [ ] **Step 2: Run it.** `npx vitest run tests/modules/transcript/parse.test.ts` → FAIL (`requestKey` is undefined).

- [ ] **Step 3: Implement.** In `AssistantTurn` add after `cacheCreation1hTokens`:

```ts
  /** Stable id of the API request (Claude: `message.id|requestId`; Codex: `response_id`).
   *  Used to drop the same request when it is logged again in another file. */
  readonly requestKey?: string | undefined;
```

In the new-turn object literal (the `turn = { index: assistantTurns.length, ... }` block) add `requestKey,` after `missingUsage: !usage,`.

In `ParsedSession` add after `linesSkipped`:

```ts
  /** Which agent produced the transcript. Absent means claude-code (older callers). */
  readonly agent?: "claude-code" | "codex" | "cursor" | undefined;
  /** True for subagent / helper threads (Codex subagent rollouts). */
  readonly isSubagent?: boolean | undefined;
```

In the final `session` object add `agent: "claude-code",`.

- [ ] **Step 4: Run it.** Same command → PASS. Then `npm run lint` → clean.

- [ ] **Step 5: Commit.** `git add src/modules/transcript/parse.ts tests/modules/transcript/parse.test.ts && git commit -m "feat(transcript): per-request key on turns, agent field on sessions"`

### Task 2: `dedupeAcrossSessions`

**Files:**
- Create: `src/modules/transcript/dedupe.ts`
- Test: `tests/modules/transcript/dedupe.test.ts`

- [ ] **Step 1: Write the failing test** `tests/modules/transcript/dedupe.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dedupeAcrossSessions } from "../../../src/modules/transcript/dedupe.js";
import type { AssistantTurn, ParsedSession, ToolCall } from "../../../src/modules/transcript/parse.js";

function call(name: string, turn: number): ToolCall {
  return { name, input: {}, assistantTurnIndex: turn, timestamp: undefined, inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, resultTokens: 10 };
}
function turn(index: number, key: string | undefined, tools: string[] = []): AssistantTurn {
  return { index, model: "claude-opus-5", timestamp: undefined, inputTokens: 1, outputTokens: 1,
    cacheReadTokens: 100, cacheCreationTokens: 0, cacheCreation1hTokens: 0,
    toolCalls: tools.map((t) => call(t, index)), missingUsage: false, requestKey: key };
}
function session(id: string, startedAt: string, turns: AssistantTurn[]): ParsedSession {
  return { sessionId: id, cwd: "/p", primaryModel: "claude-opus-5", models: new Set(["claude-opus-5"]),
    startedAt, endedAt: startedAt, durationSec: 0, assistantTurns: turns,
    toolCalls: turns.flatMap((t) => t.toolCalls), userTurnCount: 1, linesParsed: 1, linesSkipped: 0 };
}

describe("dedupeAcrossSessions", () => {
  it("drops requests repeated in a later file (resumed session) and keeps the original", () => {
    const original = session("a", "2026-09-01T10:00:00Z", [turn(0, "k1"), turn(1, "k2")]);
    const resumed = session("b", "2026-09-01T10:00:00Z", [turn(0, "k1"), turn(1, "k2"), turn(2, "k3")]);
    const r = dedupeAcrossSessions([resumed, original]);
    expect(r.droppedRequests).toBe(2);
    const total = r.sessions.reduce((n, s) => n + s.assistantTurns.length, 0);
    expect(total).toBe(3);
  });

  it("keeps turns that have no request key", () => {
    const s1 = session("a", "2026-09-01T10:00:00Z", [turn(0, undefined)]);
    const s2 = session("b", "2026-09-02T10:00:00Z", [turn(0, undefined)]);
    expect(dedupeAcrossSessions([s1, s2]).droppedRequests).toBe(0);
  });

  it("drops the tool calls of dropped turns and re-indexes the rest", () => {
    const s1 = session("a", "2026-09-01T10:00:00Z", [turn(0, "k1", ["Read"])]);
    const s2 = session("b", "2026-09-02T10:00:00Z", [turn(0, "k1", ["Read"]), turn(1, "k2", ["Bash"])]);
    const out = dedupeAcrossSessions([s1, s2]).sessions[1]!;
    expect(out.assistantTurns.map((t) => t.index)).toEqual([0]);
    expect(out.toolCalls.map((c) => [c.name, c.assistantTurnIndex])).toEqual([["Bash", 0]]);
  });

  it("returns sessions in the input order", () => {
    const s1 = session("late", "2026-09-05T10:00:00Z", [turn(0, "k1")]);
    const s2 = session("early", "2026-09-01T10:00:00Z", [turn(0, "k1")]);
    const r = dedupeAcrossSessions([s1, s2]);
    expect(r.sessions.map((s) => s.sessionId)).toEqual(["late", "early"]);
    expect(r.sessions[0]!.assistantTurns).toHaveLength(0);
    expect(r.sessions[1]!.assistantTurns).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it.** `npx vitest run tests/modules/transcript/dedupe.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** `src/modules/transcript/dedupe.ts`:

```ts
/**
 * Cross-session request dedupe. Pure.
 *
 * Claude Code copies earlier requests into the new file when a session is
 * resumed, and Codex copies a parent's history into fork / subagent rollouts.
 * Summing each file on its own counts those requests twice (11.4% on one real
 * machine). The oldest session keeps each request; later copies are dropped.
 */
import type { AssistantTurn, ParsedSession } from "./parse.js";

export interface DedupeResult {
  /** Same order as the input. */
  readonly sessions: ParsedSession[];
  readonly droppedRequests: number;
}

export function dedupeAcrossSessions(
  sessions: ReadonlyArray<ParsedSession>,
): DedupeResult {
  const order = sessions
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.startedAt ?? "").localeCompare(b.s.startedAt ?? "") || a.i - b.i);
  const seen = new Set<string>();
  const out: ParsedSession[] = sessions.slice();
  let dropped = 0;
  for (const { s, i } of order) {
    const keep: number[] = [];
    s.assistantTurns.forEach((t, idx) => {
      if (t.requestKey) {
        if (seen.has(t.requestKey)) {
          dropped++;
          return;
        }
        seen.add(t.requestKey);
      }
      keep.push(idx);
    });
    out[i] = keep.length === s.assistantTurns.length ? s : rebuild(s, keep);
  }
  return { sessions: out, droppedRequests: dropped };
}

function rebuild(s: ParsedSession, keep: number[]): ParsedSession {
  const assistantTurns: AssistantTurn[] = keep.map((oldIdx, newIdx) => {
    const t = s.assistantTurns[oldIdx]!;
    return {
      ...t,
      index: newIdx,
      toolCalls: t.toolCalls.map((c) => ({ ...c, assistantTurnIndex: newIdx })),
    };
  });
  const counts = new Map<string, number>();
  for (const t of assistantTurns) if (t.model) counts.set(t.model, (counts.get(t.model) ?? 0) + 1);
  let primaryModel: string | undefined;
  let best = -1;
  for (const [m, c] of counts) {
    if (c > best) {
      best = c;
      primaryModel = m;
    }
  }
  return {
    ...s,
    assistantTurns,
    toolCalls: assistantTurns.flatMap((t) => t.toolCalls),
    models: new Set(counts.keys()),
    primaryModel,
  };
}
```

- [ ] **Step 4: Run it.** → PASS (4 tests). `npm run lint` → clean.

- [ ] **Step 5: Commit.** `git add src/modules/transcript/dedupe.ts tests/modules/transcript/dedupe.test.ts && git commit -m "feat(transcript): dedupe requests repeated across session files"`

### Task 3: `Agent.matchesCwd` and `SessionMeta.cwd`

**Files:**
- Modify: `src/modules/transcript/discover.ts` (`SessionMeta`), `src/modules/agents/types.ts` (`Agent`), `src/modules/agents/claude-code/adapter.ts`, `src/modules/agents/cursor/adapter.ts`
- Test: `tests/modules/agents/claude-code-adapter.test.ts` (create if absent; otherwise append)

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { claudeCodeAgent } from "../../../src/modules/agents/claude-code/adapter.js";

describe("claudeCodeAgent.matchesCwd", () => {
  const meta = (projectHash: string) => ({ sessionId: "s", filePath: "/x.jsonl", projectHash, mtimeMs: 0, size: 0 });
  it("matches Claude Code's project-dir encoding of the cwd", () => {
    expect(claudeCodeAgent.matchesCwd(meta("C--Projects-just-research"), "C:\\Projects\\just research")).toBe(true);
  });
  it("does not match another project", () => {
    expect(claudeCodeAgent.matchesCwd(meta("C--Projects-other"), "C:\\Projects\\Sipcode")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it** → FAIL (`matchesCwd` is not a function).

- [ ] **Step 3: Implement.**
  - `SessionMeta` (discover.ts) add: `/** Working directory recorded in the log, when the agent records one (Codex). */ readonly cwd?: string | undefined;`
  - `Agent` (types.ts) add after `parseTranscript`:

```ts
  /** --here: does this discovered session belong to the project at `cwd`? */
  matchesCwd(meta: SessionMeta, cwd: string): boolean;
```

  - Claude adapter: `import { cwdToProjectHash } from "../../transcript/discover.js";` and add

```ts
  matchesCwd(meta, cwd) {
    const h = cwdToProjectHash(cwd);
    return meta.projectHash === h || h.endsWith(meta.projectHash);
  },
```

  - Cursor adapter: `matchesCwd() { return false; },`

- [ ] **Step 4: Run it** → PASS; `npm run lint` → clean.

- [ ] **Step 5: Commit.** `git commit -am "feat(agents): Agent.matchesCwd for --here scoping"` (plus `git add` the new test file).

### Task 4: `loadSessions`

**Files:**
- Create: `src/modules/agents/loadSessions.ts`
- Test: `tests/modules/agents/loadSessions.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../../src/lib/fs.js";
import { FakeClock } from "../../../src/lib/clock.js";
import { FakeProcessEnv } from "../../../src/lib/process.js";
import { claudeCodeAgent } from "../../../src/modules/agents/claude-code/adapter.js";
import { loadSessions } from "../../../src/modules/agents/loadSessions.js";

const req = (id: string, ts: string) => JSON.stringify({
  type: "assistant", requestId: `req_${id}`, timestamp: ts, sessionId: "s",
  message: { id: `msg_${id}`, model: "claude-opus-5", role: "assistant", content: [{ type: "text", text: "." }],
    usage: { input_tokens: 1, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 } },
});

function deps() {
  const fs = new InMemoryFs();
  // b.jsonl is a resumed session: it repeats request 1 and adds request 2.
  fs.writeFile("/home/u/.claude/projects/C--p/a.jsonl", req("1", "2026-09-01T10:00:00Z"), Date.parse("2026-09-01T10:01:00Z"));
  fs.writeFile("/home/u/.claude/projects/C--p/b.jsonl",
    [req("1", "2026-09-01T10:00:00Z"), req("2", "2026-09-02T10:00:00Z")].join("\n"), Date.parse("2026-09-02T10:01:00Z"));
  fs.writeFile("/home/u/.claude/projects/C--q/c.jsonl", req("3", "2026-09-03T10:00:00Z"), Date.parse("2026-09-03T10:01:00Z"));
  return { fs, env: new FakeProcessEnv({ homeDir: "/home/u" }), clock: new FakeClock(new Date("2026-10-01T00:00:00Z")) };
}

describe("loadSessions", () => {
  it("counts a request repeated in a resumed file once", async () => {
    const r = await loadSessions({ agent: claudeCodeAgent, deps: deps(), cwd: "/" });
    if (!r.ok) throw new Error("load failed");
    const turns = r.value.sessions.reduce((n, s) => n + s.parsed.assistantTurns.length, 0);
    expect(turns).toBe(3);
    expect(r.value.droppedDuplicateRequests).toBe(1);
    expect(r.value.discovered).toBe(3);
  });

  it("applies --here through the agent", async () => {
    const r = await loadSessions({ agent: claudeCodeAgent, deps: deps(), cwd: "C:\\q", here: true });
    if (!r.ok) throw new Error("load failed");
    expect(r.value.sessions.map((s) => s.meta.sessionId)).toEqual(["c"]);
  });

  it("dedupes across ALL discovered sessions (no time pre-filter), so windows stay consistent", async () => {
    // Commands filter by window AFTER loading; an old original still removes its copies from a resumed file.
    const r = await loadSessions({ agent: claudeCodeAgent, deps: deps(), cwd: "/" });
    if (!r.ok) throw new Error("load failed");
    const b = r.value.sessions.find((s) => s.meta.sessionId === "b")!;
    expect(b.parsed.assistantTurns.map((t) => t.requestKey)).toEqual(["msg_2|req_2"]);
    expect(b.parsed.startedAt).toBe("2026-09-02T10:00:00Z");
  });
});
```

- [ ] **Step 2: Run it** → FAIL (module not found).

- [ ] **Step 3: Implement** `src/modules/agents/loadSessions.ts`:

```ts
/**
 * Shared session loading for every period command and every agent:
 * discover → --here → read → parse → cross-file dedupe (commands window afterwards).
 * Unreadable files are counted, never silently dropped.
 */
import { ok, type Result } from "../../lib/result.js";
import type { SipcodeIssue } from "../../lib/errors.js";
import { dedupeAcrossSessions } from "../transcript/dedupe.js";
import type { ParsedSession, SessionMeta } from "./shared.js";
import type { Agent, AgentDeps } from "./types.js";

export interface LoadedSession {
  readonly meta: SessionMeta;
  readonly parsed: ParsedSession;
}

export interface LoadSessionsInput {
  readonly agent: Agent;
  readonly deps: AgentDeps;
  readonly cwd: string;
  readonly here?: boolean | undefined;
}

export interface LoadSessionsOutput {
  readonly sessions: LoadedSession[];
  /** Files discovered before any filtering (tells a brand-new user from an empty window). */
  readonly discovered: number;
  readonly unreadable: number;
  readonly droppedDuplicateRequests: number;
  readonly issues: SipcodeIssue[];
}

export async function loadSessions(
  input: LoadSessionsInput,
): Promise<Result<LoadSessionsOutput, SipcodeIssue[]>> {
  const { agent, deps, cwd } = input;
  const discovery = await agent.discoverSessions(deps);
  if (!discovery.ok) return discovery;
  let metas = discovery.value;
  const discovered = metas.length;
  // --here before dedupe is safe: a resumed session stays in its project.
  // No time pre-filter: an old original must still remove its copies from a
  // newer resumed file. Commands apply their window after loading.
  if (input.here) metas = metas.filter((m) => agent.matchesCwd(m, cwd));
  const loaded: { meta: SessionMeta; parsed: ParsedSession }[] = [];
  const issues: SipcodeIssue[] = [];
  let unreadable = 0;
  for (const meta of metas) {
    let content: string;
    try {
      content = await deps.fs.readFile(meta.filePath);
    } catch {
      unreadable++;
      continue;
    }
    const parsed = agent.parseTranscript(content);
    if (!parsed.ok) {
      issues.push(...parsed.error);
      continue;
    }
    loaded.push({ meta, parsed: parsed.value });
  }
  const d = dedupeAcrossSessions(loaded.map((l) => l.parsed));
  return ok({
    sessions: loaded.map((l, i) => ({ meta: l.meta, parsed: d.sessions[i]! })),
    discovered,
    unreadable,
    droppedDuplicateRequests: d.droppedRequests,
    issues,
  });
}
```

- [ ] **Step 4: Run it** → PASS (3 tests); `npm run lint` → clean.

- [ ] **Step 5: Commit.** `git add src/modules/agents/loadSessions.ts tests/modules/agents/loadSessions.test.ts && git commit -m "feat(agents): shared loadSessions (discover, --here, dedupe)"`

### Task 5: Period commands use `loadSessions`

**Files:** `src/commands/stats.ts`, `today.ts`, `forecast.ts`, `trend.ts`, `impact.ts`. Tests: `tests/integration/stats.integration.test.ts` (new case), existing command tests must stay green.

- [ ] **Step 1: Write the failing test.** Append to `tests/integration/stats.integration.test.ts`:

```ts
describe("runStats: resumed sessions are not double counted", () => {
  it("counts a request repeated in a resumed file once", async () => {
    const fs = new InMemoryFs();
    const req = (id: string) => JSON.stringify({
      type: "assistant", requestId: `req_${id}`, timestamp: "2026-05-10T10:00:00.000Z", sessionId: "s",
      message: { id: `msg_${id}`, model: "claude-opus-4-8", role: "assistant", content: [{ type: "text", text: "." }],
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0 } },
    });
    const t = new Date("2026-05-10T10:05:00Z").getTime();
    fs.writeFile("/home/u/.claude/projects/C--p/orig.jsonl", req("1"), t);
    fs.writeFile("/home/u/.claude/projects/C--p/resumed.jsonl", [req("1"), req("2")].join("\n"), t);
    const out: string[] = [];
    const r = await runStats({ json: true, since: "30d" },
      { fs, env: makeEnv(), clock: new FakeClock(NOW), stdout: (s) => out.push(s), stderr: () => {} });
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(out.join("\n"));
    expect(j.totals.totalTokens).toBe(2_000_000);
  });
});
```

- [ ] **Step 2: Run it** → FAIL (3,000,000: request 1 counted twice).

- [ ] **Step 3: Implement.** In each command, replace the block from `const discovery = await agent.discoverSessions(...)` (or `metasResult`) through the end of the `for (const meta of metas)` read/parse prologue with a `loadSessions` call, and iterate the loaded sessions. Exact replacements:

  **stats.ts**: replace the discovery block, the `--here` block and the loop header/body prologue with:

```ts
  const loaded = await loadSessions({
    agent,
    deps: { fs, env, clock },
    cwd,
    here: opts.here,
    // Files last modified before the window are only key-scanned (Task 4b): they
    // still remove their copies from newer resumed files, but are not parsed.
    windowSinceMs: Date.parse(window.sinceIso),
  });
  if (!loaded.ok) {
    for (const i of loaded.error) stderr(i.message);
    return { exitCode: 1 };
  }
  const totalDiscovered = loaded.value.discovered;
  const pricing = loadPricingForDate(new Date(window.untilIso));
  const ageDays = pricingAgeDays(pricing, clock.now());
  const aggregated: AggregatedSession[] = [];
  const warnings: { code: string; message: string }[] = [];
  if (loaded.value.unreadable > 0) {
    warnings.push({ code: "E003", message: `couldn't read ${loaded.value.unreadable} transcript file(s); totals exclude them.` });
  }
  // Parse problems must surface (review finding: a Codex parse error would otherwise vanish).
  for (const i of loaded.value.issues) warnings.push({ code: i.code, message: i.message });
  for (const { meta, parsed } of loaded.value.sessions) {
    const startedAt = parsed.startedAt ?? new Date(meta.mtimeMs).toISOString();
    if (!isInWindow(window, startedAt)) continue;
    // ...unchanged from here: analyzeTokens, isEmptySession, analyzeDuplicateReads, analyzeIdleContext, aggregateSession...
```

  **today.ts / forecast.ts**: replace the discovery + `--here` + `for (const meta of metas) { ...read...parse... }` prologue with the block below. Pass `windowSinceMs`: today → start of the local day (`new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()` minus 1 day of slack for timezone edges); forecast → start of the current month minus 1 day. On `loaded.value.unreadable > 0` or `issues.length > 0` print one stderr line (terminal mode only): `note: N transcript file(s) could not be read or parsed; totals exclude them.`

```ts
  const loaded = await loadSessions({ agent, deps: { fs, env, clock }, cwd: opts.cwd ?? process.cwd(), here: opts.here, windowSinceMs });
  if (!loaded.ok) {
    stderr(loaded.error.map((e) => e.message).join("\n"));
    return { exitCode: 1 };
  }
  for (const { meta, parsed } of loaded.value.sessions) {
    const startedAt = parsed.startedAt ?? new Date(meta.mtimeMs).toISOString();
    // ...unchanged analysis from here...
```

  **trend.ts**: same, with `windowSinceMs: Date.parse(sinceIso)`; keep the `startedDay` window check (it now sees recomputed start times for resumed sessions).

  **impact.ts**: inside `if (projectsExists)`, replace discovery + `--here` + read/parse with the same `loadSessions` call (`cwd`, `here: opts.here`, `deps: { fs: fileSys, env, clock }`, no `windowSinceMs`: impact compares before/after install and needs all history).

  In all five, add `import { loadSessions } from "../modules/agents/loadSessions.js";` and remove now-unused imports (`cwdToProjectHash`, and `path` where it was only used for the warning). Run `npm run lint` to catch them.

- [ ] **Step 4: Run tests.** `npx vitest run tests/integration/stats.integration.test.ts` → PASS; `npm test` → all green.

- [ ] **Step 5: Real-data check.** `npm run build`, then compare `node dist/cli.js stats --since all --json` total tokens with the installed v1.6.21 (`sipcode stats --since all --json`). Expected: about 11% lower (13.37B → ~12.0B on the maintainer machine) and equal to `node /tmp/xfile2.mjs`'s "deduped" figure for the same file set (recreate that script from the session notes if needed: it sums unique `message.id|requestId` across top-level project files).

- [ ] **Step 6: Prove the test fails on old code** (restore old `stats.ts`, run the new test → FAIL, restore new), then commit: `git commit -am "fix(stats,today,forecast,trend,impact): count requests repeated across files once"`

---

## Phase 2: Codex parsing

### Task 6: OpenAI price table

**Files:**
- Create: `src/lib/pricing/openai-2026-10-08.json`
- Modify: `src/lib/pricing/load.ts`
- Test: `tests/lib/pricing.test.ts`

- [ ] **Step 1: Verify prices against the primary source.** Fetch `https://developers.openai.com/api/docs/pricing` (WebFetch) and confirm every row below; correct any difference before writing the file. Long-context rule to confirm: requests over 272K input tokens bill input, cached input and cache write at 2x and output at 1.5x, for gpt-6.x, gpt-5.6, gpt-5.5, gpt-5.4.

- [ ] **Step 2: Write the failing test** (append to `tests/lib/pricing.test.ts`):

```ts
describe("OpenAI models (Codex)", () => {
  const p = loadPricingForDate(new Date("2026-10-08"));
  it("prices gpt-6.1-sol with its long-context tier", () => {
    const r = priceForModel(p, "gpt-6.1-sol");
    expect(r?.input_per_mtok).toBe(2);
    expect(r?.cache_read_per_mtok).toBe(0.1);
    expect(r?.long_prompt?.over_tokens).toBe(272000);
    expect(r?.long_prompt?.output_per_mtok).toBe(15);
  });
  it("is available for older session dates too", () => {
    expect(priceForModel(loadPricingForDate(new Date("2026-04-01")), "gpt-5.4")?.input_per_mtok).toBe(2.5);
  });
  it("leaves unknown models unpriced", () => {
    expect(priceForModel(p, "codex-auto-review")).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run it** → FAIL.

- [ ] **Step 4: Create** `src/lib/pricing/openai-2026-10-08.json` (values from Step 1; `cache_creation_per_mtok` = cache-write price, or the input price where OpenAI lists no cache-write price):

```json
{
  "as_of": "2026-10-08",
  "source_url": "https://developers.openai.com/api/docs/pricing",
  "models": {
    "gpt-6-astra": { "input_per_mtok": 10, "output_per_mtok": 50, "cache_read_per_mtok": 1.0, "cache_creation_per_mtok": 12.5,
      "long_prompt": { "over_tokens": 272000, "input_per_mtok": 20, "output_per_mtok": 75, "cache_read_per_mtok": 2.0, "cache_creation_per_mtok": 25 } },
    "gpt-6.1-sol": { "input_per_mtok": 2, "output_per_mtok": 10, "cache_read_per_mtok": 0.1, "cache_creation_per_mtok": 2.5,
      "long_prompt": { "over_tokens": 272000, "input_per_mtok": 4, "output_per_mtok": 15, "cache_read_per_mtok": 0.2, "cache_creation_per_mtok": 5 } },
    "gpt-6-sol": { "input_per_mtok": 2, "output_per_mtok": 10, "cache_read_per_mtok": 0.2, "cache_creation_per_mtok": 2.5,
      "long_prompt": { "over_tokens": 272000, "input_per_mtok": 4, "output_per_mtok": 15, "cache_read_per_mtok": 0.4, "cache_creation_per_mtok": 5 } },
    "gpt-6-luna": { "input_per_mtok": 0.1, "output_per_mtok": 0.5, "cache_read_per_mtok": 0.01, "cache_creation_per_mtok": 0.125,
      "long_prompt": { "over_tokens": 272000, "input_per_mtok": 0.2, "output_per_mtok": 0.75, "cache_read_per_mtok": 0.02, "cache_creation_per_mtok": 0.25 } },
    "gpt-5.6-sol": { "input_per_mtok": 4, "output_per_mtok": 20, "cache_read_per_mtok": 0.4, "cache_creation_per_mtok": 5,
      "long_prompt": { "over_tokens": 272000, "input_per_mtok": 8, "output_per_mtok": 30, "cache_read_per_mtok": 0.8, "cache_creation_per_mtok": 10 } },
    "gpt-5.6-terra": { "input_per_mtok": 2, "output_per_mtok": 12, "cache_read_per_mtok": 0.2, "cache_creation_per_mtok": 2.5,
      "long_prompt": { "over_tokens": 272000, "input_per_mtok": 4, "output_per_mtok": 18, "cache_read_per_mtok": 0.4, "cache_creation_per_mtok": 5 } },
    "gpt-5.6-luna": { "input_per_mtok": 0.2, "output_per_mtok": 1.2, "cache_read_per_mtok": 0.02, "cache_creation_per_mtok": 0.25,
      "long_prompt": { "over_tokens": 272000, "input_per_mtok": 0.4, "output_per_mtok": 1.8, "cache_read_per_mtok": 0.04, "cache_creation_per_mtok": 0.5 } },
    "gpt-5.5": { "input_per_mtok": 5, "output_per_mtok": 30, "cache_read_per_mtok": 0.5, "cache_creation_per_mtok": 5,
      "long_prompt": { "over_tokens": 272000, "input_per_mtok": 10, "output_per_mtok": 45, "cache_read_per_mtok": 1.0, "cache_creation_per_mtok": 10 } },
    "gpt-5.4": { "input_per_mtok": 2.5, "output_per_mtok": 15, "cache_read_per_mtok": 0.25, "cache_creation_per_mtok": 2.5,
      "long_prompt": { "over_tokens": 272000, "input_per_mtok": 5, "output_per_mtok": 22.5, "cache_read_per_mtok": 0.5, "cache_creation_per_mtok": 5 } },
    "gpt-5.4-mini": { "input_per_mtok": 0.75, "output_per_mtok": 4.5, "cache_read_per_mtok": 0.075, "cache_creation_per_mtok": 0.75 },
    "gpt-5.3-codex": { "input_per_mtok": 1.75, "output_per_mtok": 14, "cache_read_per_mtok": 0.175, "cache_creation_per_mtok": 1.75 },
    "gpt-5.2": { "input_per_mtok": 1.75, "output_per_mtok": 14, "cache_read_per_mtok": 0.175, "cache_creation_per_mtok": 1.75 },
    "gpt-5.1": { "input_per_mtok": 1.25, "output_per_mtok": 10, "cache_read_per_mtok": 0.125, "cache_creation_per_mtok": 1.25 },
    "gpt-5": { "input_per_mtok": 1.25, "output_per_mtok": 10, "cache_read_per_mtok": 0.125, "cache_creation_per_mtok": 1.25 },
    "gpt-5-mini": { "input_per_mtok": 0.25, "output_per_mtok": 2, "cache_read_per_mtok": 0.025, "cache_creation_per_mtok": 0.25 }
  }
}
```

Model-id matching uses the existing longest-prefix rule, so `gpt-5.4-mini` never falls back to `gpt-5.4`, and dated ids such as `gpt-5.4-2026-03-01` resolve to `gpt-5.4`.

- [ ] **Step 5: Implement the merge** in `load.ts`: add

```ts
function listOpenAiPricingFiles(): string[] {
  return readdirSync(__dirname)
    .filter((f) => /^openai-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map((f) => path.join(__dirname, f));
}
```

and, at the end of `loadPricingForDate` just before `return file;`:

```ts
  // OpenAI (Codex) models live in their own table; ids never collide with claude-*.
  const openai = listOpenAiPricingFiles().at(-1);
  if (openai) {
    const table = PricingFileSchema.parse(JSON.parse(readFileSync(openai, "utf-8")) as unknown);
    for (const [model, row] of Object.entries(table.models)) {
      if (!file.models[model]) file.models[model] = row;
    }
  }
```

The existing `listBundledPricingFiles` regex (`^\d{4}-\d{2}-\d{2}\.json$`) already ignores `openai-*` files.

- [ ] **Step 6: Run** the pricing tests → PASS; `npm test` → green; `npm run build && ls dist/lib/pricing` shows `openai-2026-10-08.json`.

- [ ] **Step 7: Commit.** `git add src/lib/pricing tests/lib/pricing.test.ts && git commit -m "feat(pricing): OpenAI price table for Codex models"`

### Task 7: Shell read detector

**Files:**
- Create: `src/modules/agents/codex/readDetect.ts`
- Test: `tests/modules/agents/codex/readDetect.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { detectShellRead, unwrapShellArgv } from "../../../../src/modules/agents/codex/readDetect.js";

describe("detectShellRead", () => {
  it.each([
    ["cat src/a.ts", { path: "src/a.ts" }],
    ["cat 'my file.ts'", { path: "my file.ts" }],
    ["type C:\\p\\a.ts", { path: "C:\\p\\a.ts" }],
    ["Get-Content -Raw src/a.ts", { path: "src/a.ts" }],
    ["Get-Content -LiteralPath 'C:/p/a b.ts'", { path: "C:/p/a b.ts" }],
    ["Get-Content -Path src/a.ts -TotalCount 40", { path: "src/a.ts", range: "head:40" }],
    ["gc src/a.ts -Tail 20", { path: "src/a.ts", range: "tail:20" }],
    ["head -n 50 src/a.ts", { path: "src/a.ts", range: "head:50" }],
    ["tail -20 src/a.ts", { path: "src/a.ts", range: "tail:20" }],
    ["sed -n '10,40p' src/a.ts", { path: "src/a.ts", range: "10-40" }],
  ])("%s", (cmd, want) => {
    expect(detectShellRead(cmd)).toEqual(want);
  });

  it.each([
    "cat a.ts b.ts",
    "cat a.ts | head",
    "cat *.ts",
    "Get-Content a.ts | Select-String foo",
    "sed -i 's/a/b/' a.ts",
    "rg foo src",
    "echo hi > a.ts",
    "",
  ])("is not a single-file read: %s", (cmd) => {
    expect(detectShellRead(cmd)).toBeUndefined();
  });
});

describe("unwrapShellArgv", () => {
  it("unwraps bash -lc and powershell -Command", () => {
    expect(unwrapShellArgv(["bash", "-lc", "cat a.ts"])).toBe("cat a.ts");
    expect(unwrapShellArgv(["powershell.exe", "-NoProfile", "-Command", "Get-Content a.ts"])).toBe("Get-Content a.ts");
    expect(unwrapShellArgv(["cat", "a.ts"])).toBe("cat a.ts");
  });
});
```

- [ ] **Step 2: Run it** → FAIL.

- [ ] **Step 3: Implement** `src/modules/agents/codex/readDetect.ts`:

```ts
/**
 * Codex has no dedicated read tool: it reads files through shell commands.
 * Recognise ONLY unambiguous single-file reads, so duplicate-read detection
 * never guesses. Partial reads carry a range so reading lines 1-40 and later
 * 41-80 of the same file is not reported as a duplicate. Pure.
 */
export interface ReadTarget {
  readonly path: string;
  readonly range?: string;
}

const UNSAFE = /[|;&<>`]|\$\(/; // pipes, chaining, redirects, subshells
const GLOB = /[*?]/;

function tokenize(cmd: string): string[] | undefined {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let has = false;
  for (const ch of cmd) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = "";
      has = false;
      continue;
    }
    cur += ch;
  }
  if (quote) return undefined;
  if (cur || has) out.push(cur);
  return out;
}

function single(path: string | undefined, range?: string): ReadTarget | undefined {
  if (!path || GLOB.test(path)) return undefined;
  return range ? { path, range } : { path };
}

export function detectShellRead(command: string): ReadTarget | undefined {
  const cmd = command.trim();
  if (!cmd || UNSAFE.test(cmd)) return undefined;
  const t = tokenize(cmd);
  if (!t || t.length < 2) return undefined;
  const [bin, ...args] = t;
  const name = bin!.toLowerCase();

  if ((name === "cat" || name === "type") && args.length === 1 && !args[0]!.startsWith("-")) {
    return single(args[0]);
  }

  if (name === "get-content" || name === "gc") {
    let path: string | undefined;
    let range: string | undefined;
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      const lower = a.toLowerCase();
      if (lower === "-raw") continue;
      if (lower === "-path" || lower === "-literalpath") {
        if (path) return undefined;
        path = args[++i];
        continue;
      }
      if (lower === "-encoding") {
        i++;
        continue;
      }
      if (lower === "-totalcount" || lower === "-head" || lower === "-first") {
        range = `head:${args[++i]}`;
        continue;
      }
      if (lower === "-tail" || lower === "-last") {
        range = `tail:${args[++i]}`;
        continue;
      }
      if (a.startsWith("-")) return undefined;
      if (path) return undefined;
      path = a;
    }
    return single(path, range);
  }

  if (name === "head" || name === "tail") {
    let n: string | undefined;
    let path: string | undefined;
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === "-n") {
        n = args[++i];
        continue;
      }
      if (/^-\d+$/.test(a)) {
        n = a.slice(1);
        continue;
      }
      if (a.startsWith("-")) return undefined;
      if (path) return undefined;
      path = a;
    }
    return single(path, `${name}:${n ?? "10"}`);
  }

  if (name === "sed" && args[0] === "-n" && args.length === 3) {
    const m = /^(\d+),(\d+)p$/.exec(args[1]!);
    if (!m) return undefined;
    return single(args[2], `${m[1]}-${m[2]}`);
  }

  return undefined;
}

/** Legacy `shell` / `local_shell` calls pass argv; unwrap `bash -lc "..."` and PowerShell `-Command "..."`. */
export function unwrapShellArgv(argv: ReadonlyArray<string>): string {
  const [bin, ...rest] = argv;
  const b = (bin ?? "").toLowerCase().replace(/\.exe$/, "");
  if ((b === "bash" || b === "sh" || b === "zsh") && (rest[0] === "-lc" || rest[0] === "-c") && rest.length >= 2) {
    return rest[1]!;
  }
  if (b === "powershell" || b === "pwsh") {
    const i = rest.findIndex((r) => r.toLowerCase() === "-command" || r.toLowerCase() === "-c");
    if (i >= 0 && rest[i + 1] !== undefined) return rest[i + 1]!;
  }
  return argv.join(" ");
}
```

- [ ] **Step 4: Run it** → PASS; `npm run lint` → clean.

- [ ] **Step 5: Commit.** `git add src/modules/agents/codex/readDetect.ts tests/modules/agents/codex/readDetect.test.ts && git commit -m "feat(codex): detect single-file shell reads"`

### Task 8: Codex rollout parser

**Files:**
- Create: `src/modules/agents/codex/parse.ts`
- Test: `tests/modules/agents/codex/parse.test.ts`

- [ ] **Step 1: Write the failing tests.** Helper builders and one test per rule:

```ts
import { describe, expect, it } from "vitest";
import { parseCodexRollout, parseCodexMeta } from "../../../../src/modules/agents/codex/parse.js";

const L = (type: string, payload: object, ts = "2026-10-01T10:00:00.000Z") => JSON.stringify({ timestamp: ts, type, payload });
const meta = (extra: object = {}) => L("session_meta", { id: "t1", session_id: "t1", cwd: "C:\\p", cli_version: "0.160.0", originator: "codex_cli_rs", source: "cli", ...extra });
const ctx = (turnId: string, model: string) => L("turn_context", { turn_id: turnId, model, effort: "medium", cwd: "C:\\p" });
const usage = (input: number, cached: number, write: number, output: number, reasoning = 0) =>
  ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: write, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output });
const rec = (turnId: string, rid: string, u: object) => L("token_usage_record", { thread_id: "t1", turn_id: turnId, session_id: "t1", response_id: rid, usage: u });
const tc = (total: object, last: object) => L("event_msg", { type: "token_count", info: { total_token_usage: total, last_token_usage: last, model_context_window: 258400 } });
const parse = (lines: string[]) => { const r = parseCodexRollout(lines.join("\n")); if (!r.ok) throw new Error("parse failed"); return r.value; };

describe("parseCodexRollout: token_usage_record (Codex >= 0.153)", () => {
  it("one turn per record, matching Codex's own test (120, 200, 30 -> 230)", () => {
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"),
      rec("u1", "response-a", usage(100, 0, 0, 20)), rec("u1", "response-b", usage(180, 0, 0, 20)), rec("u1", "response-c", usage(25, 0, 0, 5))]);
    expect(s.assistantTurns).toHaveLength(3);
    const total = s.assistantTurns.reduce((n, t) => n + t.inputTokens + t.cacheReadTokens + t.cacheCreationTokens + t.outputTokens, 0);
    expect(total).toBe(350);
    expect(s.assistantTurns.map((t) => t.requestKey)).toEqual(["response-a", "response-b", "response-c"]);
  });

  it("treats cached and cache-write as parts of input, reasoning as part of output (Responses fixture 100/40/60/10/5)", () => {
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"), rec("u1", "r1", usage(100, 40, 60, 10, 5))]);
    const t = s.assistantTurns[0]!;
    expect([t.inputTokens, t.cacheReadTokens, t.cacheCreationTokens, t.outputTokens]).toEqual([0, 40, 60, 10]);
  });

  it("ignores token_count when records exist", () => {
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"), rec("u1", "r1", usage(100, 0, 0, 10)), tc(usage(100, 0, 0, 10), usage(100, 0, 0, 10))]);
    expect(s.assistantTurns).toHaveLength(1);
  });

  it("takes the model from the record's turn", () => {
    const s = parse([meta(), ctx("u1", "gpt-5.4"), ctx("u2", "gpt-6.1-sol"), rec("u1", "r1", usage(10, 0, 0, 1)), rec("u2", "r2", usage(10, 0, 0, 1))]);
    expect(s.assistantTurns.map((t) => t.model)).toEqual(["gpt-5.4", "gpt-6.1-sol"]);
  });
});

describe("parseCodexRollout: token_count fallback (older Codex)", () => {
  it("skips repeated identical totals (duplicate events)", () => {
    const a = usage(100, 0, 0, 10), b = usage(250, 50, 0, 30);
    const s = parse([meta(), ctx("u1", "gpt-5.4"), tc(a, a), tc(a, a), tc(b, usage(150, 50, 0, 20)), tc(b, usage(150, 50, 0, 20))]);
    expect(s.assistantTurns).toHaveLength(2);
    const total = s.assistantTurns.reduce((n, t) => n + t.inputTokens + t.cacheReadTokens + t.outputTokens, 0);
    expect(total).toBe(280);
  });

  it("skips info:null and zero-usage estimate events", () => {
    const a = usage(100, 0, 0, 10);
    const s = parse([meta(), ctx("u1", "gpt-5.4"), L("event_msg", { type: "token_count", info: null }), tc(a, a),
      tc({ ...a, total_tokens: 400 }, { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 290 })]);
    expect(s.assistantTurns).toHaveLength(1);
  });

  it("resets the baseline when the cumulative total goes backwards", () => {
    const a = usage(100, 0, 0, 10), reset = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 50 };
    const c = { ...usage(120, 0, 0, 10), total_tokens: 80 };
    const s = parse([meta(), ctx("u1", "gpt-5.4"), tc(a, a), tc(reset, reset), tc(c, usage(20, 0, 0, 10))]);
    expect(s.assistantTurns).toHaveLength(2);
  });

  it("keys legacy turns by root session + cumulative total, so fork copies dedupe", () => {
    const a = usage(100, 0, 0, 10);
    const s = parse([meta(), ctx("u1", "gpt-5.4"), tc(a, a)]);
    expect(s.assistantTurns[0]!.requestKey).toBe("codex:t1:110:100:0:10");
  });
});

describe("parseCodexRollout: tools", () => {
  const fc = (name: string, args: object, id: string) => L("response_item", { type: "function_call", name, arguments: JSON.stringify(args), call_id: id });
  const out = (id: string, text: string) => L("response_item", { type: "function_call_output", call_id: id, output: text });
  it("turns single-file shell reads into Read calls sized by their output", () => {
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"), fc("shell_command", { command: "Get-Content -Raw src/a.ts" }, "c1"),
      out("c1", "x".repeat(400)), rec("u1", "r1", usage(10, 0, 0, 1))]);
    expect(s.toolCalls.map((c) => [c.name, (c.input as { file_path?: string }).file_path, c.resultTokens])).toEqual([["Read", "src/a.ts", 100]]);
  });
  it("keeps partial reads distinct", () => {
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"), fc("exec_command", { cmd: "sed -n '1,40p' a.ts" }, "c1"), rec("u1", "r1", usage(10, 0, 0, 1))]);
    expect((s.toolCalls[0]!.input as { file_path: string }).file_path).toBe("a.ts#1-40");
  });
  it("maps apply_patch to one Edit per file", () => {
    const patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+y\n*** Add File: src/b.ts\n+z\n*** End Patch";
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"), L("response_item", { type: "custom_tool_call", name: "apply_patch", input: patch, call_id: "p1" }), rec("u1", "r1", usage(10, 0, 0, 1))]);
    expect(s.toolCalls.map((c) => [c.name, (c.input as { file_path: string }).file_path])).toEqual([["Edit", "src/a.ts"], ["Edit", "src/b.ts"]]);
  });
  it("other commands stay Bash calls", () => {
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"), fc("exec_command", { cmd: "npm test" }, "c1"), rec("u1", "r1", usage(10, 0, 0, 1))]);
    expect(s.toolCalls[0]!.name).toBe("Bash");
  });
});

describe("parseCodexRollout: session fields", () => {
  it("reads cwd, agent, subagent flag and counts user turns from turn_context", () => {
    const s = parse([meta({ source: { subagent: { thread_spawn: { parent_thread_id: "p0" } } } }), ctx("u1", "gpt-6.1-sol"), ctx("u2", "gpt-6.1-sol"), rec("u1", "r1", usage(1, 0, 0, 1))]);
    expect(s.cwd).toBe("C:\\p");
    expect(s.agent).toBe("codex");
    expect(s.isSubagent).toBe(true);
    expect(s.userTurnCount).toBe(2);
  });
  it("parseCodexMeta reads line 1 only", () => {
    const m = parseCodexMeta([meta(), meta({ cwd: "C:\\other" })].join("\n"));
    expect(m.cwd).toBe("C:\\p");
    expect(m.cliVersion).toBe("0.160.0");
  });
});
```

- [ ] **Step 2: Run it** → FAIL (module not found).

- [ ] **Step 3: Implement** `src/modules/agents/codex/parse.ts`:

```ts
/**
 * Codex rollout (~/.codex/sessions/**\/rollout-*.jsonl) → ParsedSession. Pure.
 *
 * Token rules (openai/codex codex-api/src/sse/responses.rs, protocol.rs):
 *   cached_input_tokens and cache_write_input_tokens are SUBSETS of input_tokens;
 *   reasoning_output_tokens is a SUBSET of output_tokens; total = input + output.
 * Per-request source: token_usage_record (Codex >= 0.153), keyed by response_id.
 * Older files: event_msg token_count, deduplicated by cumulative total.
 */
import { ok, type Result } from "../../../lib/result.js";
import type { SipcodeIssue } from "../../../lib/errors.js";
import type { AssistantTurn, ParsedSession, ToolCall } from "../../transcript/parse.js";
import { detectShellRead, unwrapShellArgv } from "./readDetect.js";

interface Usage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

export interface CodexMeta {
  readonly id?: string | undefined;
  readonly rootSessionId?: string | undefined;
  readonly cwd?: string | undefined;
  readonly cliVersion?: string | undefined;
  readonly isSubagent: boolean;
}

type Line = { timestamp?: string; type?: string; payload?: Record<string, unknown> };

function parseLine(raw: string): Line | undefined {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Line) : undefined;
  } catch {
    return undefined;
  }
}

function metaFrom(p: Record<string, unknown> | undefined): CodexMeta {
  const source = p?.source as { subagent?: unknown } | string | undefined;
  const isSubagent =
    (typeof source === "object" && source !== null && "subagent" in source) ||
    typeof p?.parent_thread_id === "string";
  return {
    id: typeof p?.id === "string" ? p.id : undefined,
    rootSessionId: typeof p?.session_id === "string" ? p.session_id : typeof p?.id === "string" ? p.id : undefined,
    cwd: typeof p?.cwd === "string" ? p.cwd : undefined,
    cliVersion: typeof p?.cli_version === "string" ? p.cli_version : undefined,
    isSubagent,
  };
}

/** Line 1 only (later session_meta lines are copies inherited by forks). */
export function parseCodexMeta(content: string): CodexMeta {
  const first = content.slice(0, content.indexOf("\n") >= 0 ? content.indexOf("\n") : undefined);
  const l = parseLine(first);
  return l?.type === "session_meta" ? metaFrom(l.payload) : { isSubagent: false };
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function split(u: Usage): Pick<AssistantTurn, "inputTokens" | "cacheReadTokens" | "cacheCreationTokens" | "outputTokens"> {
  const input = n(u.input_tokens);
  const cached = Math.min(n(u.cached_input_tokens), input);
  const write = Math.min(n(u.cache_write_input_tokens), input - cached);
  return { inputTokens: input - cached - write, cacheReadTokens: cached, cacheCreationTokens: write, outputTokens: n(u.output_tokens) };
}

function minus(a: Usage, b: Usage): Usage {
  const k = ["input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"] as const;
  const out: Usage = {};
  for (const key of k) out[key] = Math.max(0, n(a[key]) - n(b[key]));
  return out;
}

function sameUsage(a: Usage, b: Usage): boolean {
  return n(a.input_tokens) === n(b.input_tokens) && n(a.cached_input_tokens) === n(b.cached_input_tokens) &&
    n(a.output_tokens) === n(b.output_tokens) && n(a.total_tokens) === n(b.total_tokens);
}

function outputText(o: unknown): string {
  if (typeof o === "string") return o;
  if (Array.isArray(o)) return o.map((x) => (x && typeof x === "object" && typeof (x as { text?: unknown }).text === "string" ? (x as { text: string }).text : "")).join("");
  return "";
}

function patchFiles(patch: string): string[] {
  const files: string[] = [];
  for (const m of patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)) files.push(m[1]!.trim());
  return files;
}

interface PendingCall { name: string; input: unknown; callId: string | undefined; ts: string | undefined }

function toCalls(p: Record<string, unknown>, ts: string | undefined): PendingCall[] {
  const type = p.type;
  const callId = typeof p.call_id === "string" ? p.call_id : undefined;
  let name = typeof p.name === "string" ? p.name : String(type);
  let args: Record<string, unknown> = {};
  if (type === "function_call" && typeof p.arguments === "string") {
    try { args = JSON.parse(p.arguments) as Record<string, unknown>; } catch { args = {}; }
  }
  let command: string | undefined;
  if (type === "local_shell_call") {
    const cmd = (p.action as { command?: unknown } | undefined)?.command;
    if (Array.isArray(cmd)) command = unwrapShellArgv(cmd.map(String));
    name = "shell";
  } else if (name === "exec_command" && typeof args.cmd === "string") command = args.cmd;
  else if (name === "shell_command" && typeof args.command === "string") command = args.command;
  else if (name === "shell" && Array.isArray(args.command)) command = unwrapShellArgv(args.command.map(String));

  if (command !== undefined) {
    const read = detectShellRead(command);
    if (read) return [{ name: "Read", input: { file_path: read.range ? `${read.path}#${read.range}` : read.path }, callId, ts }];
    return [{ name: "Bash", input: { command }, callId, ts }];
  }
  if (name === "apply_patch") {
    const text = typeof p.input === "string" ? p.input : typeof args.input === "string" ? args.input : "";
    const files = patchFiles(text);
    if (files.length) return files.map((f) => ({ name: "Edit", input: { file_path: f }, callId, ts }));
  }
  return [{ name, input: type === "custom_tool_call" ? { input: p.input } : args, callId, ts }];
}

export function parseCodexRollout(content: string): Result<ParsedSession, SipcodeIssue[]> {
  const lines = content.split(/\r?\n/);
  let meta: CodexMeta = { isSubagent: false };
  let metaSeen = false;
  const turnModel = new Map<string, string>();
  const turnIds = new Set<string>();
  let currentModel: string | undefined;
  let firstTs: string | undefined;
  let lastTs: string | undefined;
  let parsed = 0;
  let skipped = 0;
  const outputs = new Map<string, number>();
  const hasRecords = content.includes('"token_usage_record"');

  type RawTurn = { usage: Usage; model: string | undefined; ts: string | undefined; key: string | undefined; calls: PendingCall[] };
  const turns: RawTurn[] = [];
  let pending: PendingCall[] = [];
  const seenResponses = new Set<string>();
  let prevTotal: Usage | undefined;

  const push = (usage: Usage, model: string | undefined, ts: string | undefined, key: string | undefined) => {
    turns.push({ usage, model, ts, key, calls: pending });
    pending = [];
  };

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const l = parseLine(raw);
    if (!l || !l.payload) { skipped++; continue; }
    parsed++;
    const ts = l.timestamp;
    if (ts) {
      if (!firstTs || ts < firstTs) firstTs = ts;
      if (!lastTs || ts > lastTs) lastTs = ts;
    }
    const p = l.payload;
    if (l.type === "session_meta") {
      if (!metaSeen) { meta = metaFrom(p); metaSeen = true; }
      continue;
    }
    if (l.type === "turn_context") {
      if (typeof p.model === "string") {
        currentModel = p.model;
        if (typeof p.turn_id === "string") turnModel.set(p.turn_id, p.model);
      }
      if (typeof p.turn_id === "string") turnIds.add(p.turn_id);
      continue;
    }
    if (l.type === "response_item") {
      const t = p.type;
      if (t === "function_call" || t === "custom_tool_call" || t === "local_shell_call") pending.push(...toCalls(p, ts));
      else if ((t === "function_call_output" || t === "custom_tool_call_output") && typeof p.call_id === "string") {
        outputs.set(p.call_id, outputText(p.output).length);
      }
      continue;
    }
    if (l.type === "token_usage_record" && hasRecords) {
      const rid = typeof p.response_id === "string" ? p.response_id : undefined;
      if (!rid || seenResponses.has(rid)) continue;
      seenResponses.add(rid);
      const model = (typeof p.turn_id === "string" ? turnModel.get(p.turn_id) : undefined) ?? currentModel;
      push((p.usage ?? {}) as Usage, model, ts, rid);
      continue;
    }
    if (l.type === "event_msg" && p.type === "token_count" && !hasRecords) {
      const info = p.info as { total_token_usage?: Usage; last_token_usage?: Usage } | null | undefined;
      if (!info?.total_token_usage) continue;
      const T = info.total_token_usage;
      const last = info.last_token_usage ?? {};
      if (prevTotal && sameUsage(T, prevTotal)) continue;
      if (prevTotal && n(T.total_tokens) < n(prevTotal.total_tokens)) { prevTotal = T; continue; }
      let delta: Usage = last;
      if (prevTotal) {
        const sum = n(prevTotal.total_tokens) + n(last.total_tokens);
        delta = sum === n(T.total_tokens) ? last : minus(T, prevTotal);
      }
      prevTotal = T;
      if (n(delta.input_tokens) === 0 && n(delta.output_tokens) === 0 && n(delta.cached_input_tokens) === 0) continue;
      // Key = root session + the FULL cumulative vector: fork copies (same root, same totals)
      // dedupe, while a subagent's own counter (restarting at 0) cannot realistically collide.
      const root = meta.rootSessionId ?? meta.id;
      push(delta, currentModel, ts, root
        ? `codex:${root}:${n(T.total_tokens)}:${n(T.input_tokens)}:${n(T.cached_input_tokens)}:${n(T.output_tokens)}`
        : undefined);
    }
  }
  if (pending.length && turns.length) turns[turns.length - 1]!.calls.push(...pending);

  const assistantTurns: AssistantTurn[] = [];
  const toolCalls: ToolCall[] = [];
  const counts = new Map<string, number>();
  turns.forEach((t, index) => {
    const tok = split(t.usage);
    const calls: ToolCall[] = [];
    const sizedIds = new Set<string>();
    for (const c of t.calls) {
      const chars = c.callId && !sizedIds.has(c.callId) ? outputs.get(c.callId) : undefined;
      if (c.callId) sizedIds.add(c.callId);
      calls.push({
        name: c.name, input: c.input, assistantTurnIndex: index, timestamp: c.ts,
        inputTokens: tok.inputTokens, outputTokens: tok.outputTokens, cacheReadTokens: tok.cacheReadTokens,
        cacheCreationTokens: tok.cacheCreationTokens,
        totalTokens: tok.inputTokens + tok.outputTokens + tok.cacheReadTokens + tok.cacheCreationTokens,
        id: c.callId, resultTokens: chars ? Math.ceil(chars / 4) : 0,
      });
    }
    if (t.model) counts.set(t.model, (counts.get(t.model) ?? 0) + 1);
    assistantTurns.push({ index, model: t.model, timestamp: t.ts, ...tok, cacheCreation1hTokens: 0, toolCalls: calls, missingUsage: false, requestKey: t.key });
    toolCalls.push(...calls);
  });
  let primaryModel: string | undefined;
  let best = -1;
  for (const [m, c] of counts) if (c > best) { best = c; primaryModel = m; }
  const durationSec = firstTs && lastTs ? Math.max(0, Math.floor((Date.parse(lastTs) - Date.parse(firstTs)) / 1000)) : 0;

  return ok({
    sessionId: meta.id, cwd: meta.cwd, primaryModel, models: new Set(counts.keys()),
    startedAt: firstTs, endedAt: lastTs, durationSec, assistantTurns, toolCalls,
    userTurnCount: turnIds.size, linesParsed: parsed, linesSkipped: skipped,
    agent: "codex", isSubagent: meta.isSubagent,
  });
}
```

- [ ] **Step 4: Run it** → PASS (all tests). `npm run lint` → clean. If a test disagrees with the code, re-read the rule in the spec; the spec (from Codex source) wins.

- [ ] **Step 5: Commit.** `git add src/modules/agents/codex/parse.ts tests/modules/agents/codex/parse.test.ts && git commit -m "feat(codex): rollout parser with Codex token accounting"`

### Task 9: Codex discovery

**Files:**
- Create: `src/modules/agents/codex/discover.ts`
- Test: `tests/modules/agents/codex/discover.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../../../src/lib/fs.js";
import { FakeProcessEnv } from "../../../../src/lib/process.js";
import { listCodexSessions, resolveCodexHome } from "../../../../src/modules/agents/codex/discover.js";

const meta = (id: string, cwd: string) => JSON.stringify({ timestamp: "2026-10-01T10:00:00Z", type: "session_meta", payload: { id, session_id: id, cwd, cli_version: "0.160.0" } });

describe("Codex discovery", () => {
  it("uses CODEX_HOME when set", () => {
    expect(resolveCodexHome(new FakeProcessEnv({ homeDir: "/h", vars: { CODEX_HOME: "/c" } }))).toBe("/c");
    expect(resolveCodexHome(new FakeProcessEnv({ homeDir: "/h" }))).toMatch(/[\\/]h[\\/]\.codex$/);
  });

  it("finds rollouts in sessions and archived_sessions, preferring sessions for the same file", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/c/sessions/2026/10/01/rollout-2026-10-01T10-00-00-aaa.jsonl", meta("aaa", "C:\\p"), 3);
    fs.writeFile("/c/archived_sessions/rollout-2026-10-01T10-00-00-aaa.jsonl", meta("aaa", "C:\\old"), 1);
    fs.writeFile("/c/archived_sessions/rollout-2026-09-01T10-00-00-bbb.jsonl", meta("bbb", "C:\\q"), 2);
    fs.writeFile("/c/sessions/2026/10/01/rollout-2026-10-01T11-00-00-ccc.jsonl.zst", "binary", 4);
    fs.writeFile("/c/sessions/2026/10/01/notes.txt", "x", 5);
    const r = await listCodexSessions(fs, "/c");
    expect(r.sessions.map((s) => [s.sessionId, s.cwd])).toEqual([["aaa", "C:\\p"], ["bbb", "C:\\q"]]);
    expect(r.skippedCompressed).toBe(1);
  });

  it("returns nothing when the folder does not exist", async () => {
    const r = await listCodexSessions(new InMemoryFs(), "/none");
    expect(r.sessions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it** → FAIL.

- [ ] **Step 3: Implement** `src/modules/agents/codex/discover.ts`:

```ts
/**
 * Codex rollout discovery: $CODEX_HOME/{sessions,archived_sessions}/**\/rollout-*.jsonl.
 * `.jsonl.zst` (Codex's optional compression of old rollouts) is counted as
 * skipped and reported, never silently ignored.
 */
import path from "node:path";
import type { FileSystem } from "../../../lib/fs.js";
import type { ProcessEnv } from "../../../lib/process.js";
import type { SessionMeta } from "../../transcript/discover.js";
import { cwdToProjectHash } from "../../transcript/discover.js";
import { parseCodexMeta } from "./parse.js";

export function resolveCodexHome(env: ProcessEnv): string {
  return env.get("CODEX_HOME") || path.join(env.homeDir(), ".codex");
}

export interface CodexDiscovery {
  readonly sessions: SessionMeta[];
  readonly skippedCompressed: number;
  readonly unreadable: number;
}

async function walk(fs: FileSystem, dir: string, out: { file: string; mtimeMs: number; size: number }[], counters: { zst: number; unreadable: number }): Promise<void> {
  let entries;
  try {
    entries = await fs.readDir(dir);
  } catch {
    counters.unreadable++;
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory) await walk(fs, p, out, counters);
    else if (e.isFile && e.name.startsWith("rollout-")) {
      if (e.name.endsWith(".jsonl.zst")) counters.zst++;
      else if (e.name.endsWith(".jsonl")) {
        try {
          const s = await fs.stat(p);
          out.push({ file: p, mtimeMs: s.mtimeMs, size: s.size });
        } catch {
          counters.unreadable++;
        }
      }
    }
  }
}

export async function listCodexSessions(fs: FileSystem, home: string): Promise<CodexDiscovery> {
  const counters = { zst: 0, unreadable: 0 };
  const byName = new Map<string, { file: string; mtimeMs: number; size: number }>();
  for (const sub of ["sessions", "archived_sessions"]) {
    const dir = path.join(home, sub);
    if (!(await fs.exists(dir))) continue;
    const found: { file: string; mtimeMs: number; size: number }[] = [];
    await walk(fs, dir, found, counters);
    for (const f of found) {
      const name = path.basename(f.file);
      if (!byName.has(name)) byName.set(name, f); // sessions/ is walked first and wins
    }
  }
  const sessions: SessionMeta[] = [];
  for (const f of byName.values()) {
    let head: string;
    try {
      head = await fs.readFile(f.file);
    } catch {
      counters.unreadable++;
      continue;
    }
    const m = parseCodexMeta(head);
    const id = m.id ?? path.basename(f.file).replace(/\.jsonl$/, "");
    sessions.push({
      sessionId: id,
      filePath: f.file,
      projectHash: m.cwd ? cwdToProjectHash(m.cwd) : "(unknown)",
      mtimeMs: f.mtimeMs,
      size: f.size,
      cwd: m.cwd,
    });
  }
  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { sessions, skippedCompressed: counters.zst, unreadable: counters.unreadable };
}
```

- [ ] **Step 4: Run it** → PASS; lint clean.

- [ ] **Step 5: Commit.** `git add src/modules/agents/codex/discover.ts tests/modules/agents/codex/discover.test.ts && git commit -m "feat(codex): rollout discovery"`

### Task 10: Codex adapter and registration

**Files:**
- Create: `src/modules/agents/codex/adapter.ts`
- Modify: `src/modules/agents/types.ts` (`AgentId`, `ALL_AGENT_IDS`), `src/modules/agents/registry.ts`
- Test: `tests/modules/agents/codex/adapter.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../../../src/lib/fs.js";
import { FakeClock } from "../../../../src/lib/clock.js";
import { FakeProcessEnv } from "../../../../src/lib/process.js";
import { codexAgent } from "../../../../src/modules/agents/codex/adapter.js";
import { getAgentById } from "../../../../src/modules/agents/registry.js";
import { parseAgentFlag } from "../../../../src/modules/agents/cli.js";

const deps = (fs: InMemoryFs) => ({ fs, env: new FakeProcessEnv({ homeDir: "/h", vars: { CODEX_HOME: "/c" } }), clock: new FakeClock(new Date("2026-10-08")) });

describe("codex agent", () => {
  it("is registered and selectable with --agent codex", () => {
    expect(getAgentById("codex")).toBe(codexAgent);
    expect(parseAgentFlag("codex")).toEqual({ ok: true, selector: "codex" });
  });
  it("is installed when CODEX_HOME/sessions exists", async () => {
    const fs = new InMemoryFs();
    expect(await codexAgent.isInstalled(deps(fs), "/")).toBe(false);
    fs.writeFile("/c/sessions/2026/10/01/rollout-x.jsonl", "", 1);
    expect(await codexAgent.isInstalled(deps(fs), "/")).toBe(true);
  });
  it("--here matches the session cwd or a folder inside it", () => {
    const meta = { sessionId: "s", filePath: "/f", projectHash: "x", mtimeMs: 0, size: 0, cwd: "C:\\Projects\\Sipcode\\src" };
    expect(codexAgent.matchesCwd(meta, "C:\\Projects\\Sipcode")).toBe(true);
    expect(codexAgent.matchesCwd(meta, "C:\\Projects\\Other")).toBe(false);
  });
  it("does not write AGENTS.md yet (arrives with Codex setup)", async () => {
    const r = await codexAgent.writeRulesBlock(deps(new InMemoryFs()), "/p", { name: "x", body: "y" }, async () => {});
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it** → FAIL.

- [ ] **Step 3: Implement.**
  - `types.ts`: `export type AgentId = "claude-code" | "cursor" | "codex";` and `ALL_AGENT_IDS = ["claude-code", "cursor", "codex"]`.
  - `registry.ts`: import `codexAgent` and add `codex: codexAgent,`.
  - `src/modules/agents/codex/adapter.ts`:

```ts
/**
 * Codex adapter: analytics only in this release. Writing AGENTS.md and
 * registering the MCP server arrive with Codex setup (a later piece).
 */
import path from "node:path";
import { err, ok, type Result } from "../../../lib/result.js";
import { issue, type SipcodeIssue } from "../../../lib/errors.js";
import type { Agent, AgentDeps, AgentRulesRead } from "../types.js";
import { listCodexSessions, resolveCodexHome } from "./discover.js";
import { parseCodexRollout } from "./parse.js";

const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, "").toLowerCase();
const NOT_YET = () => err<SipcodeIssue[]>([issue("E009", "writing Codex rules (AGENTS.md) arrives in a later Sipcode release.")]);

export const codexAgent: Agent = {
  id: "codex",
  displayName: "Codex",
  rulesPathCandidates: (cwd) => [path.join(cwd, "AGENTS.md")],
  transcriptParsingSupported: true,

  async discoverSessions(deps: AgentDeps) {
    const r = await listCodexSessions(deps.fs, resolveCodexHome(deps.env));
    return ok(r.sessions);
  },

  parseTranscript(content: string) {
    return parseCodexRollout(content);
  },

  matchesCwd(meta, cwd) {
    if (!meta.cwd) return false;
    const a = norm(meta.cwd);
    const b = norm(cwd);
    return a === b || a.startsWith(b + path.sep.toLowerCase()) || a.startsWith(b + "/") || a.startsWith(b + "\\");
  },

  async readRulesFile(deps, cwd): Promise<AgentRulesRead | null> {
    const target = path.join(cwd, "AGENTS.md");
    if (!(await deps.fs.exists(target))) return null;
    return { path: target, content: await deps.fs.readFile(target) };
  },

  async writeRulesBlock() {
    return NOT_YET() as Result<never, SipcodeIssue[]>;
  },

  async removeRulesBlock() {
    return NOT_YET() as Result<never, SipcodeIssue[]>;
  },

  async isInstalled(deps) {
    return deps.fs.exists(path.join(resolveCodexHome(deps.env), "sessions"));
  },
};
```

  (Check `err`'s exact signature in `src/lib/result.ts` and adjust the two return casts to match; `issue(code, message)` is the existing helper.)

- [ ] **Step 4: Run it** → PASS; `npm test` → green (existing agent tests that enumerate `ALL_AGENT_IDS` may need `codex` added to their expectation; update them).

- [ ] **Step 5: Commit.** `git add -A src/modules/agents tests/modules/agents && git commit -m "feat(codex): Codex agent adapter (analytics)"`

---

## Phase 3: show both tools (option B)

### Task 11: `resolveDisplayAgents` and the combined line

**Files:**
- Create: `src/modules/agents/multi.ts`
- Test: `tests/modules/agents/multi.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../../src/lib/fs.js";
import { FakeClock } from "../../../src/lib/clock.js";
import { FakeProcessEnv } from "../../../src/lib/process.js";
import { combinedLine, resolveDisplayAgents, sectionHeader } from "../../../src/modules/agents/multi.js";

function setup(claude: boolean, codex: boolean) {
  const fs = new InMemoryFs();
  if (claude) fs.writeFile("/h/.claude/projects/p/a.jsonl", "", 1);
  if (codex) fs.writeFile("/h/.codex/sessions/2026/10/01/rollout-a.jsonl", "", 1);
  return { fs, env: new FakeProcessEnv({ homeDir: "/h" }), clock: new FakeClock(new Date("2026-10-08")) };
}

describe("resolveDisplayAgents", () => {
  it("shows both when both are installed", async () => {
    const r = await resolveDisplayAgents({ agent: undefined, ...setup(true, true), cwd: "/", json: false, stderr: () => {} });
    expect(r.ok && r.agents.map((a) => a.id)).toEqual(["claude-code", "codex"]);
  });
  it("JSON stays one agent (Claude first) and notes the other on stderr", async () => {
    const err: string[] = [];
    const r = await resolveDisplayAgents({ agent: undefined, ...setup(true, true), cwd: "/", json: true, stderr: (s) => err.push(s) });
    expect(r.ok && r.agents.map((a) => a.id)).toEqual(["claude-code"]);
    expect(err.join("\n")).toMatch(/--agent codex/);
  });
  it("uses Codex alone when only Codex is installed", async () => {
    const r = await resolveDisplayAgents({ agent: undefined, ...setup(false, true), cwd: "/", json: false, stderr: () => {} });
    expect(r.ok && r.agents.map((a) => a.id)).toEqual(["codex"]);
  });
  it("honours an explicit --agent", async () => {
    const r = await resolveDisplayAgents({ agent: "codex", ...setup(true, true), cwd: "/", json: false, stderr: () => {} });
    expect(r.ok && r.agents.map((a) => a.id)).toEqual(["codex"]);
  });
  it("rejects an unknown --agent", async () => {
    const r = await resolveDisplayAgents({ agent: "nope", ...setup(true, true), cwd: "/", json: false, stderr: () => {} });
    expect(r.ok).toBe(false);
  });
});

describe("combined line and header", () => {
  it("formats both tools' totals", () => {
    expect(combinedLine([{ tokens: 13_100_000_000, usd: 10888 }, { tokens: 25_500_000, usd: 41.2 }]))
      .toBe("Both tools: 13.13B tokens · ~$10,888 + ~$41");
  });
  it("names the agent in the section header", () => {
    expect(sectionHeader("Codex")).toBe("── Codex ──");
  });
});
```

- [ ] **Step 2: Run it** → FAIL.

- [ ] **Step 3: Implement** `src/modules/agents/multi.ts`:

```ts
/**
 * Which agents a command shows (option B): every installed agent with
 * parseable transcripts, one section each; JSON stays one agent per call.
 */
import type { Clock } from "../../lib/clock.js";
import type { FileSystem } from "../../lib/fs.js";
import type { ProcessEnv } from "../../lib/process.js";
import { parseAgentFlag } from "./cli.js";
import { getAgentById } from "./registry.js";
import type { Agent, AgentId } from "./types.js";
import { resolveProjectsDir } from "../transcript/discover.js";

export type DisplayAgents = { ok: true; agents: Agent[]; available: AgentId[] } | { ok: false; exitCode: 1 };

export async function resolveDisplayAgents(i: {
  agent: string | undefined;
  fs: FileSystem;
  env: ProcessEnv;
  clock: Clock;
  cwd: string;
  json: boolean;
  stderr: (s: string) => void;
}): Promise<DisplayAgents> {
  const parsed = parseAgentFlag(i.agent);
  if (!parsed.ok) {
    i.stderr(parsed.message);
    return { ok: false, exitCode: 1 };
  }
  if (parsed.selector !== "auto") {
    return { ok: true, agents: [getAgentById(parsed.selector)], available: [parsed.selector] };
  }
  const available: AgentId[] = [];
  if (await i.fs.exists(resolveProjectsDir(i.env))) available.push("claude-code");
  const codex = getAgentById("codex");
  if (await codex.isInstalled({ fs: i.fs, env: i.env, clock: i.clock }, i.cwd)) available.push("codex");
  if (available.length === 0) return { ok: true, agents: [getAgentById("claude-code")], available };
  if (i.json) {
    if (available.length > 1) {
      i.stderr(`note: Codex logs found too. JSON covers Claude Code; run with --agent codex for Codex.`);
    }
    return { ok: true, agents: [getAgentById(available[0]!)], available };
  }
  return { ok: true, agents: available.map(getAgentById), available };
}

export function sectionHeader(displayName: string): string {
  return `── ${displayName} ──`;
}

function fmtTokens(t: number): string {
  if (t >= 1e9) return `${(t / 1e9).toFixed(2)}B`;
  if (t >= 1e6) return `${(t / 1e6).toFixed(1)}M`;
  if (t >= 1e3) return `${(t / 1e3).toFixed(1)}K`;
  return String(Math.round(t));
}

export function combinedLine(parts: ReadonlyArray<{ tokens: number; usd: number }>): string {
  const tokens = parts.reduce((n, p) => n + p.tokens, 0);
  const usd = parts.map((p) => `~$${Math.round(p.usd).toLocaleString("en-US")}`).join(" + ");
  return `Both tools: ${fmtTokens(tokens)} tokens · ${usd}`;
}
```

- [ ] **Step 4: Run it** → PASS; lint clean.

- [ ] **Step 5: Commit.** `git add src/modules/agents/multi.ts tests/modules/agents/multi.test.ts && git commit -m "feat(agents): resolve which agents to show; combined line"`

### Task 12: Period commands render one section per agent

**Files:** `src/commands/stats.ts`, `today.ts`, `forecast.ts`, `trend.ts`, `impact.ts`. Tests: one new integration test per command in its existing `tests/integration/<cmd>.integration.test.ts` (create where absent), using an `InMemoryFs` with both a Claude transcript and a Codex rollout.

Pattern (apply to each command):

1. Move everything after the agent is chosen into `async function <cmd>ForAgent(agent: Agent, ctx): Promise<{ exitCode: number; text?: string; json?: string; totals?: { tokens: number; usd: number } }>`. It returns the rendered terminal text (instead of printing), the JSON string, and for `stats` / `today` / `forecast` the totals for the combined line. Keep every existing message and empty-state branch inside it.
2. Replace `resolveAgentFromOpts` with `resolveDisplayAgents({ agent: opts.agent, fs, env, clock, cwd, json: !!opts.json, stderr })`.
3. In the command body:

```ts
  const shown = await resolveDisplayAgents({ agent: opts.agent, fs, env, clock, cwd, json: !!opts.json, stderr });
  if (!shown.ok) return { exitCode: 1 };
  if (shown.agents.length === 1) {
    const a = shown.agents[0]!;
    if (!opts.json && opts.agent === undefined) stdout(MESSAGES.agentDetectedAuto(a.id));
    const r = await statsForAgent(a, ctx);
    if (r.json) stdout(r.json);
    else if (r.text) stdout(r.text);
    return { exitCode: r.exitCode };
  }
  const totals: { tokens: number; usd: number }[] = [];
  let exitCode = 0;
  for (const a of shown.agents) {
    stdout(sectionHeader(a.displayName));
    const r = await statsForAgent(a, ctx);
    if (r.text) stdout(r.text);
    if (r.totals) totals.push(r.totals);
    exitCode = Math.max(exitCode, r.exitCode === 1 && shown.agents.length > 1 ? 0 : r.exitCode);
    stdout("");
  }
  if (totals.length > 1) stdout(combinedLine(totals));
  return { exitCode };
```

   (For `trend` and `impact`, omit the `totals` / `combinedLine` lines.) An agent with no sessions in the window prints its normal empty message inside its section and does not fail the whole command.
4. The Claude-only "projects dir must exist" check in `stats` moves inside `statsForAgent` and runs only when `agent.id === "claude-code"`.
5. `stats` totals: `{ tokens: report.totals.totalTokens, usd: report.totals.estCostUSD }` (field names verified in `src/modules/stats/types.ts`). `today`: today's tokens and cost from the today report. `forecast`: the projected month-end cost (`tokens: 0`, and `combinedLine` prints only the dollar parts when the token sum is 0: add that rule and a test to Task 11's `combinedLine` if needed).

- [ ] **Step 1: Write the failing integration test** for `stats` (then the same shape for `today`, `forecast`, `trend`, `impact`):

```ts
it("shows a Claude Code section and a Codex section, then the combined line", async () => {
  const fs = makeFs(); // existing Claude fixtures
  fs.writeFile("/home/u/.codex/sessions/2026/05/10/rollout-2026-05-10T10-00-00-cx1.jsonl", [
    JSON.stringify({ timestamp: "2026-05-10T10:00:00Z", type: "session_meta", payload: { id: "cx1", session_id: "cx1", cwd: "C:\\p", cli_version: "0.160.0" } }),
    JSON.stringify({ timestamp: "2026-05-10T10:00:01Z", type: "turn_context", payload: { turn_id: "u1", model: "gpt-6.1-sol" } }),
    JSON.stringify({ timestamp: "2026-05-10T10:00:05Z", type: "token_usage_record", payload: { turn_id: "u1", response_id: "r1", usage: { input_tokens: 1000, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 100, reasoning_output_tokens: 0, total_tokens: 1100 } } }),
  ].join("\n"), new Date("2026-05-10T10:01:00Z").getTime());
  const out: string[] = [];
  const r = await runStats({ since: "30d" }, { fs, env: makeEnv(), clock: new FakeClock(NOW), stdout: (s) => out.push(s), stderr: () => {} });
  expect(r.exitCode).toBe(0);
  const text = out.join("\n");
  expect(text).toContain("── Claude Code ──");
  expect(text).toContain("── Codex ──");
  expect(text).toMatch(/Both tools: .* tokens · ~\$/);
});
```

- [ ] **Step 2: Run it** → FAIL.
- [ ] **Step 3: Implement** the pattern in `stats.ts`; run its tests (new + existing) → PASS.
- [ ] **Step 4:** Repeat Steps 1-3 for `today`, `forecast`, `trend`, `impact`.
- [ ] **Step 5:** `npm test` → green; `npm run lint` → clean.
- [ ] **Step 6: Commit.** `git commit -am "feat(stats,today,forecast,trend,impact): one section per installed agent"`

### Task 13: Single-session commands across agents

**Files:**
- Create: `src/modules/agents/latest.ts`; Test: `tests/modules/agents/latest.test.ts`
- Modify: `src/commands/why.ts`, `src/commands/receipt.ts`, `src/commands/drift.ts`

- [ ] **Step 1: Write the failing test** for `latest.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../../src/lib/fs.js";
import { FakeClock } from "../../../src/lib/clock.js";
import { FakeProcessEnv } from "../../../src/lib/process.js";
import { claudeCodeAgent } from "../../../src/modules/agents/claude-code/adapter.js";
import { codexAgent } from "../../../src/modules/agents/codex/adapter.js";
import { pickLatestSession } from "../../../src/modules/agents/latest.js";

const claudeReq = JSON.stringify({ type: "assistant", requestId: "q1", timestamp: "2026-10-01T10:00:00Z", sessionId: "cl1",
  message: { id: "m1", model: "claude-opus-5", role: "assistant", content: [{ type: "text", text: "." }], usage: { input_tokens: 5, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
const codexRollout = [
  JSON.stringify({ timestamp: "2026-10-02T10:00:00Z", type: "session_meta", payload: { id: "cx1", session_id: "cx1", cwd: "C:\\p" } }),
  JSON.stringify({ timestamp: "2026-10-02T10:00:01Z", type: "turn_context", payload: { turn_id: "u1", model: "gpt-6.1-sol" } }),
  JSON.stringify({ timestamp: "2026-10-02T10:00:02Z", type: "token_usage_record", payload: { turn_id: "u1", response_id: "r1", usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } } }),
].join("\n");

function deps() {
  const fs = new InMemoryFs();
  fs.writeFile("/h/.claude/projects/C--p/cl1.jsonl", claudeReq, Date.parse("2026-10-01T10:01:00Z"));
  fs.writeFile("/h/.codex/sessions/2026/10/02/rollout-cx1.jsonl", codexRollout, Date.parse("2026-10-02T10:01:00Z"));
  return { fs, env: new FakeProcessEnv({ homeDir: "/h" }), clock: new FakeClock(new Date("2026-10-08")) };
}

describe("pickLatestSession", () => {
  it("picks the most recent non-empty session across agents and hints the other", async () => {
    const r = await pickLatestSession({ agents: [claudeCodeAgent, codexAgent], deps: deps(), cwd: "/" });
    expect(r?.chosen.agent.id).toBe("codex");
    expect(r?.others.map((o) => [o.agent.id, o.meta.sessionId])).toEqual([["claude-code", "cl1"]]);
  });
  it("never picks a Codex subagent thread as the latest session", async () => {
    const d = deps();
    const sub = [
      JSON.stringify({ timestamp: "2026-10-03T10:00:00Z", type: "session_meta", payload: { id: "sub1", session_id: "cx1", cwd: "C:\\p", parent_thread_id: "cx1" } }),
      JSON.stringify({ timestamp: "2026-10-03T10:00:01Z", type: "turn_context", payload: { turn_id: "u9", model: "gpt-6.1-sol" } }),
      JSON.stringify({ timestamp: "2026-10-03T10:00:02Z", type: "token_usage_record", payload: { turn_id: "u9", response_id: "r9", usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } } }),
    ].join("\n");
    d.fs.writeFile("/h/.codex/sessions/2026/10/03/rollout-sub1.jsonl", sub, Date.parse("2026-10-03T10:01:00Z"));
    const r = await pickLatestSession({ agents: [claudeCodeAgent, codexAgent], deps: d, cwd: "/" });
    expect(r?.chosen.meta.sessionId).toBe("cx1");
  });
  it("finds a session by id prefix in any agent", async () => {
    const r = await pickLatestSession({ agents: [claudeCodeAgent, codexAgent], deps: deps(), cwd: "/", sessionIdPrefix: "cl1" });
    expect(r?.chosen.agent.id).toBe("claude-code");
  });
});
```

- [ ] **Step 2: Run it** → FAIL.

- [ ] **Step 3: Implement** `src/modules/agents/latest.ts`:

```ts
/**
 * Newest non-empty session across agents (why / receipt / drift / MCP audit),
 * plus each other agent's newest session for a one-line hint.
 */
import { loadPricingForDate } from "../../lib/pricing/load.js";
import { analyzeTokens, isEmptySession } from "../transcript/analyzers/tokens.js";
import type { ParsedSession, SessionMeta } from "./shared.js";
import type { Agent, AgentDeps } from "./types.js";

export interface PickedSession {
  readonly agent: Agent;
  readonly meta: SessionMeta;
  readonly parsed: ParsedSession;
}

export async function pickLatestSession(i: {
  agents: ReadonlyArray<Agent>;
  deps: AgentDeps;
  cwd: string;
  here?: boolean | undefined;
  sessionIdPrefix?: string | undefined;
}): Promise<{ chosen: PickedSession; others: PickedSession[] } | undefined> {
  const perAgent: PickedSession[] = [];
  for (const agent of i.agents) {
    const d = await agent.discoverSessions(i.deps);
    if (!d.ok) continue;
    let metas = d.value;
    if (i.here) metas = metas.filter((m) => agent.matchesCwd(m, i.cwd));
    if (i.sessionIdPrefix) metas = metas.filter((m) => m.sessionId.startsWith(i.sessionIdPrefix!));
    for (const meta of metas) {
      let content: string;
      try {
        content = await i.deps.fs.readFile(meta.filePath);
      } catch {
        continue;
      }
      const p = agent.parseTranscript(content);
      if (!p.ok) continue;
      const date = p.value.startedAt ? new Date(p.value.startedAt) : i.deps.clock.now();
      // Helper threads (Codex subagents, auto-review) are never "your latest session".
      if (p.value.isSubagent && !i.sessionIdPrefix) continue;
      if (isEmptySession(analyzeTokens(p.value, loadPricingForDate(date))) && !i.sessionIdPrefix) continue;
      perAgent.push({ agent, meta, parsed: p.value });
      break; // metas are newest-first
    }
  }
  if (perAgent.length === 0) return undefined;
  perAgent.sort((a, b) => b.meta.mtimeMs - a.meta.mtimeMs);
  return { chosen: perAgent[0]!, others: perAgent.slice(1) };
}

export function otherAgentHint(o: PickedSession): string {
  return `${o.agent.displayName} also has a recent session (${o.meta.sessionId.slice(0, 8)}): run with --agent ${o.agent.id}.`;
}
```

- [ ] **Step 4: Run it** → PASS.

- [ ] **Step 5: Wire into `why.ts`, `receipt.ts`, `drift.ts`.** In each:
  - Replace `resolveProjectsDir` / `listAllSessions` / `listSessionsHere` / `findSessionById` / `pickLatestNonEmpty` / `parseTranscriptVerbose` with: `resolveDisplayAgents` (json → single agent), then `pickLatestSession({ agents: shown.agents, deps, cwd, here: opts.here, sessionIdPrefix: opts.session })`.
  - Use `picked.chosen.parsed` where the command used `session`, and `picked.chosen.meta` where it used `chosen`. Label the header with `picked.chosen.agent.displayName` when more than one agent is shown.
  - After the report (terminal mode only), print `otherAgentHint(o)` for each `picked.others` entry.
  - `why` previously surfaced parse issues from `parseTranscriptVerbose`; keep that for Claude by calling `parseTranscriptVerbose(content)` when `picked.chosen.agent.id === "claude-code"` (issues only), so existing warnings stay.
  - `drift` builds its baseline from the same agent's earlier sessions: use `loadSessions({ agent: picked.chosen.agent, ... })`.
  - Add one integration test per command: with both a Claude transcript and a newer Codex rollout, the report is for the Codex session and the output contains the Claude hint.

- [ ] **Step 6:** `npm test` → green; lint clean.

- [ ] **Step 7: Commit.** `git add -A && git commit -m "feat(why,receipt,drift): latest session across agents with a hint for the other"`

### Task 14: MCP tools take an optional `agent`

**Files:** `src/mcp/server.ts`; Test: `tests/mcp/agent-param.test.ts`

- [ ] **Step 1: Write the failing test.** Call the exported tool handlers (export `toolListRecentSessions`, `toolAuditLatestSession`, `toolGetSessionStats` for testing if not exported) with `{ agent: "codex" }` against `CODEX_HOME` pointing at a fixture folder (set `process.env.CODEX_HOME` and `SIPCODE_PROJECTS_DIR` in the test, restore after), and expect Codex sessions in the result.

- [ ] **Step 2: Implement.**
  - Add to the input schema of `list_recent_sessions`, `audit_latest_session`, `get_session_stats`, `get_today_summary`, `forecast_monthly_spend`, `get_drift_report`, `verify_sipcode_impact`:

```ts
agent: { type: "string", enum: ["claude-code", "codex"], description: "Which coding agent's logs to read. Default: Claude Code if installed, else Codex." },
```

  - In each `case`, read `args.agent` (string or undefined) and pass it to the handler; handlers pass `agent` into the `run*` command options (`{ json: true, agent }`).
  - `toolListRecentSessions(limit, agent)`: resolve with `resolveDisplayAgents({ agent, json: true, ... })` and list `agent.discoverSessions(...)`.
  - `toolAuditLatestSession({ sessionId, agent })`: use `pickLatestSession` with the resolved single agent.
  - Keep the registered tool count at exactly 15 (the release-smoke e2e test asserts it).

- [ ] **Step 3:** `npx vitest run tests/mcp` and `npm run test:e2e` → green (still 15 tools).

- [ ] **Step 4: Commit.** `git commit -am "feat(mcp): optional agent input on session tools"`

---

## Phase 4: proof and release

### Task 15: Independent cross-check on real logs

**Files:** Create `scripts/verify-counts.mjs` (dev only; `scripts/` is not in the npm `files` list).

- [ ] **Step 1: Write the script** from scratch, importing nothing from `src/` or `dist/`:

```js
// Independent token counter for Claude Code and Codex logs. Compares against
// `sipcode stats --since all --json --agent <a>`. Exit 1 on any mismatch.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

function claude() {
  const root = process.env.SIPCODE_PROJECTS_DIR || join(homedir(), ".claude", "projects");
  const seen = new Set();
  let tokens = 0;
  if (!existsSync(root)) return { requests: 0, tokens: 0 };
  for (const p of readdirSync(root)) {
    const dir = join(root, p);
    if (!statSync(dir).isDirectory() || /-observer-sessions$|claude-mem-observer/i.test(p)) continue;
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
      for (const l of readFileSync(join(dir, f), "utf8").split("\n")) {
        if (!l.includes('"usage"')) continue;
        let e; try { e = JSON.parse(l); } catch { continue; }
        const m = e.message;
        if (e.type !== "assistant" || !m?.usage || m.model === "<synthetic>" || !m.id) continue;
        const k = `${m.id}|${e.requestId ?? ""}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const u = m.usage, nested = u.cache_creation || {};
        const cw = Math.max(u.cache_creation_input_tokens || 0, (nested.ephemeral_5m_input_tokens || 0) + (nested.ephemeral_1h_input_tokens || 0));
        tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + cw;
      }
    }
  }
  return { requests: seen.size, tokens };
}

function codex() {
  const home = process.env.CODEX_HOME || join(homedir(), ".codex");
  const files = new Map();
  const walk = (d) => { if (!existsSync(d)) return; for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/^rollout-.*\.jsonl$/.test(n) && !files.has(n)) files.set(n, p); } };
  walk(join(home, "sessions")); walk(join(home, "archived_sessions"));
  const seen = new Set();
  let tokens = 0;
  for (const f of files.values()) {
    const lines = readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const root = lines[0]?.type === "session_meta" ? (lines[0].payload.session_id || lines[0].payload.id) : f;
    const recs = lines.filter((e) => e.type === "token_usage_record");
    if (recs.length) {
      for (const r of recs) { const id = r.payload.response_id; if (!id || seen.has(id)) continue; seen.add(id); tokens += r.payload.usage.total_tokens || 0; }
      continue;
    }
    let prev = null;
    for (const e of lines) {
      if (e.payload?.type !== "token_count" || !e.payload.info) continue;
      const T = e.payload.info.total_token_usage;
      if (prev && T.total_tokens === prev.total_tokens) continue;
      if (prev && T.total_tokens < prev.total_tokens) { prev = T; continue; }
      const delta = T.total_tokens - (prev ? prev.total_tokens : 0);
      const L = e.payload.info.last_token_usage || {};
      const deltaInput = prev ? T.input_tokens - prev.input_tokens : T.input_tokens;
      const deltaOut = prev ? T.output_tokens - prev.output_tokens : T.output_tokens;
      prev = T;
      if (deltaInput <= 0 && deltaOut <= 0) continue;
      const k = `codex:${root}:${T.total_tokens}`;
      if (seen.has(k)) continue;
      seen.add(k);
      tokens += delta || L.total_tokens || 0;
    }
  }
  return { requests: seen.size, tokens };
}

function sipcode(agent) {
  const out = execFileSync(process.execPath, ["dist/cli.js", "stats", "--since", "all", "--json", "--agent", agent], { encoding: "utf8", maxBuffer: 1 << 28 });
  return JSON.parse(out);
}

let bad = 0;
for (const [agent, mine] of [["claude-code", claude()], ["codex", codex()]]) {
  const s = sipcode(agent);
  const theirs = s.totals?.totalTokens ?? 0;
  const ok = theirs === mine.tokens;
  console.log(`${ok ? "MATCH" : "MISMATCH"} ${agent}: independent ${mine.tokens.toLocaleString()} tokens (${mine.requests} requests), sipcode ${theirs.toLocaleString()}`);
  if (!ok) bad++;
}
process.exit(bad ? 1 : 0);
```

- [ ] **Step 2: Run it** after `npm run build`: `node scripts/verify-counts.mjs`. Expected: `MATCH` for both. Note: `stats` excludes empty sessions and subagent folders; if counts differ, find the exact cause (print per-file differences) and fix the code or the script, never fudge the comparison. Record the final numbers in the PR description.

- [ ] **Step 3: Commit.** `git add scripts/verify-counts.mjs && git commit -m "chore: independent token counter to cross-check stats"`

### Task 16: Anonymised real-log fixtures

**Files:** Create `scripts/anonymise-rollout.mjs` (dev only) and `tests/fixtures/codex/*.jsonl`; Test: `tests/modules/agents/codex/real-fixtures.test.ts`

- [ ] **Step 1: Write the anonymiser.** Keep line `type`, `timestamp` (shifted to start at 2026-01-01T00:00:00Z), `payload.type`, every token field, `rate_limits` numbers, `turn_id`, `response_id` (replaced by `r<n>`), `call_id` (replaced by `c<n>`), model names, `cli_version`, tool names. Replace every other string (messages, commands, paths, cwd) with `"x"`; replace tool outputs with `"x".repeat(original length)` so result sizes stay accurate.
- [ ] **Step 2:** Produce 3 fixtures from the maintainer's rollouts: one legacy (token_count only, with duplicate events), one with `token_usage_record`, one with a `compacted` line. Check each by eye: no real text, paths or ids remain.
- [ ] **Step 3: Test** that `parseCodexRollout` on each fixture gives the token total that the independent counter (Task 15 logic) gives for the original file, and equals the file's final `total_token_usage.total_tokens` where it has no reset.
- [ ] **Step 4: Commit** fixtures, script and test.

### Task 17: Docs, version, full verification

- [ ] **Step 1:** README: a "Codex" section (what works, `--agent codex`, both-tools view, how tokens are counted). Update the comparison table row for multi-agent support. CHANGELOG `[1.7.0]` entry: Codex analytics; cross-file dedupe fix with the measured 11.4% figure; OpenAI pricing.
- [ ] **Step 2:** `npm version 1.7.0 --no-git-tag-version`; bump `server.json` (both versions), site Hero/Footer version + test count, llms.txt / llms-full.txt version + test count.
- [ ] **Step 3:** `npm run lint && npm run build && npx vitest run` (unit + e2e) → all green.
- [ ] **Step 4: Real data, three set-ups:**
  - Both: `node dist/cli.js stats`, `today`, `forecast`, `trend`, `impact`, `why`, `drift`, `receipt` → two sections where specified, combined line on stats/today/forecast, hint on why/drift/receipt.
  - Claude only: `CODEX_HOME=/nonexistent node dist/cli.js stats` → exactly one section, no combined line.
  - Codex only: `SIPCODE_PROJECTS_DIR=/nonexistent node dist/cli.js stats` → Codex only.
  - `node dist/cli.js stats --json --agent codex` parses; `--json` without flag still parses and notes Codex on stderr.
  - `node scripts/verify-counts.mjs` → MATCH, MATCH.
- [ ] **Step 5: Commit** `release: v1.7.0 (Codex analytics)`. Open a PR; publishing (tag) waits for the maintainer's approval.
