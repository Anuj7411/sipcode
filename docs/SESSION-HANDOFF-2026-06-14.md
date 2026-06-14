# Session handoff — 2026-06-14

> **For the next Claude session:** read this top to bottom before doing anything. Then read [`memory/MEMORY.md`](C:\Users\ojhaa\.claude\projects\C--Projects-Sipcode\memory\MEMORY.md), then [`memory/project_sipcode_positioning.md`](C:\Users\ojhaa\.claude\projects\C--Projects-Sipcode\memory\project_sipcode_positioning.md). Together those three files give you 95% of what the previous session knew. Don't re-explore the codebase; you'll waste budget. Don't ship anything until you understand sections 0, 1, and 2 below.

---

## 0. Right-now state (the one sentence you need first)

**v1.6.14 is bumped, tagged locally, fully tested (1266/1266), dist is built and contains the fix, AND IS WAITING FOR ANUJ TO RUN `npm publish` IN HIS OWN TERMINAL.** Everything else is downstream of that.

If the previous turn in chat says "ready to publish" or shows the publish command, your first move is to wait for Anuj to come back and say "published" (or "done"). Do not push the tag, do not create the GitHub Release, do not update memory until he confirms.

---

## 1. The fix v1.6.14 carries (the most important thing to understand)

A real bug we found by reading Anuj's live dogfood data 3 turns ago.

**Symptom:** `sipcode drift` (which uses the duplicateReads analyzer that normalizes paths) reported **49,218 tokens wasted on dupes in ONE session**. `sipcode proxy --stats` (which used the dedup hook that did NOT normalize paths) reported **3 dedup fires saving ~1,053 tokens across ALL sessions**. A ~50x undercount.

**Root cause:** Three modules that should agree on "is this the same file?" used the raw `file_path` string instead of a normalized form. Claude Code sometimes emits `C:\foo\bar.ts` and other turns emits `c:/foo/bar.ts` for the same on-disk file. Drift correctly counted these as dupes via its private `normalizeFilePath` helper. The dedup HOOK couldn't match them.

**Fix:** extracted `normalizeFilePath` to `src/lib/path-normalize.ts` as single source of truth. Applied in four sites:

1. `src/modules/proxy/hookReadDedup.ts` — was raw, now normalizes before cache lookup AND write
2. `src/modules/proxy/vsRtk.ts` (heuristic walker) — was raw, now normalizes
3. `src/modules/transcript/analyzers/topExpensive.ts` (powers `sipcode why` "duplicate-read" tags) — was raw, now normalizes
4. `src/modules/transcript/analyzers/duplicateReads.ts` (drift) — was already correct, now imports from the shared lib (DRY)

**Verified clean (no fix needed):**
- `hookAstRead.ts` uses file_path only to read from disk; OS handles case-insensitivity
- `signal-cache.ts` stores grep patterns, not paths
- `sessionCachePath` is sanitized via the v1.6.13 H1 fix

**Real-world prediction:** after v1.6.14 publishes and Anuj reinstalls, the `dedup-read` count in his `sipcode proxy --stats` should jump from ~3 to 20-30+ on a typical session, and est. tokens saved from ~1K toward the ~49K range that drift was correctly counting.

---

## 2. The TWO hard NOs you must carry in (or you will get burned)

These came up in earlier sessions and are baked into Anuj's memory files:

### Hard NO 1: never bump minor version without explicit permission

Sipcode follows **patch-by-default**. v1.7.0 is reserved for the launch and for genuine breaking changes only. We slipped once this week (bumped v1.7.0 accidentally for B3, recovered via `git reset --soft HEAD~1` before publish). A CI gate (`.github/workflows/guard-version-bump.yml`) now fails any push to main where the minor segment grew without `[minor-ok]` in the commit subject.

**If you find yourself typing `npm version minor`, stop and ASK Anuj first.** This is non-negotiable.

### Hard NO 2: copy/marketing rules from the locked positioning

- **No em-dashes** (— or `--`) anywhere in copy or chat. Use commas, colons, periods, or parentheses.
- **Never claim "Sipcode stops hallucinations."** LLMs hallucinate; we'll be blamed if Claude does after install. The honest narrower claim is "reduces drift-driven errors." Cite Anthropic's published 29% quality lift from cleaner context, never claim it as ours.
- **No hype verbs:** revolutionize, supercharge, unleash, transform, disrupt, blast, crush.
- **No fake numbers.** The only numbers you cite: 62.6% measured corpus median (range 37.4-80.6%), 3,567,170 tokens saved, $67.43, 1266 tests, 15 MCP tools, ~366,500 heuristic saved, Anthropic's 29% (cited).
- **No exclamation marks in body copy.**
- **No "not just X but Y" or "Both X and Y" rhythms** (AI tells).
- **No "Let me explain," "Here's the thing," "Of course!"** openings.
- **No "coming soon" placeholders.** Concrete v2 commitments (predictive context, cross-session hygiene) ARE allowed because they're scoped with one-liners; vague "we might add" is not.
- **No Reddit posts.** Anuj's Reddit accounts get banned.

The full ruleset lives in [`memory/project_sipcode_positioning.md`](C:\Users\ojhaa\.claude\projects\C--Projects-Sipcode\memory\project_sipcode_positioning.md). Read it.

---

## 3. What's live on npm + GitHub + the web right now

Until Anuj publishes v1.6.14, the world is at v1.6.13. After he publishes, replace "1.6.13" with "1.6.14" mentally.

| Surface | State |
|---|---|
| npm | `sipcode@1.6.13` live (v1.6.14 pending Anuj's publish). 15 MCP tools, 1252 tests on 1.6.13, 1266 tests on 1.6.14. |
| GitHub repo About | Description (no em-dash) + homepage = https://anuj7411.github.io/sipcode/ + 15 topics |
| GitHub Releases | v1.6.11, v1.6.12, v1.6.13 (v1.6.14 to be created after publish) |
| Landing site | https://anuj7411.github.io/sipcode/ shows `v1.6.13 · MIT`, `1,247 tests` (will need post-publish bump to v1.6.14 + 1266) |
| CHANGELOG | bundled in tarball as of v1.6.11. Covers v1.6.5 → v1.6.13. Needs a v1.6.14 section. |
| Launch kit | `docs/launch/` — README, x-thread.md, product-hunt.md, cold-email.md. Ready to use. |

---

## 4. The dogfood data from Anuj's real Claude Code session

Three turns ago Anuj shared screenshots from running v1.6.8 (his global install) on his actual work. These are the most important real-world signals we have. Memorize them.

**`sipcode benchmark` on his machine:** 62.6% median, 3,567,170 tokens saved, $67.43. **Matches the corpus claim.** Reproducible.

**`sipcode proxy --stats` on his real work:**

| | |
|---|---|
| Total rewrites | 53 (proxy is firing) |
| Est. tokens saved | ~93,053 |
| Signal kept | 63% (med) |
| `dedup-read` | 3 fires, ~1,053 saved, 95% kept |
| `native-grep` | 16 fires, ~32,000 saved, 65% kept |
| `cat` | 15 fires, ~30,000 saved, 55% kept |
| `ls` | 12 fires, ~18,000 saved, 60% kept |
| `native-glob` | 4 fires, ~6,000 saved, 75% kept |
| `git-log` | 1 fire, ~3,000 saved |
| `grep` | 2 fires, ~3,000 saved, 60% kept |
| `ast-read` | **0 fires** ← UNVALIDATED in production |

**`sipcode drift` on his latest session:**
- Tokens per turn up 70%: norm 74,721 → this session 127,352
- Repeated file reads: norm 0 → this session **49,218 tokens wasted**
- This is the gap that exposed the path-normalization bug

**`sipcode impact`:** all-time totals (1043 sessions, 9089.83M tokens, $26,381.89 spend, 0.6% output ratio). NO install marker yet so no before/after split is possible.

**`sipcode today` / `sipcode forecast`:** `error: unknown command` — because his global is on v1.6.8, those commands shipped in v1.6.10.

### What this proves
- Proxy hook fires in real sessions ✅
- B5 dedup fires in real sessions (just not enough — that's the v1.6.14 fix) ✅
- B4 integrity scoring is surfacing real signal ✅
- Drift detector caught real context rot (THE killer feature) ✅
- Corpus benchmark verifies on his machine ✅

### What's still NOT validated
- **B3 AST-aware reads firing in production** (0 `ast-read` fires across 53 rewrites). Could be (a) no big TS/Py file was read after a Grep during his test window, or (b) something is wrong. We need to see > 0 `ast-read` after he upgrades to v1.6.14 + dogfoods for several hours.
- **The dedup fix actually delivering the predicted improvement** (needs v1.6.14 install + dogfood).
- **A personal `sipcode impact` number for the launch tweet.** Needs `sipcode rules --install` + ~7 days of post-marker sessions.

---

## 5. The launch decision (still open)

Two paths:

**Path A: launch this week.** Use the corpus 62.6% as the anchor number in the launch tweet. Sipcode is shipped, polished, the launch kit is ready. Cost: less compelling launch hook because no first-person delta number.

**Path B: wait ~7 days** for Anuj to:
1. Upgrade to v1.6.14 (`npm i -g sipcode@latest`)
2. Run `sipcode rules --install` to set the install marker
3. Use Claude Code normally for ~7 days
4. Run `sipcode impact` to get a real before/after personal-delta number
5. Use that number as the launch tweet anchor ("I cut my Claude spend from $X to $Y, ~Z%")
6. Confirm `sipcode proxy --stats` shows `ast-read N×` (validates B3)
7. Confirm `dedup-read` count + savings jumped post-fix (validates v1.6.14)

I recommended Path B in the previous session. Anuj hasn't decided. **Don't push him; offer when the moment is right.**

---

## 6. The full inventory of what shipped between v1.6.4 and v1.6.14

This is the launch-claim surface. Memorize what each feature does.

| Version | Date | What |
|---|---|---|
| v1.6.5 | 2026-06-08 | Drift v2 (persistent baselines, per-project, MCP config attribution). Landing page deployed. |
| v1.6.6 | 2026-06-09 | **B5** re-read dedup. PreToolUse `permissionDecision: "deny"` with reason on unchanged-since-turn-N files. Per-session cache at `~/.sipcode/proxy-reads/<sid>.jsonl`. |
| v1.6.7 | 2026-06-10 | **B2** live `sipcode benchmark --vs-rtk --live` harness. Sipcode-only isolation toggle (strips ONLY the Sipcode hook entry from settings.json for off-condition). Heuristic now credits B5 dedup. New rewriters: `tsc`, `npm-install`, `npm-view`. |
| v1.6.8 | 2026-06-11 | **B4** compression-integrity scoring. Every rewriter declares `integrityScore` 0-1. `sipcode proxy --stats` shows weighted `signal kept: NN% (high\|med\|low)` plus per-rewriter `NN% kept` column. |
| v1.6.9 | 2026-06-12 | **TAGGED BUT NEVER PUBLISHED.** Rolled into v1.6.10. The B3 AST-aware reads commit. ESM bug fix (`require("node:module").createRequire(...)` → top-level `import { createRequire }`). |
| v1.6.10 | 2026-06-13 | `sipcode trend <metric> --since <window>`. `sipcode today` + `get_today_summary` MCP tool. `sipcode forecast` + `forecast_monthly_spend` MCP tool. MCP count 13 → 15. |
| v1.6.11 | 2026-06-13 | Fix: CHANGELOG.md now bundled in the published tarball. |
| v1.6.12 | 2026-06-14 | Pre-launch npm metadata polish. Em-dash removed from description. Keywords expanded 7→14. README logo via absolute raw.githubusercontent URL. |
| v1.6.13 | 2026-06-14 | Pre-launch security hardening. H1 sanitize session_id. H2 ReDoS guard in relevance scorer. F2 atomic settings.json write. H3 CSP + nosniff + referrer-policy meta tags. F6 CI gate against accidental minor bumps. |
| v1.6.14 | 2026-06-14 | **(pending Anuj's publish)** Path-normalization fix. hookReadDedup + vsRtk + topExpensive now agree with duplicateReads on what counts as the same file. Dedup hit rate predicted to jump ~50x. |

**Pre-existing features still in the launch story:**
- `sipcode why` (per-session forensics)
- `sipcode manifest` + `sipcode init`
- `sipcode receipt` (shareable session PDF)
- `sipcode rules` (CLAUDE.md output-compression rules)
- `sipcode hygiene` (read-once cache + context-pressure hooks)
- `sipcode stats` (cross-session analytics)
- `sipcode estimate "<task>"` (per-model cost prediction)
- `sipcode score` (agent-friendliness audit + badge)
- `sipcode benchmark` (locked 20-task corpus, 62.6% median)
- `sipcode impact` (before/after personal delta — needs install marker)

---

## 7. The locked strategic positioning (this rules every customer-facing decision)

Headline: **reliability / clean context, not token optimization.** Token savings (62.6% measured) are the proof point, not the headline. Pitch: "Sipcode keeps Claude's context clean so you get the right answer."

Why: the reliability lane for individual Claude Code devs is open. Enterprise eval has $80M-funded incumbents (Braintrust, LangSmith) but they all need SDK + cloud + team pricing. RTK and the other token tools are commoditizing per-call truncation. We don't try to win that headline race.

**Two committed v2 features (visible on launch page + roadmap):**
1. **Predictive context from git co-edit history.** Sipcode reads `git log --name-only`, builds a co-edit graph, pre-summarizes the next file Claude will probably need.
2. **Cross-session context hygiene.** Today's per-session caches (drift, proxy-reads, signal-cache) extended cross-session: 11am session knows what 9am session showed Claude.

**Two research-only mentions (no commitment, no date):**
3. Adaptive context-pressure compression (Anthropic is competing here at the model layer; watch their roadmap before committing).
4. Symbolic anticipation (meta-feature combining predictive + cross-session + drift; only makes sense after #1 and #2 ship).

Full detail in [`memory/project_sipcode_positioning.md`](C:\Users\ojhaa\.claude\projects\C--Projects-Sipcode\memory\project_sipcode_positioning.md).

---

## 8. Critical files you'll need

**Read in this order at session start:**
1. This file
2. [`memory/MEMORY.md`](C:\Users\ojhaa\.claude\projects\C--Projects-Sipcode\memory\MEMORY.md) (auto-loads)
3. [`memory/project_sipcode.md`](C:\Users\ojhaa\.claude\projects\C--Projects-Sipcode\memory\project_sipcode.md)
4. [`memory/project_sipcode_positioning.md`](C:\Users\ojhaa\.claude\projects\C--Projects-Sipcode\memory\project_sipcode_positioning.md)
5. [`memory/feedback_versioning.md`](C:\Users\ojhaa\.claude\projects\C--Projects-Sipcode\memory\feedback_versioning.md)

**Reference when needed (don't pre-read):**
- `docs/INNOVATION-LOG-2026-06-08.md` — every product idea evaluated (shipped, deferred, dropped, false-paths). The strategic backbone.
- `docs/SESSION-HANDOFF-2026-06-08.md` — original launch-prep handoff. Mostly historical now but the user-preferences section is still binding.
- `docs/launch/README.md` — the launch playbook (T-1, T-0, T+1, T+3, T+7 schedule).
- `docs/launch/x-thread.md`, `product-hunt.md`, `cold-email.md` — copy-paste-ready launch artifacts. Reply-game responses pre-written.
- `CHANGELOG.md` — version history with everything you need to summarize for users.
- `benchmark/METHODOLOGY.md` — corpus methodology for skeptics.
- `docs/COMPETITIVE-STRATEGY-RTK.md` — RTK positioning reconciliation.

**Critical source paths:**
- `src/modules/proxy/proxyHookScript.ts` — the generator for the on-disk hook. SIGNATURE/v4 is current. Routes ALL tool calls through `recordSignal`, then Read calls through `hookAstRead` (B3) → `hookReadDedup` (B5), everything else through `runRewriter`.
- `src/modules/proxy/hookReadDedup.ts` — B5 orchestrator. NOW normalizes paths (v1.6.14).
- `src/modules/proxy/hookAstRead.ts` — B3 orchestrator. UNVALIDATED in production.
- `src/modules/proxy/rewriters/` — the 11 pure rewriters. Each declares integrityScore.
- `src/modules/proxy/ast/` — TS + Python symbol extractors via tree-sitter, relevance scorer.
- `src/modules/drift/` — drift detector (v2 with persistent baselines + per-project + config attribution).
- `src/lib/path-normalize.ts` — **NEW IN v1.6.14**. Single source of truth for "same file?" comparisons.
- `tests/e2e/proxy-hook-smoke.test.ts` — the e2e gate that caught the v1.6.9 ESM bug. Always green now.

---

## 9. The remaining work before launch (ordered by leverage)

After Anuj publishes v1.6.14:

**Must-do (you, the next-session Claude, will do these):**
1. **Wait for "published" confirmation,** then push tag + create GitHub Release with the dedup-bug-fix story (this is great launch material — "we found the bug in our own dogfood data and fixed it pre-launch")
2. **Push the landing-page version bump** (v1.6.13 → v1.6.14, 1252 → 1266 tests). Hero + Footer literals.
3. **Update CHANGELOG.md** with the v1.6.14 section. The compare-links section at the bottom needs the new entry.
4. **Update memory:** `project_sipcode.md` status line, MEMORY.md index hook.

**Should-do (offer to Anuj; he decides):**
5. **Multi-platform install test.** The only audit class we haven't done. Cross-platform install bugs are the highest-yield remaining concern. Have Anuj try `npm i -g sipcode@1.6.14` + `sipcode proxy --install` on a Mac or fresh Windows VM. ~10 min.
6. **Dogfood validation.** Anuj should run `sipcode rules --install` to set the install marker, then use Claude Code normally for several days. Then re-check `sipcode proxy --stats` for:
   - `ast-read` row appearing (validates B3 in production)
   - `dedup-read` count jumping from 3 to 20-30+ on a typical session (validates v1.6.14 fix)
   - Then `sipcode impact` produces a real personal-delta number for the launch tweet

**Then launch.** The launch kit is ready. Follow `docs/launch/README.md` § Recommended launch sequence.

---

## 10. How the previous session ended

The previous session caught the path-normalization bug from Anuj's screenshots. Built `src/lib/path-normalize.ts`, applied it in three sites (hookReadDedup, vsRtk, topExpensive), DRY-ed the drift analyzer to use it too. Added 14 tests. Bumped to v1.6.14. Built fresh dist. Confirmed all four sites have the normalizer wired in the dist. Showed Anuj the publish command.

The very last user message was: **"first let publish it"**

The very last assistant action was: present `npm publish` command + pre-publish state table + the post-publish checklist.

**Your first action in the new session:** wait for Anuj's confirmation. If his first message is "published" or "done," run the post-publish flow. If his first message is anything else, handle that first.

---

## 11. Anuj's working style (so you don't waste his time)

- Indian English. Phrases like "thier" / "becase" / casual punctuation. Not typos, just style.
- Wants to be challenged on bad ideas, not flattered into them.
- Direct: "go," "next," "do it," "lock," "build it" → match that energy.
- Gets frustrated when you re-explain things he already understood or add caveats he doesn't need.
- Very visual. If something has a UI, take a screenshot or boot a server; don't just describe.
- Honest about being a solo indie dev burning his Max plan in 2h. Sipcode IS the solution to his own pain.
- Asks "why" questions when something doesn't make sense ("why are there so many bugs?"). Answer those honestly.
- Verify with real measurements, not assumptions. If you say it works, prove it.

---

## 12. The one thing the previous session was most worried about

**B3 AST-aware reads is the v1.6.x flagship in the README, the FAQ, and the launch posts, but we have ZERO production validation it fires in a real Claude Code session.** The smoke test we built proves the wiring is correct. The unit tests prove the orchestrator picks the right slice. But after 53 real proxy invocations in Anuj's actual work, `ast-read` showed up 0 times.

This is the single biggest unknown going into launch. The plan is: Anuj upgrades to v1.6.14 (which has the ESM bug fix from v1.6.9 + the path normalization), uses Claude Code on real work for several hours, then re-checks `sipcode proxy --stats`. If `ast-read N×` shows up with N > 0, B3 is real and launch-claim-defensible. If N stays at 0 after multiple sessions, we need to **honestly demote B3 in the launch posts** from "we ship this" to "we ship this, real-session validation in progress."

Carry this concern. Don't claim B3 works in production until Anuj's stats show it.

---

## 13. Starting prompt for the new session

Paste this into the new chat as your first message:

```
Continuing the Sipcode project. Read docs/SESSION-HANDOFF-2026-06-14.md end to end before doing anything. After that, read MEMORY.md + project_sipcode_positioning.md + feedback_versioning.md to absorb the strategic and process rules.

Then prove you have full context by answering these in your first reply:

a) What version of Sipcode is the latest published on npm, and what version is bumped+tagged locally but NOT yet published?
b) What was the bug v1.6.14 fixes, and how did the previous session discover it?
c) Why are dedup-read fires expected to jump after Anuj upgrades to v1.6.14?
d) Name the four sites where the path normalizer was applied and which one was already correct (DRY only).
e) Name the two committed v2 features per the positioning memo, and the two research-only ones.
f) State three hard NOs from sections 2.
g) What is the one thing the previous session was most worried about going into launch (section 12)?

Once you've answered all seven, ask me to confirm v1.6.14 is published. Don't do anything else until I confirm.

Match the tone of the previous session: plain English, no em-dashes, no hype verbs, no "Let me explain" preambles, honest when something is broken or unknown. Match the user's direct energy.
```

That's it. Save the prompt to your clipboard, start a new Claude Code session in this directory, paste it, and the new session will pick up where this one left off.

— Sonnet handoff, closing session 2026-06-14
