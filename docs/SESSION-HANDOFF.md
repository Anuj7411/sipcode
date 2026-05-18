# Sipcode — SESSION HANDOFF

> **Purpose:** paste this brief (or its sections) into Claude Code (or any agent) to execute the next implementation milestone. Self-contained — assumes zero prior context.
> **Current milestone:** v0.1.0-alpha.1 — implement `sipcode why` (the install-free past-tense session auditor).
> **Last updated:** 2026-05-18.

---

## 0. Who you are, what you're building

You are an engineer joining the Sipcode project at v0.0.1 scaffolding. Sipcode is a TypeScript CLI that helps developers reduce Claude Code / AI-coding-agent token spend. Tagline: *"Sip your tokens. Don't gulp them."*

The codebase has just been scaffolded: `package.json`, `tsconfig.json`, `vitest.config.ts`, planning docs in `docs/`, and empty `src/` folders. Nothing runs yet.

**Read these in this order before touching code:**
1. `docs/PROJECT-SPEC.md` — what Sipcode is and isn't.
2. `docs/ROADMAP.md` — what comes next.
3. `docs/AUDIT-FRAMEWORK.md` — stable IDs, branded types, test seams.
4. This file.

Do **not** read the README first — it's marketing copy and will skew your priorities.

---

## 1. Architectural principles (non-negotiable)

You inherit Answerable's discipline:

1. **Pure runners + I/O wrappers.** Every analyzer is a pure function over an in-memory model. I/O lives in thin wrappers that the pure code never imports.
2. **Branded types.** Use `SessionId`, `AbsoluteFilePath`, `TokenCount` from `src/lib/types.ts`. Never pass raw strings into APIs that expect specific shapes.
3. **Batched validation errors.** Return `SipcodeValidationError` with full `issues[]`. Never throw on first failure mid-flight.
4. **Stable IDs as public API.** Reference `S010`, `M001`, `R003`, `E003` from `AUDIT-FRAMEWORK.md`. Never invent new IDs without adding them to that doc first.
5. **Drift-prevention snapshot tests** for every output the user sees.
6. **Zero LLM calls in core paths.** All analysis is static.

If you find yourself violating one of these, stop and ask.

---

## 2. This milestone: `sipcode why`

### What it does

Reads Claude Code session transcripts from `~/.claude/projects/<project-hash>/*.jsonl` and produces a forensic report on where tokens went. **No install, no config, no Sipcode setup required to use it.** This is Sipcode's install-free demo and the funnel into the rest of the product.

### Required outputs (CLI behavior)

```bash
# Audit the most recent session
npx sipcode why

# Audit a specific session
npx sipcode why --session 0a1b2c3d

# List sessions to pick from
npx sipcode why --list

# Machine-readable output
npx sipcode why --json
```

The default human output is a terminal report with:
- Header: project name, session id, duration, model used.
- **Big number** — total cost in tokens and USD.
- **The 0.6% breakdown** (M010) — pie-chart-as-ASCII or a colored bar.
- **Top 5 most expensive tool calls** with file paths, token cost, reason flag (re-read / large-file / oversized-grep / etc.).
- **Duplicate reads (R003)** — files read more than once with cost of each duplicate.
- **Idle context (M009)** — files held in context for ≥ N turns without being referenced.
- **Estimated savings if Sipcode were installed** (M012 + M013 + M014).
- **Next step** — "Run `npx sipcode init` to start saving."

---

## 3. Implementation plan (build in this order)

### Step 1 — Branded types and result types
- Create `src/lib/types.ts` per the AUDIT-FRAMEWORK branded-types section.
- Create `src/lib/errors.ts` with `SipcodeValidationError` and error-code constants from the `E` table.
- Create `src/lib/result.ts` with a `Result<T, E>` discriminated union (don't use a library — keep dependencies minimal).

### Step 2 — Transcript discovery (I/O wrapper)
- Create `src/modules/transcript/discover.ts`:
  - `findClaudeProjectsDir(): Promise<AbsoluteFilePath>` — defaults to `~/.claude/projects`, override via `SIPCODE_PROJECTS_DIR` env var.
  - `listSessions(dir): Promise<SessionMeta[]>` — read each `.jsonl`, extract first/last timestamp, cwd, model.
  - Returns sessions sorted by recency.
- I/O wrapper only. No analysis here.

### Step 3 — Transcript parser (pure runner)
- Create `src/modules/transcript/parse.ts`:
  - Input: file contents as `string` (caller reads file; parser is pure).
  - Output: `ParsedSession { id, model, turns, totals, toolCalls[] }`.
- Handle Claude Code's `.jsonl` shape: each line is a JSON object with `type: 'user' | 'assistant' | 'tool_use' | 'tool_result'`, plus `usage` blocks on assistant turns.
- Robust to malformed lines — emit `E003` issues, never crash.
- Test fixtures: drop 3 real (sanitized) transcripts into `tests/fixtures/transcripts/`.

### Step 4 — Analyzers (pure runners, one per metric)
Create `src/modules/transcript/analyzers/` with one file per concern:
- `tokens.ts` → M001–M004, M010, M011.
- `duplicateReads.ts` → M007, M008, R003.
- `idleContext.ts` → M009.
- `topExpensive.ts` → top-5 tool calls by token cost.
- `counterfactual.ts` → M012, M013, M014 — "what would Sipcode have saved."

Each analyzer is a pure function `(session: ParsedSession) => AnalyzerResult`.

### Step 5 — Pricing
- Create `src/lib/pricing/2026-05-01.json` per AUDIT-FRAMEWORK schema.
- Create `src/lib/pricing/load.ts` — pick the pricing file ≤ session date.
- Receipts always cite the pricing file version they used.

### Step 6 — Renderer (pure)
- Create `src/modules/why/render.ts`:
  - Inputs: all analyzer results + pricing.
  - Output: a `RenderedReport` object (no I/O, no chalk yet).
- Create `src/modules/why/format-terminal.ts` — converts `RenderedReport` to a colored string using chalk.
- Create `src/modules/why/format-json.ts` — converts to a stable JSON shape (snapshot-tested).

### Step 7 — CLI wiring
- `src/cli.ts`: Commander entry. Register `why`, `--help`, `--version`.
- `src/commands/why.ts`: orchestrates discovery → parse → analyze → render → print.

### Step 8 — Tests
- Unit tests on every analyzer with hand-rolled `ParsedSession` fixtures.
- Integration test that runs `sipcode why --json` against the fixture transcripts and snapshot-matches.
- Drift test: render-format snapshots — failing on accidental output changes.
- Aim for ≥ 90% coverage on `src/modules/transcript/**` and `src/modules/why/**`.

---

## 4. Definition of done

- [ ] `npx tsx src/cli.ts why` runs against the user's real `~/.claude/projects` and prints a useful report.
- [ ] `npx tsx src/cli.ts why --json` prints valid JSON matching the snapshot.
- [ ] All tests pass with `npm test`.
- [ ] Coverage ≥ 90% on touched modules.
- [ ] No `any` types, no `@ts-ignore`, no unhandled promise rejections.
- [ ] All user-facing strings live in `src/lib/messages.ts` (no inline literals scattered across files).
- [ ] README's `## Quick start` section can be followed verbatim and works.
- [ ] At least one fixture transcript ships with realistic numbers — used for demos and for the launch screenshot.

---

## 5. What NOT to do in this milestone

- Do **not** implement manifest generation. That's the next milestone.
- Do **not** implement receipt PNG/HTML. Terminal-only for this milestone.
- Do **not** add network calls. `sipcode why` is fully offline.
- Do **not** add a hosted backend. Local-only.
- Do **not** rename any ID. If you think one's wrong, propose an edit to `AUDIT-FRAMEWORK.md` and stop.

---

## 6. Edge cases to handle

- User has no `~/.claude/projects` directory → friendly error, link to Claude Code docs.
- Transcript spans multiple models (Sonnet → Opus mid-session) → price each turn separately.
- Transcript has no `usage` blocks (older Claude Code versions) → degrade to `M005` and a warning; show what we can.
- Pricing file older than the session → use it but warn (`E004`).
- File paths in tool calls are Windows-style on Windows, POSIX on macOS/Linux → normalize before deduping.
- Cache hits in `cache_read_input_tokens` are cheap — don't count them in M008 the same way as real reads.

---

## 7. Code review checklist (self-review before considering done)

1. Are all analyzers pure?
2. Are there `InMemoryFs`-style test seams everywhere I touch the filesystem?
3. Have I introduced any new public ID without adding it to `AUDIT-FRAMEWORK.md`?
4. Does every error path produce a `SipcodeValidationError` with a stable `E###` code?
5. Are user-facing strings centralized?
6. Do snapshot tests cover the JSON and terminal output formats?
7. Is the terminal output Twitter-screenshot-worthy at 1200×630?

---

## 8. After this milestone — what's next

The next session-handoff (which will live at `docs/SESSION-HANDOFF-NEXT.md` when this one is done) covers v0.1.0-alpha.2: the Smart Manifest Generator. That milestone introduces:
- tree-sitter integration
- git plumbing for hot-files
- `.sipcode/manifest.md` write + `CLAUDE.md` injection
- AST-based file purpose inference

When you finish the current milestone, archive this file to `docs/handoffs/v0.1.0-alpha.1-why.md` and write the next one against the same template.

---

## 9. Stuck? Ask these questions first

- "Is this in scope for v0.1.0-alpha.1?" (Check PROJECT-SPEC §6.)
- "Is there a stable ID for this already?" (Check AUDIT-FRAMEWORK.)
- "Can I solve this without an LLM call?" (Almost always yes — that's the rule.)
- "Would Answerable's pattern handle this?" (Pure runner + I/O wrapper.)

If still stuck, ask Anuj. He'd rather answer one question now than review a wrong direction in a week.

---

*End of handoff. Implement carefully. Sip, don't gulp.*
