# Changelog

All notable changes to Sipcode. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/spec/v2.0.0.html) with the project's patch-by-default policy ([feedback_versioning.md](docs/VERSIONING.md)).

This log starts at v1.6.5 (the reliability-pillar repositioning). Earlier history lives in commit messages.

---

## [Unreleased]

_Nothing landed since [1.6.17]._

## [1.6.17] — 2026-06-25

Quality-of-life release: a real update path, cleaner numbers, and the current model name.

### Added
- **`sipcode update`** — a one-stop command that shows your installed version and the exact command to upgrade. Run it plain to print `npm i -g sipcode@latest` (plus a link to this changelog), or `sipcode update --run` to upgrade in place. Sipcode still never checks for updates on its own — zero network calls — so updating stays a deliberate, manual step. README gained a matching "Updating Sipcode" section and FAQ entry.

### Fixed
- **Stats no longer counts sessions that aren't yours.** Observer/telemetry plugins (e.g. claude-mem) create synthetic, zero-work session folders under `~/.claude/projects`. Those were inflating `stats`, `today`, and `why` — one machine showed 1,446 sessions when only ~21 were real, and `today` reported "0 tokens" across dozens of empty sessions. Sipcode now skips observer project folders and empty (zero-token) sessions everywhere, so counts, daily spend, and the "latest session" pick reflect real work. The same fix flows through the MCP tools, which read the identical discovery path.
- **`estimate` now names the current model.** It showed "opus 4.7"; it now shows "opus 4.8" (alongside sonnet 4.6 / haiku 4.5).
- **Friendlier first run.** On a machine with no Claude Code sessions yet, `sipcode stats` used to claim "transcripts exist, but none in the window" — false for a brand-new user. It now says "no Claude Code sessions found yet" and points you at getting started.

### Internal
- Test count: 1,363 → 1,373. Full suite green. The new `sipcode update` command stays inside the zero-network privacy guard (no `node:http` / `node:https` / `node:net` / `node:dns`) and the no-shell-args guard (npm is resolved as `npm.cmd` on Windows, no `shell: true`).

---

## [1.6.16] — 2026-06-22

F-CACHE-DEFER + F-NATIVE-GREP — the two P0 fixes from the 2026-06-17 dogfood backlog. Tests 1,317 → 1,363.

### Fixed
- **F-CACHE-DEFER: `sipcode init` no longer invalidates the prompt cache of an active Claude Code session.** v1.6.15's Verified Warm-Fill fixed Sipcode's own dedup cache, but a separate problem remained: writing `~/.claude/settings.json` mid-session forces Anthropic's prompt cache to reset, which can cost more in extra input tokens than Sipcode saves on tool output. Anuj's 2026-06-17 session: `sipcode drift` flagged "Cache reuse down 83 points" and the regression dwarfed the proxy savings on that day. v1.6.16 detects active Claude Code sessions before writing settings.json and defers the write to a pending marker if one exists; the next quiet `sipcode` command auto-applies. The hook script file itself is still written immediately (safe — does not invalidate the cache). Pass `--force` to install anyway when you want to bypass the check.
- **F-NATIVE-GREP: raised the `native-grep` cap from 50 to 100 matches.** The same dogfood session showed `native-grep` was 30% of all proxy work but had the lowest signal-kept ratio (65%). Symbol lookups in larger codebases routinely returned 50–100 matches Claude needed for follow-up reads; the 50-cap was too aggressive. Doubling the cap restores most of that signal while still bounding pathological greps. Integrity declaration moves from 0.65 to 0.78.

### Added
- **`src/modules/init/sessionDetection.ts`** — pure module that scans `~/.claude/projects/<proj>/sessions/<sid>.jsonl` for files modified within the threshold (default 5 min = Anthropic's prompt-cache TTL). 13 tests cover empty layouts, single recent/stale detection, multi-project counts, permission failures, race-condition stat-returns-null, non-jsonl filtering, and custom thresholds.
- **`src/modules/init/pendingInstall.ts`** — marker module at `~/.sipcode/install-pending.json` (schema `sipcode-install-pending/1`). Strict version validation rejects unknown future schemas rather than mis-applying. `applyPendingInstall` regenerates the proxy hook script at apply time (so users always get the latest) and applies `installProxyHook` against the CURRENT settings.json (preserving any user-managed hook entries). Idempotent: a second apply finds no marker and no-ops.
- **`maybeApplyPendingInstall`** — CLI startup wrapper. Wired into `cli.ts` via a Commander `preAction` hook for every command except `init`. Fast no-op when no marker; skips when an active session is detected (cache safety); applies when safe and logs a single line. Hook failures never block the user's actual command.
- **`--force` flag on `sipcode init`.** Bypasses F-CACHE-DEFER active-session detection and installs settings.json directly, invalidating the active session's prompt cache. Use when you want the install now and accept the cost (e.g. on a fresh machine where the "active session" is the one you just opened to install Sipcode).
- **New `StepStatus` variant `{ kind: "deferred"; reason: string }`** for the v1.6.15 SETUP card. Renders with the ⏸ glyph and a specific footer ("auto-applies on your next sipcode command outside an active session, or pass --force") so users understand what happened and what to do next.

### Engineering
- Test count: 1,317 → 1,363 (46 new tests). Branch `v1.6.16-fixes` ships as one PR for review surface; full suite green every commit.
- Branch and commit trail: each step (detection module / pending-install module / runSystemSetup integration / CLI auto-apply / nativeGrep tune) ships as a separate commit with the related tests included, so any single step can be reverted in isolation.

---

## [1.6.15] — 2026-06-15

Verified Warm-Fill + `sipcode init` system-setup. v1.6.14's path-normalization fix closed the dedup gap for re-reads that happened *after* Sipcode was installed mid-session. v1.6.15 closes the gap for re-reads that happened *before* Sipcode was installed — the dedup cache is now back-filled from the active Claude Code transcript with zero false-dedup risk by construction. Tests 1266 → 1317.

### Fixed
- **Mid-session install no longer leaves the dedup cache empty.** Anuj's dogfood (2026-06-15) showed `sipcode drift` reporting 624,940 tokens wasted on repeated reads while `sipcode proxy --stats` reported only ~7,553 saved by the dedup-read row, an 83x gap. Root cause: the hook only sees Reads that happen after install, so re-reads of files Claude already read pre-install never had a cache entry to collide against. v1.6.15 adds Verified Warm-Fill at the top of the hook's first fire in a session.

### Added
- **`src/modules/proxy/prewarmCache.ts` — Verified Warm-Fill pure module.** On first hook fire per session, walks the Claude Code transcript JSONL (provided in `transcript_path`), finds every full-file Read whose `toolUseResult.file.content` field records the bytes Claude saw, canonicalizes both transcript and current disk content (LF line endings + UTF-8 BOM stripped), and writes a cache entry ONLY when both hashes agree. Drift between transcript bytes and current disk bytes (file edited externally between historical read and install) drops the candidate silently. Cap at 200 most-recent files; parallel disk verification keeps first-fire latency under ~250ms on typical sessions.
  - Architecture detail in [`docs/research/2026-06-15-mid-session-cache-warming.md`](docs/research/2026-06-15-mid-session-cache-warming.md).
- **Zero false-dedup by construction.** Warmfill only adds entries to the lookup table. The dedup decision rule (`decideReadDedup`) is unchanged: every Read still re-hashes current disk and only dedups on sha + mtime match. If disk drifted between warmfill and re-read, sha differs, the read passes through. There is no path that produces a wrong dedup; this is a property of the design, not the test coverage.
- **One-shot marker `~/.sipcode/proxy-reads/<sid>.warmed`** prevents the hook from re-walking the transcript on every fire. Marker is written only after a non-bailed warmfill attempt, so transient transcript-unavailable conditions still allow retry on the next fire.
- **`ReadEntry.source?: "live" | "warmfill"`** — optional, backwards-compatible. v1.6.14 cache entries without the field read cleanly. Reserved for future per-source stats rows.
- **`sipcode init` extended with system-setup.** Existing project-setup steps (manifest + CLAUDE.md sub-block + output-compression rules) all preserved. New steps run after them on Claude Code targets: detect installation, verify `~/.claude/settings.json` writable, install the proxy hook (idempotent — reports "already installed" when signature matches), set the `sipcode impact` baseline marker, verify the MCP server registers all 15 tools. Style-C output card replaces the legacy `done. sip your tokens.` line.
- **New `sipcode init` flags:** `--no-proxy`, `--no-marker`, `--no-verify-mcp` to opt out of individual system-setup steps. All default to off (run the step).
- **`docs/CLI-OUTPUT-STYLE.md`** locks the style-C terminal output pattern for all CLI surfaces. Reused as the template for the landing-page terminal cards.
- **`getRegisteredMcpToolCount()`** exported from `src/mcp/server.ts` so `init` can verify the tool count without spawning a subprocess.

### Verified
- 1,317 tests passing (1,266 + 51 new). Includes 27 prewarm unit specs, 5 hookReadDedup warmfill integration specs, 19 init system-setup specs.
- e2e MCP gate green (15 tools registered, each with a schema).
- Privacy guard (S090): zero forbidden network imports in any new file.
- Two consecutive full-suite runs both 1,317 / 1,317 with zero variance.

### Upgrade

Users on v1.6.14 can upgrade with `npm i -g sipcode@latest` once promoted from `next`. The dynamic-import design of the proxy hook means **no `sipcode proxy --install` re-run is required** — the on-disk hook script's signature is unchanged at v4, but the module it imports (`hookReadDedup.js`) now contains the warmfill code, picked up automatically.

---

## [1.6.14] — 2026-06-14

Path-normalization fix. The dedup hook, the heuristic walker, and the top-expensive analyzer used the raw `file_path` string; drift's `duplicateReads` analyzer normalized via a private helper. Result: drift correctly counted ~49K wasted tokens in one of Anuj's real sessions while `sipcode proxy --stats` reported only ~1K, a ~50x undercount of the dedup hook's actual potential. Tests 1252 → 1266.

### Fixed
- **Single source of truth for "is this the same file?".** New `src/lib/path-normalize.ts` exports `normalizeFilePath()`: lowercases the Windows drive letter, converts backslashes to forward slashes, resolves through `path.resolve`, leaves trailing slashes alone. Wired into:
  - `src/modules/proxy/hookReadDedup.ts` — cache lookup AND cache write (line 151 write path was the second half of the bug).
  - `src/modules/proxy/vsRtk.ts` — `seenReadFiles` set in the heuristic walker.
  - `src/modules/transcript/analyzers/topExpensive.ts` — `readCounts` map (powers `sipcode why` duplicate-read tags).
  - `src/modules/transcript/analyzers/duplicateReads.ts` — was already correct via its own local helper; DRY-ed to import the shared lib.

### Verified clean (no fix needed)
- `hookAstRead.ts` uses `file_path` only as the argument to `readFile`; OS handles case-insensitivity.
- `signal-cache.ts` keys on grep patterns, not file paths.
- `sessionCachePath` was already sanitized via the v1.6.13 H1 fix.

### Added
- 14 new tests across `tests/unit/lib/path-normalize.test.ts` and `tests/integration/hookReadDedup.path-norm.test.ts` covering Windows ↔ POSIX drive-letter equivalence, mixed separators, trailing-slash preservation, and dedup cache-key collision in the happy path.

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

[Unreleased]: https://github.com/Anuj7411/sipcode/compare/v1.6.17...HEAD
[1.6.17]: https://github.com/Anuj7411/sipcode/compare/v1.6.16...v1.6.17
[1.6.16]: https://github.com/Anuj7411/sipcode/compare/v1.6.15...v1.6.16
[1.6.15]: https://github.com/Anuj7411/sipcode/compare/v1.6.14...v1.6.15
[1.6.14]: https://github.com/Anuj7411/sipcode/compare/v1.6.13...v1.6.14
[1.6.13]: https://github.com/Anuj7411/sipcode/compare/v1.6.12...v1.6.13
[1.6.12]: https://github.com/Anuj7411/sipcode/compare/v1.6.11...v1.6.12
[1.6.11]: https://github.com/Anuj7411/sipcode/compare/v1.6.10...v1.6.11
[1.6.10]: https://github.com/Anuj7411/sipcode/compare/v1.6.8...v1.6.10
[1.6.9]: https://github.com/Anuj7411/sipcode/compare/v1.6.8...v1.6.9
[1.6.8]: https://github.com/Anuj7411/sipcode/compare/v1.6.7...v1.6.8
[1.6.7]: https://github.com/Anuj7411/sipcode/compare/v1.6.6...v1.6.7
[1.6.6]: https://github.com/Anuj7411/sipcode/compare/v1.6.5...v1.6.6
[1.6.5]: https://github.com/Anuj7411/sipcode/compare/v1.6.4...v1.6.5
