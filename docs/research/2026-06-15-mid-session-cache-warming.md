# Mid-Session Cache Warming for Sipcode

**Date:** 2026-06-15
**Status:** Research complete, architecture locked, build pending (v1.6.15)
**Trigger:** Anuj's dogfood data showed `sipcode drift` reporting 624,940 tokens wasted on repeated reads in one Claude Code session, while `sipcode proxy --stats` reported only 7,553 tokens saved by dedup-read (6 fires) in the same session. An 83x undercount.

---

## 1. Why this document exists

Anuj challenged the team to find an architecture that **fully** solves the dedup gap, not a "5-15x improvement." The first three designs proposed in conversation (path-only prewarm, edit-aware prewarm, simple sha-prewarm) all had risk tables with multiple medium-to-high entries and only delivered partial value. None of them were acceptable.

This document captures:

1. The exact problem statement and why it matters
2. What every competitor tool in the Claude Code / MCP ecosystem does about it (and what they all miss)
3. The reality of Claude Code's transcript format (verified by directly inspecting a live JSONL)
4. The general-domain prior art (Git, Bazel, Nix, HTTP ETag, Postgres pg_prewarm, SWR) and what each teaches
5. The documented failure modes from real production cache-warming disasters
6. The locked architecture: **Verified Warm-Fill**
7. Acceptance criteria and risk table

The document is the canonical reference for v1.6.15 and for any future change to the dedup cache architecture. Future Claude sessions should read this before re-designing anything in `src/modules/proxy/hookReadDedup.ts` or `src/modules/proxy/read-cache.ts`.

---

## 2. The problem in one paragraph

Sipcode's proxy hook (`src/modules/proxy/hookReadDedup.ts`) maintains a per-session dedup cache at `~/.sipcode/proxy-reads/<session-id>.jsonl`. Every time Claude Code's `Read` tool fires, the hook computes the file's current sha256, looks it up in the cache, and if a prior identical sha is found, returns `permissionDecision: "deny"` so Claude reuses the in-context copy instead of re-reading. The dedup cache is populated only by the hook itself, so when a user installs Sipcode mid-session, the cache starts empty. Re-reads of files Claude already read pre-install can't be deduped because the hook has no historical sha to compare against. Drift's `duplicateReads` analyzer reads the whole transcript and correctly counts the waste; the proxy hook only sees post-install activity. Result: the two surfaces disagree by 1-2 orders of magnitude, users see the gap, and trust in the product collapses.

---

## 3. The non-negotiable constraint

**Zero false-dedup.** If we ever tell Claude "you already saw this file" when Claude's in-context version actually differs from current disk content, Claude works with stale content and produces a wrong answer. That destroys user trust and the launch claim. The architecture must make false-dedup impossible by construction, not just unlikely by test coverage.

---

## 4. What competitor tools do (and what none of them solve)

### 4.1 read-once (PreToolUse bash hook)

- **Approach:** Stores `{path, mtime}` per-session in `~/.claude/read-once/`. On PreToolUse:Read, blocks if cached mtime equals current mtime. TTL = 1200s.
- **Mid-session install:** Not addressed. First read of any file is always allowed regardless of whether Claude already saw it pre-install.
- **False-dedup posture:** Relies on mtime. Files written with mtime preserved (`cp -p`, `git checkout`, tar extraction, editors that restore mtime) bypass change detection. Real false-dedup risk they accept.
- **Public claim:** ~40% savings (19/47 reads in their example).
- **Source:** [read-once article (DEV)](https://dev.to/boucle2026/read-once-a-claude-code-hook-that-stops-redundant-file-reads-4bjk)

### 4.2 claude-mem (read-cache PreToolUse hook)

- **Approach:** Truncates re-reads to line 1 with a "prior observations" hint. (This is the exact hook that intercepted Sipcode's own Read calls earlier in this session.)
- **Documented bug:** [Issue #1719](https://github.com/thedotmack/claude-mem/issues/1719) — when a subagent modifies a file, the parent's re-read still gets truncated because the cached observation predates the change. Combined with Claude Code's built-in dedup that then refuses further reads, the file becomes unreadable for the rest of the session.
- **Proposed fix in their issue tracker:** compare file mtime against last observation timestamp; if file is newer, permit a full read. That is exactly the false-dedup risk Sipcode wants to avoid by design.
- **Mid-session install:** Not addressed. Persistent cross-session memory means any cached observation is suspect across edits.

### 4.3 Codebase Memory MCP family (DeusData/codebase-memory-mcp, code-memory, yuga-hashimoto/codebase-memory)

- **Approach:** Index codebase into SQLite/vector store via tree-sitter; PreToolUse intercepts **Grep/Glob**, not Read. They inject `additionalContext` instead of denying reads.
- **They sidestep the false-dedup problem entirely** by being a complement to Read, not a replacement. Different lane from Sipcode.
- **Sources:** [DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp), [russ.cloud writeup](https://www.russ.cloud/2026/05/10/codebase-memory-mcp-giving-claude-code-and-codex-a-map/)

### 4.4 Semantic Cache MCP (CoderDayton/semantic-cache-mcp)

- **Approach (per its README):** Three-state model — first read (full + cache), unchanged (99% savings via diff/empty response), modified (80-95% via diff).
- **Mid-session warming:** No public details on the keying function or warming.
- **Marketing claim of "99% on unchanged"** is a theoretical ceiling, not a measured floor.

### 4.5 RTK / Roo

- No first-party Read-dedup hook documented in the Roo ecosystem search.
- Roo's posture is "different tool surface entirely" (Roo-Code's own diff/edit tooling), not Read-interception. Not directly comparable on this axis.

### 4.6 Honest gap

**No publicly documented tool solves mid-session warming.** read-once, claude-mem, semantic-cache-mcp all start from empty cache. Sipcode is the first to back-fill from existing session state. This is a real innovation we can claim on launch.

---

## 5. Claude Code transcript format (verified by direct inspection)

The research agent read a live JSONL from `~/.claude/projects/C--Projects-Sipcode/4ccaaa38....jsonl` on Claude Code 2.1.170. Findings are unambiguous and better than the public docs suggest.

### 5.1 `tool_use` entry (assistant message)

```json
{"type":"tool_use","id":"toolu_01DjYo...","name":"Read",
 "input":{"file_path":"C:\\Projects\\Sipcode\\docs\\SESSION-HANDOFF-2026-06-14.md"}}
```

### 5.2 Matching `tool_result` entry (user message)

```json
{"type":"user","message":{"role":"user","content":[
  {"tool_use_id":"toolu_01DjYo...","type":"tool_result",
   "content":"1\t# Session handoff - 2026-06-14"}]},
 "toolUseResult":{"type":"text","file":{
    "filePath":"C:\\Projects\\Sipcode\\docs\\SESSION-HANDOFF-2026-06-14.md",
    "content":"# Session handoff - 2026-06-14",
    "numLines":1,"startLine":1,"totalLines":304}}}
```

### 5.3 The two parallel content fields

| Field | Content | Use it for? |
|---|---|---|
| `message.content[].content` | cat-n formatted text (`<line_num>\t<line>`) | NO — this is what Claude was shown after formatting. SHA-ing this would require us to inverse-format. |
| `toolUseResult.file.content` | **The RAW BYTES, no line numbers, no truncation marker** | **YES — this is what we hash.** It is the actual file content Claude has in context. |
| `toolUseResult.file.{startLine, numLines, totalLines}` | Exact slice Claude saw | YES — distinguishes full reads from partial reads / truncated reads |

This discovery is the entire reason the architecture became bulletproof. We never need to reconstruct content from formatted output. The transcript already records the raw bytes verbatim.

### 5.4 Truncation behavior

- Read defaults: 2000 lines, 2000 chars/line ([anthropics/claude-code#6910](https://github.com/anthropics/claude-code/issues/6910)).
- If `numLines < totalLines`, Claude saw a partial view.
- `toolUseResult.file` tells us exactly which slice: `[startLine, startLine + numLines)`.
- A warmed entry for a partial read must be marked `partial` and only dedup-eligible against an identical `{startLine, numLines}` window or a subset.

### 5.5 Encoding / line endings

- Read normalizes line endings to LF in its output ([anthropics/claude-code#20223](https://github.com/anthropics/claude-code/issues/20223) on cat-n token overhead corroborates the formatting model).
- Sipcode already has `src/lib/path-normalize.ts` as the single source of truth for path normalization (v1.6.14 fix). Same discipline applies to content: LF-normalize before hashing for the "what Claude saw" hash, hash raw bytes for the "what's on disk now" hash, and only dedup when both LF-normalized forms agree.

### 5.6 Sources

- [daaain/claude-code-log](https://github.com/daaain/claude-code-log)
- [docs.rs/claude-code-transcripts](https://docs.rs/claude-code-transcripts)
- [databunny: Inside Claude Code](https://databunny.medium.com/inside-claude-code-the-session-file-format-and-how-to-inspect-it-b9998e66d56b)
- [simonw/claude-code-transcripts](https://github.com/simonw/claude-code-transcripts)

---

## 6. General-domain prior art

| System | What it does | Lesson for Sipcode |
|---|---|---|
| **Git** | Content-addressable, SHA-1 (now SHA-256) Merkle DAG. Object identity = hash of content. [Initial Commit](https://initialcommit.com/blog/git-bitcoin-merkle-tree) | **Identity by content, never by path+mtime.** mtime is metadata; content hash is truth. |
| **Bazel remote cache** | Action Cache + Content-Addressable Store. `--experimental_guard_against_concurrent_changes` re-verifies inputs before declaring a cache hit. [bazel.build/remote/caching](https://bazel.build/remote/caching), [issue #4276](https://github.com/bazelbuild/bazel/issues/4276) | **Re-verify on read, not just on write.** Cache is a hint; verification is the contract. |
| **Nix** | Store paths are `/nix/store/<sha256>-name`. Mid-build join is impossible because everything is derived deterministically from inputs. | Inverse lesson: you can't warm a Nix cache from "what someone else built" without proof. **Only warm from inputs you can independently verify** (the bytes the transcript records). |
| **HTTP ETag / If-None-Match** | Client sends "I have version X." Server verifies and returns 304 or fresh content. [RFC 9111](https://datatracker.ietf.org/doc/html/rfc9111) | **The dedup decision must include a check, not just a lookup.** ETag without re-validation is what causes the CDN auth-leak class of bug. |
| **Postgres pg_prewarm** | Loads pages into shared_buffers; explicitly does not guarantee they stay or are still correct. [docs](https://www.postgresql.org/docs/current/pgprewarm.html) | **Warm cache is a performance hint, never a correctness claim.** If the prewarmed entry is wrong on read, fall back to truth. |
| **stale-while-revalidate** | Serve cached, refresh in background. [Vercel docs](https://vercel.com/docs/caching/cdn-cache) | The fast path must be safe to be wrong, i.e. async correction acceptable only when consumer can tolerate staleness. **Claude cannot.** SWR does NOT fit Read-dedup. |

### 6.1 Synthesized lowest-risk pattern

**Content-addressed warmed entry + synchronous re-verification on each dedup decision.**

- **Warm** = "I assert Claude saw bytes with sha = X."
- **Dedup decision** = "current disk sha equals X right now."

Anything weaker (mtime, path-only, partial trust) is the read-once / claude-mem class of bug.

---

## 7. Documented failure modes from production cache-warming gone wrong

| Incident | Cause | Mitigation we apply |
|---|---|---|
| **Railway CDN auth leak (2025)** [post-mortem](https://www.penligent.ai/hackinglabs/railway-cdn-caching-incident-how-an-edge-cache-misfire-exposed-authenticated-content/) | Edge cache served authenticated content to wrong users; cache keyed on URL without including auth identity. | Cache key must include every dimension that affects the answer. For Sipcode that is `(absolute_path, file_sha, byte_window)`, not just `path`. |
| **Fastly 2021** | Config-triggered cache invalidation cascade. | Cache eviction/expiry must be safe by default. If uncertain, dedup must abstain. |
| **CRLF/BOM gotchas** | File appears unchanged but bytes differ by UTF-8 BOM or line-ending normalization. | Normalize to canonical form (LF, no BOM) at hash time, on both sides. |
| **Off-by-one in reconstruction** | Reconstructing file content from line-numbered transcript output gets wrong on wrapped lines, trailing-newline ambiguity. | **Never reconstruct.** Use `toolUseResult.file.content` which is raw bytes already. Skip warming for entries where this field is absent. |
| **Bazel cache poisoning during concurrent edit** [#4276](https://github.com/bazelbuild/bazel/issues/4276) | File edited mid-build, hash computed against partial write. | Read file + compute hash in a single `fs.readFile`, never stat-then-read. |

---

## 8. The locked architecture: Verified Warm-Fill

### 8.1 Goal

On first PreToolUse:Read after install (or when the session cache is empty/thin), back-fill the dedup cache from the live transcript JSONL so the next re-read of any pre-install file is dedupable, with **zero false-dedup risk by construction**.

### 8.2 Procedure

**Step 1 — Locate transcript.** Claude Code passes `transcript_path` in the hook payload (already used by Sipcode's drift module). Read the JSONL line by line (stream-parse).

**Step 2 — For each `toolUseResult` where `type == "text"` and `file` exists:**

- Extract `{filePath, content, startLine, numLines, totalLines}`.
- Normalize `filePath` through `src/lib/path-normalize.ts` (single source of truth from v1.6.14).
- Compute `seenSha = sha256(LF-normalize(content))` — this is "what Claude saw" with line endings canonicalized.
- Mark `partial = (numLines < totalLines || startLine > 1)`.

**Step 3 — Verify against current disk at warm time:**

- Read current disk bytes, LF-normalize, compute `diskSha`.
- **v1.6.15: skip partial reads (numLines < totalLines or startLine > 1).** They are deferred to v1.6.16 (see § 13). The decision module's safety floor already refuses partial-incoming reads, so a partial cache entry would be unused in steady state. Skipping is conservative: zero false-dedup risk, predictable behavior, simpler code.
- If `diskSha != seenSha`: **drop the entry. Do not warm.** Claude's in-context copy is already stale relative to disk; the next re-read will get fresh bytes naturally and we don't pretend otherwise.

**Step 4 — Store warm entry:**

```ts
{
  path: normalizedPath,
  seenSha,                      // the hash Claude's in-context copy hashes to
  mtimeMs: 0,                   // unknown for warm entries; not used in decision
  sizeBytes: file size at warm time,
  estimatedTokens: size / 4,
  firstReadAtTurn: from transcript turn count,
  firstReadAt: now().toISOString(),
  source: "warmfill",           // provenance flag (new optional field, backwards compat)
  window?: { startLine, numLines }  // present iff partial
}
```

**Step 5 — On every PreToolUse:Read decision (warmed or not):**

- Re-hash the current disk file (LF-normalized).
- Dedup ONLY IF:
  - `diskSha == cachedSha`, AND
  - (`!cached.window` OR the incoming Read's effective window is a subset of `cached.window`).
- Otherwise allow the read.

This is the same decision rule the live cache already uses. Warming changes the lookup table; the decision rule is unchanged.

### 8.3 Why this is zero-false-dedup by construction

- The dedup decision still requires a real-time content-hash match. Warming only adds entries to the lookup table; it does not change the decision rule.
- If disk drifted between warm-fill and the next Read (someone edited the file), the hash check at decision-time catches it and we allow the read.
- The worst case is a useless cache entry (we warmed something that later got edited), never a wrong dedup.
- This is not a "covered by tests" argument. It's an architectural guarantee.

### 8.4 Why this hits full convergence (not 5-15x)

Every Read entry in the transcript with a `toolUseResult.file.content` field becomes dedup-eligible immediately. The entries we miss:

- Partial reads with non-realignable windows: rare; `toolUseResult` still records the slice, so they are mostly handleable via subset check.
- Files Claude saw only via Grep/Bash (no Read tool_use): out of scope for Read-dedup anyway.

For the typical mid-install dogfood case, drift's `duplicateReads` and proxy `--stats dedup-read` should agree within the noise floor.

### 8.5 Cost

- Warm-fill is O(distinct Read entries in transcript) disk reads + hashes.
- On Anuj's 4ccaaa38 session that's a few dozen unique files, sub-second on SSD.
- Bound by a `seenReadsBudget` parameter (default 200 most recent reads) for very long sessions.

### 8.6 Risk table

| Risk | Mitigation | Severity |
|---|---|---|
| Transcript `content` field differs from raw disk bytes by encoding (CRLF/BOM) | LF-normalize before hashing on both sides; warm-fill drops entries where normalized hashes still disagree | **Low** |
| File edited between warm-fill and next Read | Decision-time disk re-hash catches it; cache is a lookup, not a contract | **Low** |
| Partial reads (`numLines < totalLines`) | **v1.6.15: skip entirely.** Decision module's safety floor already refuses partial-incoming reads, so unused entries would be dead weight. v1.6.16 plan: slice-aware warming (track `{startLine, numLines}`, dedup on subset window). | **Low** |

**No risk above low.** The architecture inherits safety from the fact that warming changes the lookup table, not the decision rule.

---

## 9. Acceptance criteria for v1.6.15

| Metric | Before (today, v1.6.14) | After (v1.6.15) |
|---|---|---|
| `sipcode drift` "Repeated file reads wasted" | 624,940 | drops to noise floor (under 10% of baseline, ideally under 50K) |
| `sipcode proxy --stats` `dedup-read` tokens saved | 7,553 | converges with drift, ideally ~500K-600K for the same dogfood session |
| Ratio `drift.wasted / proxy.dedupSaved` | 83x | **under 1.2x — full convergence** |
| False-dedup events in test suite | n/a | **0** (mathematically excluded; we test that disk-edit between warm and read NEVER produces dedup) |
| Hook latency on first fire | <50ms typical | <250ms typical, capped at 500ms hard ceiling |

---

## 10. Test scenarios (will become the v1.6.15 test suite)

1. **Happy path:** Read file at turn 20, install Sipcode at turn 50, re-read at turn 60 → dedup fires correctly.
2. **File edited between historical read and warm:** Edit at turn 30, install at turn 50 → warm-fill drops the entry because diskSha != seenSha → re-read at turn 60 is allowed (fresh).
3. **File edited between warm and re-read:** Install at turn 50 (warm succeeds), edit at turn 55, re-read at turn 60 → decision-time re-hash fails → re-read is allowed (fresh).
4. **Partial read (numLines < totalLines):** v1.6.15 skips warming for partial reads entirely. The test asserts `entries.length === 0` and `stats.skippedPartial === 1` for such inputs. Slice-aware warming is deferred to v1.6.16; the v1.6.15 decision module's existing safety floor already refuses any partial-incoming Read regardless.
5. **Truncated read where toolUseResult.file is incomplete:** Skip warming, fall back to live behavior.
6. **File deleted between warm and re-read:** Decision-time hash fails (file gone) → allow read (Claude gets the error).
7. **CRLF file on Windows:** LF-normalize matches → dedup fires.
8. **BOM file:** Strip BOM before hashing → dedup fires.
9. **Malformed transcript line:** try/catch, prewarm no-ops for that line, hook continues.
10. **5000-Read transcript:** stream-parse, memory bounded, completes under 500ms.
11. **Hook called with malformed input:** existing degrade-to-EMPTY pattern, no regression.
12. **Cache file already has entries from prior post-install hook fires:** warm-fill skips entries that already exist in cache; appends only the gap.
13. **Schema backwards compatibility:** v1.6.14 cache entries (no `source` field) still read correctly by v1.6.15.

---

## 11. Why we will be the first to ship this

The research established that no publicly documented tool in the Claude Code / MCP ecosystem solves mid-session warming. Read-once, claude-mem, codebase-memory-mcp, semantic-cache-mcp, RTK all start from empty cache. This makes "Verified Warm-Fill" a real, verifiable launch claim:

> Sipcode is the first context-management tool that catches re-reads from before it was installed. No restart required. Zero false-dedup risk by construction.

That claim:

- Is independently verifiable by anyone who reads competitor source code or docs.
- Defends the reliability-first positioning locked on 2026-06-12.
- Counterweighs the launch narrative around "we found our own bug from dogfood data" with "and we shipped the architectural fix for it."

---

## 12. Sources (full list)

- [thedotmack/claude-mem issue #1719 - Improper cache validation](https://github.com/thedotmack/claude-mem/issues/1719)
- [read-once article (Bande-a-Bonnot/Boucle)](https://dev.to/boucle2026/read-once-a-claude-code-hook-that-stops-redundant-file-reads-4bjk)
- [anthropics/claude-code issue #6910 - Read 2000-line default](https://github.com/anthropics/claude-code/issues/6910)
- [anthropics/claude-code issue #20223 - cat-n token overhead](https://github.com/anthropics/claude-code/issues/20223)
- [anthropics/claude-code issue #28783 - Read truncation drops guardrails](https://github.com/anthropics/claude-code/issues/28783)
- [Inside Claude Code session format (databunny / Medium)](https://databunny.medium.com/inside-claude-code-the-session-file-format-and-how-to-inspect-it-b9998e66d56b)
- [daaain/claude-code-log](https://github.com/daaain/claude-code-log)
- [simonw/claude-code-transcripts](https://github.com/simonw/claude-code-transcripts)
- [docs.rs/claude-code-transcripts - typed JSONL entries](https://docs.rs/claude-code-transcripts)
- [DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)
- [russ.cloud writeup](https://www.russ.cloud/2026/05/10/codebase-memory-mcp-giving-claude-code-and-codex-a-map/)
- [Bazel remote caching](https://bazel.build/remote/caching)
- [bazelbuild/bazel#4276 - cache poisoning](https://github.com/bazelbuild/bazel/issues/4276)
- [readonly-action-cache](https://christianfscott.com/bazel-readonly-action-cache/)
- [Postgres pg_prewarm](https://www.postgresql.org/docs/current/pgprewarm.html)
- [Initial Commit - Merkle trees in Git](https://initialcommit.com/blog/git-bitcoin-merkle-tree)
- [git-magic ch.8](http://www-cs-students.stanford.edu/~blynn/gitmagic/ch08.html)
- [Vercel CDN cache + SWR](https://vercel.com/docs/caching/cdn-cache)
- [Cloud CDN serving stale](https://docs.cloud.google.com/cdn/docs/serving-stale-content)
- [Railway CDN auth-leak post-mortem (penligent)](https://www.penligent.ai/hackinglabs/railway-cdn-caching-incident-how-an-edge-cache-misfire-exposed-authenticated-content/)
- [RFC 9111 - HTTP Caching](https://datatracker.ietf.org/doc/html/rfc9111)
- Direct inspection of `~/.claude/projects/C--Projects-Sipcode/4ccaaa38-4cc0-4be9-a858-687392245d2d.jsonl` (Claude Code 2.1.170)

---

## 13. Open questions deferred to v1.6.16+

- **Slice-aware warming for partial / truncated reads.** v1.6.15 skips warming for any read where `numLines < totalLines` or `startLine > 1`. Most user files are under Claude Code's 2000-line truncation threshold, so the lost coverage is small. v1.6.16 plan: store `{startLine, numLines}` on warm entries, expand the dedup decision rule to allow dedup when the incoming Read's effective window is a subset of the warmed window, AND extend the existing safety floor so partial-incoming Reads are dedup-eligible against window-matching cache entries (currently they always pass).
- **Per-source rewriter rows in `proxy --stats`.** v1.6.15 records every dedup hit (live cache or warmfill) under a single `dedup-read` row. v1.6.16 will split into `dedup-read (live)` and `dedup-read (warmfill)` rows by reading the cached entry's `source` field at dedup time. The total saved-tokens number is identical either way; this is a presentational improvement.
- **Cross-session warm-fill.** Today the warm-fill only reads the current session's transcript. If user opens session B in the same project after session A, B's cache starts empty even though A's transcript has reads of the same files. v2.2 (cross-session context hygiene, already on the v2 roadmap) is the natural home for this extension. Out of scope for v1.6.15.
- **Warm-fill across sub-agents.** Subagents have their own session_ids; their cache is isolated. If the launch-side dogfood shows this matters, address in v1.6.16.
- **Auto-prune over-stale warm entries.** Currently warm entries live until session ends. If memory pressure becomes an issue, add eviction policy in v1.6.16.

---

*Last updated: 2026-06-15. Maintained as the canonical reference for the dedup cache architecture.*
