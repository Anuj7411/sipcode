# Sipcode — Session Handoff Packet (2026-06-04)

> **Purpose:** Hand off complete context to a fresh Claude Code session so the new session feels like a direct continuation of the current one. No re-explaining, no re-deciding, no re-exploring. Read this top to bottom on session start.

---

## TL;DR — what the new session inherits

- **Shipped product:** `sipcode@1.4.0` is live on npm. Repo public at `github.com/Anuj7411/sipcode`. README has the brand wordmark hero. Brand kit lives at `docs/brand/`. Plugin submitted to Anthropic's `claude-plugins-community` marketplace (pending review since 2026-05-26).
- **In-flight work:** Phase A of v1.5.0 — building `sipcode proxy`, a Claude Code PreToolUse hook that rewrites tool inputs (matches RTK's mechanic). The implementation plan is locked at `docs/superpowers/plans/2026-06-04-sipcode-proxy-phase-a.md`. About 5 of 22 tasks complete. Tests 853 → ~880 expected by ship.
- **Why this exists:** Real-user signal — Anuj's friends installed v1.4.0 and reported "no difference in token usage." The observatory-only positioning isn't enough; Sipcode must actively save tokens out of the box. Phase A is the fix.
- **Critical architecture finding from this session:** the original Phase A plan invented a non-existent `replace_tool_response` field. The plan-eng-review caught it before any code was written. The corrected plan uses `PreToolUse + updatedInput` (the documented Claude Code contract). This pivot saved roughly 4 days of misdirected build work.
- **Next step:** Continue executing the v2 plan. Tasks 6-22 remain.

---

## Where the code is RIGHT NOW

Run these on session start to confirm state:

```bash
cd C:\Projects\Sipcode
git log --oneline -8
git status --short
npm view sipcode version
npm test --silent | tail -3
```

**Expected output (as of handoff):**

- `git log --oneline -8`:
  ```
  3f8a4b1 wip(proxy): grep rewriter — 2 failing tests, needs hand-finish in next session
  c4d8b9f feat(proxy): Tasks 4-5 + cat/find drafts — cargo --quiet, ls/find | head
  09561d7 feat(proxy): npm rewriter — ls/list --depth=0 when no depth/all/json set
  f400ac3 feat(proxy): git rewriter — status -s + log --oneline -n 20 when absent
  3161d75 feat(proxy): verified Claude Code PreToolUse contract types
  12c9b39 docs(plans): rewrite Phase A plan — verified PreToolUse + updatedInput contract
  f9ac6c5 docs(plans): Phase A sipcode-proxy — 22-task TDD plan for v1.5.0
  ```
  (commit hashes may differ — the meanings won't)
- `git status --short`: clean OR shows only LF/CRLF line-ending warnings
- `npm view sipcode version`: `1.4.0` (latest published; v1.5.0 in progress)
- `npm test --silent | tail -3`: 102 files passing, ~877 tests passing, 2 failing (in `tests/modules/proxy/rewriters/grep.test.ts`)

If anything diverges from the above, read this file's "Reconciliation" section near the bottom.

---

## The 22-task plan — what's done and what's next

The full plan is at `docs/superpowers/plans/2026-06-04-sipcode-proxy-phase-a.md` (842 lines). Read it before continuing.

| # | Task | Status | Commit |
|---|---|---|---|
| 1 | Verified hook contract types (`src/modules/proxy/types.ts`) | ✅ DONE | `3161d75` |
| 2 | git rewriter (status `-s`, log `--oneline -n 20`) | ✅ DONE | `f400ac3` |
| 3 | npm rewriter (`ls/list --depth=0`) | ✅ DONE | `09561d7` |
| 4 | cargo rewriter (`--quiet`) | ✅ DONE | `c4d8b9f` |
| 5 | ls rewriter (`\| head -50`) | ✅ DONE | `c4d8b9f` |
| 6 | find rewriter (`\| head -100`) | ⚠️ DRAFTED but not yet wired into registry | `c4d8b9f` |
| 7 | grep rewriter (Bash grep `-c` for recursive) | 🔴 WIP — 2 failing tests | `3f8a4b1` |
| 8 | cat rewriter (head + tail wrap for single-file cats) | ⚠️ DRAFTED but not yet wired into registry | `c4d8b9f` |
| 9 | native Read rewriter (inject `limit: 2000`) | ⏳ NOT STARTED | — |
| 10 | native Grep rewriter (inject `head_limit: 50`) | ⏳ NOT STARTED | — |
| 11 | native Glob rewriter (inject `head_limit: 100`) | ⏳ NOT STARTED | — |
| 12 | Registry + dispatch (`src/modules/proxy/registry.ts`) | ⏳ NOT STARTED | — |
| 13 | runRewriter orchestrator | ⏳ NOT STARTED | — |
| 14 | Hook script generator (inline, no esbuild) | ⏳ NOT STARTED | — |
| 15 | install.ts (reuse `hygiene/settingsJson.ts`) | ⏳ NOT STARTED | — |
| 16 | `sipcode proxy` CLI command | ⏳ NOT STARTED | — |
| 17 | Stats store (per-PID JSONL files) | ⏳ NOT STARTED | — |
| 18 | `get_proxy_stats` MCP tool (7th tool) | ⏳ NOT STARTED | — |
| 19 | `sipcode benchmark --vs-rtk` | ⏳ NOT STARTED | — |
| 20 | Regression guards (purity + no-fabricated-fields) | ⏳ NOT STARTED | — |
| 21 | README + docs | ⏳ NOT STARTED | — |
| 22 | Version bump + ship v1.5.0 | ⏳ NOT STARTED | — |

**Net: 5 done, 3 partial, 14 untouched.**

---

## What to do FIRST in the new session

```
1. Read this handoff packet top-to-bottom.
2. Read docs/superpowers/plans/2026-06-04-sipcode-proxy-phase-a.md.
3. Read docs/COMPETITIVE-STRATEGY-RTK.md.
4. Confirm git/npm state matches expected (see "Where the code is RIGHT NOW" above).
5. Fix the 2 failing grep tests (smallest immediate task; restores green baseline).
6. Continue with Task 6 (wire find into registry — file already exists, just untested for registry integration), then 7 (finish grep), then 8 (wire cat), then 9-11 (native tool rewriters), then 12 onward.
```

**The very first commit in the new session should fix the failing grep tests** so the suite is fully green before any new work.

### Grep failing-test fix (do this first)

File: `src/modules/proxy/rewriters/grep.ts`

The bug: the rewriter is adding `-c` to commands that already use `-c` or `-l`. The early-return is checking the wrong flag form OR coming after the modification logic.

Required behavior (from plan v2 Task 7):
- Match `grep -r <pattern> <path>` or `grep -R ...` only (recursive flag must be present).
- Return `null` (no rewrite) if `-c` or `-l` is already in the command.
- Otherwise add `-c` after the `-r` / `-R` flag so output becomes per-file match counts instead of per-line match dump.

Test file: `tests/modules/proxy/rewriters/grep.test.ts`. The two failing tests are:
- `does NOT add -c when already in count mode` — expects `null` for `grep -rc foo .`
- `does NOT add -c when in -l (file-list) mode` — expects `null` for `grep -rl foo .`

Fix: use the `hasFlag` helper from `src/modules/proxy/rewriters/base.ts` — call `hasFlag(cmd, "-c", "-l", "--count", "--files-with-matches")` and `return null` if true. Also confirm `-r`/`-R` IS present (or `-rc`-style combined short flags, which `hasFlag` won't catch — use a regex for that).

**Quick test after the fix:**

```bash
npx vitest run tests/modules/proxy/rewriters/grep.test.ts
# Expected: PASS (8 tests, or however many are in the file)
```

Then commit:

```bash
git add src/modules/proxy/rewriters/grep.ts
git commit -m "fix(proxy): grep rewriter — return null when -c/-l already present"
```

---

## The architecture decision the new session MUST honor

**The Phase A plan v2 uses ONLY PreToolUse hooks with `updatedInput`.** This decision is locked. The full record is in the commit message at `12c9b39` and in the plan file's "ARCHITECTURE DECISION RECORD (v2)" section.

If during execution the new session feels like reaching for PostToolUse output replacement: stop. That field does not exist in Claude Code's hook contract. Verified at `https://code.claude.com/docs/en/hooks` on 2026-06-04. The regression guard test in Task 20 will fail the build if anyone reintroduces a `replace_tool_response` reference.

Key mental model:
- Sipcode does NOT filter tool outputs at runtime. It REWRITES tool inputs so the tool naturally produces shorter output.
- Example: `git status` → `git status -s` happens BEFORE git runs. Git produces 5 lines instead of 200 organically. Claude reads what git produced.
- This is the same mechanic RTK uses.

---

## How to resume the gstack flow

The gstack pipeline we committed to:

```
✅ writing-plans              → v2 plan committed
✅ plan-eng-review            → caught architecture bug, v2 corrected
🚧 feature-dev:feature-dev    → in progress, ~22% done (5 of 22 tasks)
⏳ review (gstack)            → pre-landing audit (run before tagging v1.5.0)
⏳ qa (gstack)                → live testing of `sipcode proxy --install`
⏳ ship + land-and-deploy     → tag v1.5.0, watch CI, verify npm
```

When you're ready to continue, invoke the next gstack skill the moment its predecessor is genuinely done. Do not skip steps.

---

## Critical context the new session won't have without this packet

### 1. Why Phase A exists (not in the plan file)

**Real-user signal from 2026-06-03:** Anuj's friends installed v1.4.0 and reported "no difference" in token usage. Sipcode's observatory-first design means out-of-the-box it does NOTHING to save tokens. The user (Anuj) explicitly rejected this — wants Sipcode to actually save tokens, not just measure them. Phase A is the response.

### 2. Why we use gstack (not in the plan file)

User asked for the gstack engineering team workflow. Gstack is Garry Tan's open-source Claude Code skill pack — 23 skills that transform Claude Code into a "virtual engineering team" with CEO / Designer / Eng Manager / Reviewer / Release Manager roles. It's already installed locally at `~/.claude/skills/gstack/`. We used `writing-plans → plan-eng-review → feature-dev` so far.

### 3. The bug class that the integrity contract catches (relevant if anyone questions Sipcode's brand)

Twice now Sipcode's own integrity guards caught bugs before they shipped:
- **v1.2.2:** Claude in chat audited the impact tool, found that `recoverableTokens` could exceed `totalTokens` (mathematically impossible). Caught and fixed pre-launch.
- **v1.4.0:** Output ratio formula included `cacheReadTokens` in the denominator, making the ratio look near-0% on cache-heavy sessions. Caught and fixed.
- **Phase A v1 plan:** Plan-eng-review caught the fabricated `replace_tool_response` field before any code was written. Caught and corrected.

This is the brand: a product that refuses to lie attracts honest audits; honest audits find real problems; real problems get fixed structurally; trust compounds. The new session must keep that posture.

### 4. The README hero image uses an absolute GitHub URL (not the relative path)

`README.md` line ~17 uses `https://raw.githubusercontent.com/Anuj7411/sipcode/main/docs/brand/wordmark/wordmark-horizontal.png` not a relative path. This is intentional — relative paths break on the npm package landing page because `docs/brand/` is not in the npm tarball. Do not change this back.

### 5. Three external surfaces require MANUAL upload (cannot be done via API)

These remain outstanding and the new session may want to nudge Anuj to do them when convenient:

| What | Where | File |
|---|---|---|
| GitHub repo social-preview image | github.com/Anuj7411/sipcode/settings | `docs/brand/social/github-social-preview.png` |
| Twitter avatar (if/when account exists) | Twitter profile settings | `docs/brand/social/twitter-profile.png` |
| LinkedIn banner (if/when account exists) | LinkedIn profile | `docs/brand/social/linkedin-banner.png` |

Anuj explicitly deferred these until the marketing push — don't push it before v1.5.0 ships.

---

## File map — where critical things live

```
C:\Projects\Sipcode\
├── docs/
│   ├── superpowers/plans/
│   │   └── 2026-06-04-sipcode-proxy-phase-a.md  ← THE PLAN (842 lines, v2)
│   ├── superpowers/specs/
│   │   └── 2026-05-22-today-and-forecast-mcp-tools-design.md  ← v1.3.0 spec (not yet built — Phase A bumped it)
│   ├── COMPETITIVE-STRATEGY-RTK.md  ← The "why phase A" doc
│   ├── VISION.md                    ← The north star
│   ├── LAUNCH-PLAYBOOK.md           ← Drafted launch posts (Twitter/HN/Reddit)
│   ├── USER-TEST-PLAYBOOK.md        ← Cold-state dogfood plan
│   ├── POST-V1.2.2-BACKLOG.md       ← Future features surfaced by real signal
│   ├── CONTINUATION.md              ← Previous session's handoff (older, less current than THIS file)
│   ├── MCP.md                       ← 6 MCP tools documented; will become 7 in v1.5.0
│   ├── TESTING.md                   ← Canonical test catalog
│   ├── ENGINEERING-PIPELINE.md      ← 5-gate release process
│   ├── PROJECT-SPEC.md              ← Locked product spec
│   ├── ROADMAP.md                   ← Phased shipping plan
│   ├── brand/                       ← Complete brand kit (icon + wordmark + social)
│   └── screenshots/                 ← README hero images
│
├── src/
│   ├── cli.ts                       ← CLI entry point — register `proxy` here in Task 16
│   ├── mcp/server.ts                ← MCP server — add `get_proxy_stats` here in Task 18
│   ├── modules/
│   │   ├── hygiene/                 ← REFERENCE ARCHITECTURE for the proxy module (mirror this exactly)
│   │   │   ├── hookScript.ts        ← Template for proxyHookScript.ts (Task 14)
│   │   │   ├── install.ts           ← Template for proxy/install.ts (Task 15)
│   │   │   ├── settingsJson.ts      ← REUSE THIS for proxy (upsertSipcodeHook, removeSipcodeHooks)
│   │   │   └── types.ts             ← Reference for types organization
│   │   ├── impact/                  ← Reference for: pure runner + format-* + types pattern
│   │   ├── why/                     ← Reference for: forensic audit module
│   │   └── proxy/                   ← IN-PROGRESS — Phase A target dir
│   │       ├── types.ts             ← ✅ DONE (Task 1)
│   │       └── rewriters/
│   │           ├── base.ts          ← ✅ DONE (shared helpers)
│   │           ├── git.ts           ← ✅ DONE
│   │           ├── npm.ts           ← ✅ DONE
│   │           ├── cargo.ts         ← ✅ DONE
│   │           ├── ls.ts            ← ✅ DONE
│   │           ├── find.ts          ← ⚠️ DRAFTED (just confirm tests pass, then good)
│   │           ├── cat.ts           ← ⚠️ DRAFTED (same)
│   │           ├── grep.ts          ← 🔴 2 FAILING TESTS — fix first
│   │           ├── nativeRead.ts    ← ⏳ TODO (Task 9)
│   │           ├── nativeGrep.ts    ← ⏳ TODO (Task 10)
│   │           └── nativeGlob.ts    ← ⏳ TODO (Task 11)
│   ├── lib/
│   │   ├── timeout.ts               ← ✅ DONE (v1.3.4) — use for MCP tool wrapping
│   │   ├── privacy.ts               ← Privacy guard import (ASSERT_NO_NETWORK)
│   │   ├── pricing/                 ← Anthropic pricing JSON
│   │   └── ...
│   └── commands/                    ← One file per CLI subcommand
│
├── tests/
│   ├── modules/proxy/               ← Proxy tests (mirror src/modules/proxy/ structure)
│   ├── e2e/release-smoke.test.ts    ← MUST be updated in Task 18: bump 6 tools → 7
│   ├── guards/                      ← Regression guards (Task 20 adds 2 more here)
│   └── privacy/no-network.test.ts   ← Privacy contract — must continue to pass
│
├── package.json                     ← Version 1.4.0 → 1.5.0 in Task 22
├── .claude-plugin/plugin.json       ← Version stays in sync with package.json (Task 22)
├── .claude-plugin/marketplace.json  ← Own marketplace entry
├── .mcp.json                        ← Claude Code plugin MCP config
└── skills/                          ← Claude Code plugin slash command skills (why/impact/estimate/benchmark)
```

---

## Sipcode patterns the new session must follow (non-negotiable)

1. **Pure runners + I/O seams.** Every module under `src/modules/<feature>/` has a pure `run<X>.ts` that takes inputs and returns outputs with zero I/O. I/O lives in `src/commands/<feature>.ts` or `src/lib/*.ts`.
2. **ASSERT_NO_NETWORK import** on every CLI entry file. (Just import it; the file does the privacy assertion at load time.)
3. **Branded types + real validators** for non-primitive values.
4. **`Result<T, E>` in pure runners.** Never throw mid-flight. Throws only at I/O boundaries.
5. **Stable check IDs as public API.** Anything user-facing (rewriter names, MCP tool names, JSON schema versions) is locked once shipped. Renames are breaking changes.
6. **Drift-prevention snapshot tests.** Every generated artifact (manifest, HTML report, PNG receipt, JSON output) is snapshot-tested.
7. **Regression guards in `tests/guards/`** for every shipped bug class. Static guards prevent regressions structurally.
8. **`withTimeout` wrapping** for every MCP tool handler. The guard test `tests/guards/mcp-tool-timeouts.test.ts` enforces.
9. **5-gate release pipeline.** Build + unit + e2e + OIDC publish + CDN verify. CI rejects bad publishes structurally.
10. **NEVER reintroduce `replace_tool_response`.** Regression guard `tests/guards/proxy-no-fabricated-fields.test.ts` (Task 20) will be added to enforce.

---

## How the npm publish flow works (in case the new session ships v1.5.0)

```bash
# Final local gate (run all 5 gates locally)
npm run build
npm test --silent | tail -5     # expect ~880 tests, all green

# Tag + push triggers CI
git add -A
git commit -m "feat(v1.5.0): sipcode proxy — runtime input rewriting (matches RTK), 60-90% savings out of the box"
git push origin main
git tag v1.5.0
git push origin v1.5.0

# Watch CI green (~50-70s)
gh run watch $(gh run list --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId') --exit-status

# Confirm npm has it
npm view sipcode version dist-tags.latest   # expect 1.5.0
```

If anything fails, CI logs at `gh run view <run-id> --log`. Common failure modes documented in `docs/TESTING.md`.

---

## Open questions the new session may need to answer

These are NOT blockers but might come up:

1. **Hook script size budget.** The plan inlines all rewriter logic into a single `.mjs` hook file. If that file grows past ~600 lines, consider whether the v1 esbuild bundling decision (deferred from Phase A v2) needs to be reopened.
2. **Cross-platform shell parsing.** v1 plan documents the limitation: prefix-match on the first token; chained commands (`git status && pwd`) fall through to identity. Anuj has explicitly accepted this for v1. Phase B can add proper shell tokenization.
3. **Stats store TTL.** Per-PID JSONL files accumulate over time. Plan doesn't currently address cleanup. New session should add a simple "delete files older than 30 days" sweep on `sipcode proxy --stats` invocation if it has cycles.
4. **Plugin marketplace status.** Submitted to `claude-plugins-community` on 2026-05-26. As of handoff, no email back yet. Check `https://github.com/anthropics/claude-plugins-community/blob/main/.claude-plugin/marketplace.json` for `sipcode` entry. If approved, README + LAUNCH-PLAYBOOK.md can be updated to use the `@claude-community` install path as primary.

---

## Reconciliation — if state diverges from this packet

If `git log --oneline -8` doesn't match the expected output:

- **More commits than expected:** the new session continued work after this handoff was written. Read the new commit messages — they describe what was added. Skip the corresponding plan tasks.
- **Fewer commits than expected:** something got reverted or the user picked up on a different branch. Run `git reflog | head -20` to see recent history.

If `npm view sipcode version` is higher than 1.4.0 — v1.5.0 (or later) already shipped from another session. Read `git log` to find the ship commit and verify the proxy works in Claude Desktop before doing further work.

If `npm test` reports more than 2 failing tests — something else broke since handoff. Bisect: `git checkout 09561d7` (Task 3 commit, known-good), run tests, then walk forward. Don't continue building new tasks on a broken baseline.

---

## How to start the new session efficiently

Copy and paste this into the new chat as your first message:

```
Continuing the Sipcode session. Full context in:
- docs/SESSION-HANDOFF-2026-06-04.md  ← read this first
- docs/superpowers/plans/2026-06-04-sipcode-proxy-phase-a.md  ← the locked plan
- docs/COMPETITIVE-STRATEGY-RTK.md
- docs/VISION.md

Current state: sipcode@1.4.0 live on npm. Phase A of v1.5.0 in progress.
5 of 22 tasks committed. The plan went through plan-eng-review which caught
a critical architecture bug (fabricated PostToolUse field) and corrected to
the verified PreToolUse + updatedInput contract. The plan is LOCKED.

Last commit: WIP grep rewriter with 2 failing tests. New session's first
job: fix those 2 grep tests, restore green baseline, then continue Task 6
(find) through Task 22 (ship v1.5.0).

Read the handoff packet end-to-end before doing anything. Then confirm you
understand the architecture decision, then continue from Task 6.
```

---

## Wisdom inherited (read this once, internalize)

These principles are LIVE for this project. The new session must honor them:

1. **The product refuses to lie.** Every metric, every claim, every commit message survives scrutiny. If the data doesn't support it, the tool says so (e.g., `delta: null` when comparison windows aren't fair).
2. **The user is in the room.** Anuj reviews every architecture decision. Do not silently commit major design pivots — ask via AskUserQuestion.
3. **Stop running comprehensive audits unless something is broken.** The 5-gate pipeline catches issues. Daily bug hunts produce more bugs than they catch.
4. **Honest pushback over flattery.** When Anuj proposes something that won't work, say so directly. When his friends say "no difference," that's signal, not noise — listen.
5. **Brief is good, silent is bad.** During long work, give 1-sentence updates at key moments. Don't disappear into a 30-minute tool-call streak without checking in.
6. **The MCP wedge is unique. The integrity contract is unique. Lean into both.** Don't try to out-RTK RTK on raw token savings ground — match the mechanic, then leapfrog with semantic compression in Phase B.
7. **Anuj burns through Claude Code Max in 2 hours.** This project is personally meaningful to him, not abstract. Treat the work like his life depends on it (because his budget does).

---

*End of handoff packet. Whoever picks up next — read this top to bottom, then read the plan, then continue from Task 6 (after fixing the failing grep tests). You have everything.*
