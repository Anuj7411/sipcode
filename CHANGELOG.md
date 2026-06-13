# Changelog

All notable changes to Sipcode. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/spec/v2.0.0.html) with the project's patch-by-default policy ([feedback_versioning.md](docs/VERSIONING.md)).

This log starts at v1.6.5 (the reliability-pillar repositioning). Earlier history lives in commit messages.

---

## [Unreleased]

_Nothing landed since [1.6.13]._

---

## [1.6.13] — 2026-06-14

Pre-launch security hardening pass. Zero behavior changes for the happy path; all changes are defensive. Tests 1247 → 1252.

### Security
- **H1 — path traversal via `session_id` (LOW).** `src/modules/proxy/read-cache.ts` + `signal-cache.ts`: new `sanitizeSessionId()` allowlist `[a-zA-Z0-9_-]{1,64}`; non-matching ids fall back to a literal `unsafe-session` so a malformed PreToolUse event cannot write outside the cache directory.
- **H2 — ReDoS via prompt-injected Grep pattern (LOW).** `src/modules/proxy/ast/relevance.ts`: regex tier in `matchScore()` now short-circuits when `pattern.length > 200` or `symbol.length > 200`. Tests assert sub-50 ms wall time against catastrophic-backtracking patterns like `^(a+)+b`.
- **F2 — non-atomic settings.json write (LOW).** `src/modules/benchmark/sipcodeIsolation.ts`: `realIsolationIO.write` and `writeSync` now use tmp + rename. Mid-write crash leaves the original `~/.claude/settings.json` untouched.
- **H3 — no CSP on landing page (INFO).** `docs/site/src/pages/index.astro`: added `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy` meta tags.

### Added
- **F6 CI gate.** `.github/workflows/guard-version-bump.yml` fails on push to `main` if `package.json`'s minor or major segment grew without a `[minor-ok]` or `[major-ok]` marker in the commit subject. Catches the v1.7.0-slip class of mistakes.

---

## [1.6.12] — 2026-06-14

Pre-launch npm metadata polish. No behavior changes.

### Changed
- `package.json` description rewritten: removed em-dash, leads with reliability per the locked positioning. Reads "Sip your tokens, don't gulp them. Keep Claude Code's context clean: drift detection, re-read dedup, integrity scoring, AST-aware reads, and 15 MCP tools for Claude Desktop."
- Keywords expanded from 7 to 14: added `claude-desktop`, `context-engineering`, `drift-detection`, `context-rot`, `mcp`, `ast`, `reliability`.
- README header now displays the Sipcode logo via absolute `raw.githubusercontent.com` URL so it renders on the npmjs.com page.

---

## [1.6.11] — 2026-06-13

### Fixed
- **`CHANGELOG.md` now bundled in the published tarball** (added to the `files` whitelist in `package.json`). Was committed to the repo but the tarball was skipping it, so the npmjs.com page couldn't link to release notes.

---

## [1.6.10] — 2026-06-13

This release rolls v1.6.9's B3 work (bumped but never published to npm) together with the post-bump additions.

### Added
- `sipcode trend <metric> --since <NNd|NNw|NNm>`: single-metric time series across a window. Three metrics: `output-ratio` (robust to session-length variance), `cost-per-session`, `recoverable-tokens-per-session`. Sparkline plus plain-language verdict (`improving | stable | regressing | insufficient-data`) plus min/median/max. Pure linear-slope math. Closes POST-V1.2.2-BACKLOG item 2.
- `sipcode today` CLI + `get_today_summary` MCP tool: daily dashboard. Spend so far + sessions count + output ratio + comparison against an adaptive 30/14/7/3 day median (cascade falls through to the largest tier with enough history). Top-leak detection via duplicate-read analyzer. Four status branches: `ok | no-sessions-today | no-baseline | no-data`. Schema `sipcode-today/1`.
- `sipcode forecast` CLI + `forecast_monthly_spend` MCP tool: projected month-end spend at current trajectory. Confidence band sized as `±min(stdev_daily × daysRemaining, 0.20 × projected)` so stable users get tight bands and spiky users never get absurdly wide ones. Last-month comparison when the prior calendar month had sessions. Five status branches: `ok | insufficient-data | near-month-end | no-recent-activity | no-data`. Schema `sipcode-forecast/1`.
- `src/lib/baseline-window.ts`: shared adaptive baseline resolver used by both `today` and `forecast`. Honest partial-window labeling ("last 12 days (all you have so far)").
- MCP tool count: 13 → **15**.

### Changed
- Release-smoke and MCP integration guards now assert exactly 15 documented tools (was 13).

### Notes
- The v1.6.9 git tag remains in the repo history (it points to the B3 commit) but no `sipcode@1.6.9` was published to npm. Users go directly from v1.6.8 to v1.6.10.

---

## [1.6.9] — 2026-06-12 (tagged but not published)

> Bumped locally; rolled into [1.6.10] for ship. The B3 work below is in `sipcode@1.6.10`.

### Added
- **B3 AST-aware symbol-level reads.** New PreToolUse routing for `Read` on `.ts/.tsx/.js/.jsx/.py` files larger than 200 lines: parse the file via tree-sitter, score top-level symbols against the per-session signal cache (recent Grep/Glob/Bash-grep patterns), and when a symbol matches with confidence ≥ 0.7 inject `offset+limit` to return only that symbol's line range plus a small context buffer. Safety floors: passes the full file through when in doubt (no signal, no parser, ≥80% coverage would defeat the trim, parser-load failure). Hook signature bumped `v3 → v4`. Languages supported: TypeScript/JavaScript and Python.
- `src/modules/proxy/ast/ts-symbols.ts`, `py-symbols.ts`, `relevance.ts`: pure symbol extractors and relevance scorer. Tree-sitter native bindings are wrapped in `loadParser()` with try/catch so a missing or broken binding degrades to pass-through, never breaks Claude Code.
- `src/modules/proxy/signal-cache.ts`: per-session JSONL at `~/.sipcode/proxy-signals/<session>.jsonl` recording Grep/Glob/Bash-grep patterns the relevance scorer uses.
- `src/modules/proxy/hookAstRead.ts`: the impure orchestrator that ties the above together. Lives outside `rewriters/` so the rewriter-purity guard still applies.
- E2E smoke test (`tests/e2e/proxy-hook-smoke.test.ts`): spawns the generated hook `.mjs` against a temp `HOME`, sends fake `PreToolUse` events (Grep then Read), asserts the signal cache populates, AST trim fires with the right `offset+limit`, and a stats entry is written. Validates the full chain without burning Anthropic credit.
- Pricing data refreshed to `2026-06-11` (kills the E004 "pricing 40 days old" warning). New model IDs added: `claude-opus-4-6`/`4-7`/`4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`.

### Changed
- `sipcode benchmark --vs-rtk` heuristic now credits B3 AST trim (3,000 tokens per first-read of an AST-eligible file post-Grep). Combined with the B5 dedup credit added in v1.6.7, the locked 20-task corpus now claims **300 calls, 144 rewrites, ~366,500 saved tokens** (the prior v1.6.7 number was ~150,500; the v1.6.6 number was ~48,500).

### Fixed
- **Critical (caught by the new e2e smoke test).** `src/modules/proxy/ast/ts-symbols.ts` + `py-symbols.ts` used `require("node:module").createRequire(...)` in what compiles to an ES module. `require` is undefined in ESM; the try/catch silently swallowed the `ReferenceError`; the loader returned `null`; `extractTsSymbols()` always returned `[]`; the orchestrator quietly bailed; B3 looked like it worked in unit tests but did nothing in a real Claude Code session. Replaced with a top-level `import { createRequire } from "node:module"`.

---

## [1.6.8] — 2026-06-11

### Added
- **B4 compression-integrity scoring.** Every rewriter now declares an `integrityScore` in `[0.0, 1.0]` indicating how much of the original signal is preserved after the rewrite. Surfaced in `sipcode proxy --stats` as a weighted-average `signal kept: NN% (high | med | low)` headline plus a per-rewriter `NN% kept` column. Honesty signal RTK has no equivalent for.
- Per-rewriter scores (declared per rewriter, not measured per invocation):
  - `0.95`: `dedup-read` (defers, never drops), `npm-install` (drops audit/fund/progress noise only).
  - `0.85`: `cargo` (`--quiet`), `git-status` (`--short`).
  - `0.75`: `native-glob`.
  - `0.65`: `native-grep`.
  - `0.55`: `tsc` (head-100; later errors may be hidden), `cat`, `npm-view`.
  - `0.50`: `git-diff`, `find`.
  - `0.30`: `git-log` (caps to 20 commits; the biggest drop in the registry).
- Schema additions (additive, backwards compatible with pre-v1.6.8 stats files):
  - `RewriterResult.integrityScore` plus optional `integrityNote`.
  - `ProxyStatsEntry.integrityScore` (optional; older entries aggregate fine without it).
  - `ProxyReport.perRewriter[name].avgIntegrityScore` (optional).
  - `ProxyReport.weightedAvgIntegrityScore` (optional).

---

## [1.6.7] — 2026-06-10

### Added
- **B2 live `--vs-rtk` execution harness.** `sipcode benchmark --vs-rtk --live` spawns `claude --print --output-format json` once per task per condition (off / on) and persists measured token usage to `~/.sipcode/benchmark-live/results.jsonl`. Costs real Anthropic credit; opt-in only.
- Sipcode-only isolation toggle (`src/modules/benchmark/sipcodeIsolation.ts`): temporarily strips ONLY the Sipcode hook entry from `~/.claude/settings.json` for the off-condition run, leaving claude-mem and other hooks intact so the delta is Sipcode-attributable. SIGINT-safe restore via `finally` plus process listener.
- New Bash rewriters: `tsc` (head-100), `npm-install` (`--no-audit --no-fund --loglevel=error`), `npm-view` (head-80 for full-dump form).
- `--vs-rtk` heuristic now credits B5 dedup: each re-read of the same file in a transcript counts +2,000 tokens. The proxy's biggest single feature was previously uncounted in the headline number. Corpus result: 24 → 72 rewrites, ~48,500 → ~150,500 saved tokens.

### Fixed
- `hookReadDedup` no longer early-returns when `session_id` is empty (it is empty on `claude --print --no-session-persistence`). Falls back to a stable `pid+cwd` session key so the dedup cache populates in live runs.

---

## [1.6.6] — 2026-06-09

### Added
- **B5 integrated re-read dedup.** When Claude calls `Read` on a file already read this session and the file is unchanged on disk, the proxy emits a PreToolUse `permissionDecision: "deny"` with a short reason ("Sipcode dedup: <path> is unchanged since turn N; the content is still in your context from that turn"). The Read is skipped and Claude reuses what it already has.
- First architectural deviation from Phase A. The original proxy was `PreToolUse + updatedInput` only (all `"allow"` rewrites). v1.6.6 adds the `"deny" + reason` path for the dedup case where the right answer is "don't run the tool."
- Per-session cache at `~/.sipcode/proxy-reads/<session_id>.jsonl`.
- Safety floors: refuse to dedup partial reads (`offset`/`limit` specified), files below `MIN_TOKENS_FOR_DEDUP` (100 tokens), or when `sha256`/`mtimeMs` mismatch.
- Hook script signature bumped `v2 → v3`.

---

## [1.6.5] — 2026-06-08

### Added
- **Drift v2: persistent baselines + per-project + MCP config attribution.**
  - Persistent baseline cache at `~/.sipcode/drift/sessions.jsonl`. Warm runs ~3× faster; survives Claude Code's transcript GC.
  - Per-project baselines: history filtered by `projectHash`, with global fallback when per-project history < 3 sessions. Removes cross-project dilution that v1 had.
  - Config-cause attribution: each run snapshots the user's MCP server list to `~/.sipcode/drift/configs.jsonl`. When cache-reuse regresses, the `Cache reuse` `DriftCause` names the specific server added or removed inside the baseline window.
- New CLI flag: `sipcode drift --no-cache` to bypass the persistent cache.
- Schema bumped `sipcode-drift/1 → sipcode-drift/2` (additive, v1 consumers still typecheck).

### Changed
- Landing page deployed at <https://anuj7411.github.io/sipcode/> via GitHub Pages + Actions. Vanilla Astro, 5.14 KB JS / 2.02 KB gzip.

---

[Unreleased]: https://github.com/Anuj7411/sipcode/compare/v1.6.13...HEAD
[1.6.13]: https://github.com/Anuj7411/sipcode/compare/v1.6.12...v1.6.13
[1.6.12]: https://github.com/Anuj7411/sipcode/compare/v1.6.11...v1.6.12
[1.6.11]: https://github.com/Anuj7411/sipcode/compare/v1.6.10...v1.6.11
[1.6.10]: https://github.com/Anuj7411/sipcode/compare/v1.6.8...v1.6.10
[1.6.9]: https://github.com/Anuj7411/sipcode/compare/v1.6.8...v1.6.9
[1.6.8]: https://github.com/Anuj7411/sipcode/compare/v1.6.7...v1.6.8
[1.6.7]: https://github.com/Anuj7411/sipcode/compare/v1.6.6...v1.6.7
[1.6.6]: https://github.com/Anuj7411/sipcode/compare/v1.6.5...v1.6.6
[1.6.5]: https://github.com/Anuj7411/sipcode/compare/v1.6.4...v1.6.5
