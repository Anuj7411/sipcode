# Sipcode — ROADMAP

> Living document. Updated after every release. Last updated 2026-05-18.

This roadmap is opinionated about *order*, not dates. Side projects ship when they ship.

---

## v0.0.x — Scaffolding (current)

- [x] Project structure, package.json, tsconfig, vitest config
- [x] PROJECT-SPEC, ROADMAP, AUDIT-FRAMEWORK, SESSION-HANDOFF
- [x] README with the 0.6% wedge
- [ ] GitHub repo `Anuj7411/sipcode` created and pushed
- [ ] Domain `sipcode.dev` purchased
- [ ] First CLI scaffold (`sipcode --help` works)

**Exit criteria:** `npx sipcode --help` runs from a published prerelease.

---

## v0.1.0 — Phase 1: The Wedge

The three deliverables that prove the thesis.

### v0.1.0-alpha.1 — `sipcode why` (install-free demo)

- [ ] Read `~/.claude/projects/<hash>/*.jsonl` transcripts
- [ ] Parse Claude Code message format (turns, tool_use, tool_result, usage blocks)
- [ ] Compute per-session totals: input, output, cache_read, cache_creation
- [ ] Identify top-5 most expensive tool calls
- [ ] Identify duplicate file reads with redundancy cost
- [ ] Identify idle context (files in context for N+ turns, not referenced)
- [ ] Render the **0.6% breakdown** for the user's actual session
- [ ] Compute savings estimate if Sipcode had been installed
- [ ] Terminal output with chalk + ora; `--json` flag for programmatic use

**Demo target:** `npx sipcode why` on a real session takes < 3 seconds and produces a Twitter-shareable terminal screenshot.

### v0.1.0-alpha.2 — Smart Manifest Generator

- [ ] `npx sipcode init` — interactive setup (3 prompts max, à la Answerable)
- [ ] `npx sipcode manifest` — non-interactive generation
- [ ] tree-sitter-based AST scan (JavaScript, TypeScript, Python, Go for v0.1; rest later)
- [ ] File-purpose inference: filename + first-comment + first export
- [ ] Import graph extraction
- [ ] Hot-files index from `git log --name-only`
- [ ] Pattern detection: import style, naming convention, package manager, framework
- [ ] Token-budget enforcement: refuse to emit > 2k tokens without `--no-budget`
- [ ] Write `.sipcode/manifest.md`
- [ ] Inject reference into `CLAUDE.md` (idempotent, preserves user content)
- [ ] Snapshot tests via `InMemoryFs`

### v0.1.0-alpha.3 — Shareable Receipt

- [ ] `npx sipcode receipt [session-id]` — defaults to latest session
- [ ] Terminal receipt (always)
- [ ] HTML receipt (default file output)
- [ ] PNG receipt via `--png` or `--share` (skip for alpha if hard; ship HTML first)
- [ ] Receipt design draft — Anuj reviews before locking
- [ ] Hosting hint: `sipcode.dev/r/<short-id>` for shareable URLs (Phase 2 — local-only for v0.1)

### v0.1.0 — Stabilization

- [ ] Reproducible benchmark suite (`tests/benchmark/`) — 5 real Claude Code tasks
- [ ] Benchmark CI workflow that prints before/after on every PR
- [ ] Doc site stub (skip Nextra; plain Next.js + MDX, lesson learned from Answerable)
- [ ] First public release to npm
- [ ] Launch post draft (Twitter + HN + Reddit r/ClaudeAI)

**Exit criteria:** Reproducible benchmark shows ≥ 25% real-world token reduction from Phase 1 features alone. Public README cites it.

---

## v0.2.0 — Phase 2: The Full Stack

### v0.2.0 — Output Compression Module

- [ ] Professional CLAUDE.md rule set (diff output, no preamble, structural compression)
- [ ] `npx sipcode rules` to inspect/edit
- [ ] Three modes: default, strict, verbose (`SIPCODE_MODE` env var)
- [ ] Test against benchmark — must not hurt task completion quality

### v0.2.0 — Stack Orchestration

- [ ] Detect RTK; offer install; configure
- [ ] Detect context-mode; offer install; configure
- [ ] Detect ccusage; integrate for cost data instead of computing from pricing file
- [ ] Adapter pattern with graceful degradation

### v0.2.0 — Multi-agent support

- [ ] Cursor (`.cursorrules`)
- [ ] Codex configuration
- [ ] Gemini CLI configuration
- [ ] Aider configuration

### v0.2.0 — `sipcode estimate "<task>"`

- [ ] Heuristic-based cost prediction per model (Opus, Sonnet, Haiku)
- [ ] Uses manifest size + task length as inputs
- [ ] One-line output: `"Refactor: ~$2.30 Opus / $0.80 Sonnet / $0.18 Haiku"`

**Exit criteria:** Benchmark hits 40–50% reduction with full stack active. First non-Anuj contributor PR merged.

---

## v0.3.0 — Phase 3: Session Hygiene

- [ ] Read-once cache with PreToolUse hook
- [ ] Context-pressure warnings (50% / 70% / 90%)
- [ ] Smart `/compact` timing on post-test, post-commit hooks
- [ ] MCP server pruning detector

---

## v0.4.0 — Phase 4: Distribution & Team

- [ ] Distribute as Claude Code plugin/skill
- [ ] VS Code / Cursor extension (token cost in status bar)
- [ ] Team mode (`sipcode link <team>`) — anonymized metrics upload
- [ ] Team-tier pricing live ($20/seat/month)
- [ ] First org dashboard

---

## v1.0.0 — General availability

- [ ] All Phase 1–3 features stable
- [ ] First edition of The Sipcode Index published
- [ ] Featured in ≥ 3 AI-engineering newsletters
- [ ] ≥ 10k GitHub stars

---

## Backlog (no order, no commitment)

- Spec-first mode (`sipcode plan "<task>"`)
- Predictive pre-summarize ("warm cache")
- Local LLM router (route exploration to Ollama for free)
- `sipcode doctor` — diagnose a slow / expensive setup
- Per-language tree-sitter expansion (Rust, Java, Kotlin, Swift, Ruby, PHP)
- Shareable URL hosting (`sipcode.dev/r/<id>`)
- Public REST API for receipt data
- Self-hosted org dashboard
