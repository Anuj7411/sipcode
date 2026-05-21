# Sipcode — Session Continuation Packet

> **Use this file to bootstrap a new session with full context.**
> Paste the "Seed prompt" section at the bottom into your first message of the new session.
>
> Last updated: 2026-05-21 (end of the engineering-pipeline session)

---

## 📍 Where we are RIGHT NOW

**Sipcode v1.1.7 is live on npm.** All 12 v1.0 features shipped, plus the MCP server (v1.1), plus a 5-gate release pipeline that physically blocks bad publishes. The repo is public. The MCP server is wired into Anuj's Claude Desktop and verified working with all 4 tools registering.

**We are at "ready to launch" — the engineering work is done. The remaining task is marketing (launch posts, social, possibly community building).**

---

## ✅ What's done (the shipped reality)

### npm
- **Package:** `sipcode@1.1.7` at https://www.npmjs.com/package/sipcode
- **Publisher:** `anujojha18`
- **Latest tag:** `latest` points to 1.1.7
- **Tarball:** ~825 KB packed, ~2.6 MB unpacked, 762 files
- **Binaries shipped:** `sipcode` (CLI) and `sipcode-mcp` (MCP server)
- **Trusted Publishers:** configured at npm.org → auto-publish on tag push via OIDC

### GitHub
- **Repo:** https://github.com/Anuj7411/sipcode (PUBLIC)
- **Commits on main:** ~95+
- **Tags:** v0.1.0-alpha, v0.2.0-alpha, v1.0.0-rc.1, v1.0.0, v1.0.1, v1.0.3, v1.1.0, v1.1.1, v1.1.2, v1.1.3, v1.1.4, v1.1.5, v1.1.6, v1.1.7
- **Workflows:** `release.yml` (auto-publish), `score.yml` (Sipcode Score CI)

### The 12 locked v1.0 features (all shipped)

**Core (6):**
1. `sipcode why` — install-free Claude Code session auditor (S010)
2. `sipcode manifest` + `sipcode init` — Smart Project Manifest (S001)
3. `sipcode receipt` — HTML + 1200×630 PNG + clipboard + tweet intent (S014)
4. `sipcode rules` — Output Compression, three modes (S020/S021/S022)
5. `sipcode hygiene` — read-once rules + PreToolUse hook + smart `/compact` (S030/S031/S032)
6. `sipcode stats` — Analytics Dashboard, cross-session aggregate (S040)

**Curiosity-drivers (4):**
7. `sipcode estimate` — cost prediction across Opus/Sonnet/Haiku (S050)
8. `sipcode score` — 24-check agent-friendliness audit + GitHub Action (S060)
9. Hardest Tasks subset (BT011-BT020) — canonical waste-maximizing corpus (S080)
10. Privacy / zero-telemetry — engineered + test-asserted (S090)

**Marketing wins (2):**
11. "5× your Pro plan" framing — README copy (S100)
12. Reproducible benchmark suite — 20-task locked corpus, 62.6% median savings (S110)

**Bonus shipped (was v1.1 roadmap):**
- S043 Multi-agent: Cursor adapter
- v1.1: **MCP server** (`sipcode-mcp`) with 4 tools — runs inside Claude Desktop

### The MCP server (v1.1)
- Binary: `sipcode-mcp`
- 4 tools registered: `list_recent_sessions`, `audit_latest_session`, `get_project_manifest`, `estimate_task_cost`
- Works in Claude Desktop, Claude Code CLI, Cursor, any MCP-aware client
- Stdio transport, JSON-RPC, MCP SDK v1.29
- Privacy contract preserved (no network calls; reads local files only)

### The engineering pipeline (v1.1.6–v1.1.7)
After 5 production bugs in a day, we built a permanent fix. **5 CI gates** now block bad publishes:
1. Unit tests (802 tests)
2. Build (tsc + copy-assets for fonts/pricing)
3. **E2E release smoke** (12 tests — actual `npm pack` + install + binary boot + MCP handshake)
4. OIDC publish
5. Post-publish CDN verify (retries 6× over 60s)

Canonical docs:
- `docs/TESTING.md` — every test category, bug postmortems, regression-guard pattern
- `docs/ENGINEERING-PIPELINE.md` — the 5 gates
- `tests/e2e/release-smoke.test.ts` — the gate code itself

---

## 🔓 What's NOT done yet (the open threads)

| Item | Status | What's blocking |
|---|---|---|
| **Launch posts (Twitter / HN / Reddit r/ClaudeAI)** | Not drafted yet | Anuj kept deferring this to get engineering right first. Pending his "draft the launch posts" go-ahead. |
| Repo go-public announcement | Repo IS public, no announcement made | Same as above |
| Domain `sipcode.dev` | Not purchased | Decision: defer until ≥1k stars (zero need before marketing push) |
| Trademark verification (`Sipcode`) | Pending | Recommended quick USPTO + EUIPO TESS search before public launch |
| v2.0 roadmap | Documented, not started | After v1.0 launch + adoption signal |
| Browser extension for claude.ai web chat | v2.0 roadmap | Planned — would extend `audit_latest_session` to server-side conversations |

---

## 🎯 Anuj's stated next move (the one pending decision)

In the closing turns of the last session, the pending offer was:

> **"Whenever you're ready, say 'draft the launch posts'"**

The launch posts should anchor on:
- **The 0.6% wedge stat** (independent dev.to study — only 0.6% of Claude Code tokens are code output)
- **The 62.6% measured savings** (from `sipcode benchmark` on the locked 20-task corpus — reproducible)
- **The 5.5× Cursor stat** (Sitepoint benchmark — Cursor uses 5.5× more tokens than Claude Code)
- **The `npm install -g sipcode` one-liner**
- **The MCP differentiator** ("the first token-optimization tool that lives inside Anthropic's chat experience itself")
- **A screenshot** of the v1.0.3 chat showing Claude using Sipcode tools to audit a 70-hour, $1,210 session

The "wow" screenshot Anuj already has is at:
```
.sipcode/receipts/<id>/receipt.png
```
Plus the chat screenshot where Claude listed the 4 sipcode MCP tools.

---

## ⚠️ The 6 historical bugs and their permanent guards (don't repeat these)

Every bug below ALSO has a regression-guard test in `tests/e2e/release-smoke.test.ts`. The bugs CANNOT recur.

| Bug | Symptom | Permanent guard |
|---|---|---|
| v1.0.0 missing pricing JSON | `sipcode why` crashed | Smoke test: tarball includes `dist/lib/pricing/*.json` |
| v1.0.0 missing fonts | `sipcode receipt` PNG crash | Smoke test: tarball includes `dist/modules/receipt/assets/fonts/*.ttf` |
| v1.0.0–v1.1.4 hardcoded `SERVER_VERSION = "1.1.0"` | MCP lied about version | Smoke test: `[sipcode-mcp] connected (sipcode v<actual>, 4 tools)` |
| v1.1.0 `recommend.ts` not synced with `PREDICTION_MODELS` | Every estimate = Sonnet | Unit tests: model selection truth table |
| v1.1.3–v1.1.4 `sipcode-mcp@latest` 404 | Claude Desktop "Server disconnected" | Smoke test: real MCP handshake before publish |
| v1.1.0 publish: npm 10.x bypass OIDC | Publish step 404 | Workflow: `corepack prepare npm@latest --activate` before publish |
| v1.1.2 CI false-positive (CDN lag) | Workflow showed FAILURE despite successful publish | Workflow: retry 6× over 60s |

---

## 🔧 Critical gotchas (institutional knowledge — don't lose these)

### Windows MCP config NEEDS `cmd /c` wrapper

```json
"sipcode": {
  "command": "cmd",
  "args": ["/c", "sipcode-mcp"]
}
```

Without `cmd /c`, Claude Desktop registers the server but fails to launch it. macOS/Linux can use `"command": "sipcode-mcp"` directly.

### `sipcode-mcp` is a BINARY, not a package on npm

Never write `"args": ["-y", "sipcode-mcp@latest"]` — npm returns 404 (no such package). Correct patterns:
- **With global install:** `"args": ["/c", "sipcode-mcp"]`
- **Without global install:** `"args": ["/c", "npx", "-y", "-p", "sipcode", "sipcode-mcp"]` (`-p` means "install this PACKAGE, run this BINARY")

### Trusted Publishers / OIDC requires npm CLI ≥11.5.1

Node 22 ships npm 10.x by default. Workflow uses `corepack prepare npm@latest --activate` to upgrade. **Never** revert that step or OIDC publish silently 404s.

### First publish on a brand-new npm name needs manual `npm publish`

Trusted Publishers can only be configured on packages that already have at least one version. The first publish must be `npm login` + `npm publish` from terminal. This was done for `sipcode@1.0.0` and `sipcode@1.0.1`. All subsequent versions auto-publish via OIDC.

### npm CDN propagation = 15–45 seconds

Don't trust an immediate `npm view` after a publish. The workflow retries 6 times over 60 seconds.

### Privacy contract is engineered, not promised

`tests/privacy/no-network.test.ts` blocks any commit that adds `node:http`, `node:https`, `node:net`, `node:dgram`, `node:tls`, or `node:dns` imports to any file in `src/` except the explicitly allowlisted `lib/fs.ts` seam (which currently has none anyway). Plus the e2e smoke test does the same check against compiled `dist/`. Don't add network calls to core paths.

---

## 🗺️ File map (where things live)

### The repo (`C:\Projects\Sipcode\`)
```
.github/
  workflows/
    release.yml       # auto-publish on tag, with 5-gate pipeline
    score.yml         # dogfoods Sipcode Score on the repo itself
.sipcode/             # gitignored runtime artifacts (manifest, receipts, badge)
benchmark/
  corpus/             # BT001-BT020 — 20-task locked corpus
  METHODOLOGY.md      # published benchmark methodology
docs/
  PROJECT-SPEC.md     # what Sipcode is (locked planning doc)
  ROADMAP.md          # phased shipping plan (locked)
  AUDIT-FRAMEWORK.md  # stable IDs S###/M###/E###/R### (locked early; later IDs documented in code)
  TESTING.md          # ★ THE test catalog + bug postmortems
  ENGINEERING-PIPELINE.md  # ★ THE 5 gates
  MCP.md              # MCP setup guide
  CONTINUATION.md     # ★ THIS FILE
src/
  cli.ts              # entry point for `sipcode` CLI
  mcp/server.ts       # entry point for `sipcode-mcp` MCP server
  commands/           # one file per CLI subcommand
  modules/            # pure-runner business logic per feature
  lib/                # I/O seams (fs, clock, git, clipboard, process)
  index.ts            # programmatic API (for library consumers)
tests/
  e2e/                # release-smoke.test.ts (THE gate)
  privacy/            # no-network.test.ts (privacy guard)
  modules/            # unit tests per module
  integration/        # multi-module end-to-end tests
scripts/
  copy-assets.mjs     # part of build — copies fonts + pricing to dist/
PRIVACY.md            # canonical privacy contract
README.md             # public-facing front door
SIPCODE-MASTER-RECORD.md  # the single source of truth for all project decisions
package.json
package-lock.json
```

### Anuj's machine state
- Global npm install: `sipcode` is installed globally
- Claude Desktop config: `%APPDATA%\Claude\claude_desktop_config.json` has `mcpServers.sipcode` with `"command": "cmd", "args": ["/c", "sipcode-mcp"]`
- Backup of old config: `%APPDATA%\Claude\claude_desktop_config.backup-pre-sipcode.json`
- Claude Code projects: `C:\Users\ojhaa\.claude\projects\<hash>\*.jsonl` — what Sipcode audits

### Memory files (cross-session context)
```
C:\Users\ojhaa\.claude\projects\C--Projects-Sipcode\memory\
  MEMORY.md                          # index
  user_anuj.md                       # who Anuj is
  project_sipcode.md                 # what Sipcode is + current state
  project_sipcode_architecture.md    # architecture + module breakdown
  reference_prior_session.md         # pointer to first brainstorm transcript
```

---

## 👤 Anuj — the human context

- **GitHub:** [@Anuj7411](https://github.com/Anuj7411)
- **npm:** `anujojha18`
- **Prior shipped project:** [Answerable](https://github.com/Anuj7411/answerable) — SEO optimization CLI for Next.js (set the engineering quality bar Sipcode inherits)
- **Persona:** Indie developer. Budget-conscious. Burns through Claude Code Max plan in 2 hours — Sipcode is personally meaningful, not abstract.
- **Communication style:** Direct, types quickly with typos, no patience for fluff. Asks the right strategic questions ("does this affect Claude Code output?", "do users need to update manually?"). Wants honest pushback over flattery.
- **Quality bar:** professional engineering rigor — pure runners, I/O seams, branded types, batched errors, stable IDs as public API.
- **Decision-making:** decisive once shown options. Often picks the "Recommended" option in `AskUserQuestion`. Trusts evidence-based arguments over confidence theater.
- **Working preference:** strategic planning in Claude chat → execution in Claude Code → handoff docs in between. The brainstorm → spec → handoff loop is the Answerable workflow he's proven for himself.

---

## 🧭 Where the last session ended

The previous session arc was:
1. **Built the engineering pipeline** (after the v1.0.0–v1.1.5 bug streak that frustrated Anuj)
2. **Shipped v1.1.6** introducing the e2e release-smoke gate + `docs/ENGINEERING-PIPELINE.md`
3. **Shipped v1.1.7** with `docs/TESTING.md` — the canonical test catalog Anuj requested
4. Both shipped successfully through the new 5-gate pipeline (first releases to do so)
5. The conversation ended with the offer "**Whenever you're ready, say 'draft the launch posts'**"

**Next message in the new session should pick up there.** Anuj is one go-ahead away from kicking off the public launch.

---

## 🚀 To resume cleanly in a new session

### Option A — Paste this seed prompt as the first message

```
Continuing the Sipcode session. Full context in:
- docs/CONTINUATION.md (the handoff)
- docs/TESTING.md (engineering pipeline)
- SIPCODE-MASTER-RECORD.md (single source of truth)

Current state: sipcode@1.1.7 live on npm, repo public at github.com/Anuj7411/sipcode,
all 12 v1.0 features + MCP server shipped, 5-gate release pipeline live (last session
fixed the "ship 5 patches in a day" problem).

Where we left off: pending action is "draft the launch posts" — Twitter thread,
HN Show post, Reddit r/ClaudeAI post. Anchored on: 0.6% wedge stat, 62.6% measured
savings, 5.5× Cursor stat, npm install -g sipcode one-liner, the MCP-in-Claude-Desktop
differentiator, the receipt screenshot.

Please read docs/CONTINUATION.md to absorb the context, then I'll tell you what we
do next.
```

### Option B — Just say "continue from CONTINUATION.md"

The auto-memory files have been updated to reflect the current state. A new session will load them automatically. You can then say "read docs/CONTINUATION.md and let's pick up where we left off" and the new Claude will catch up cleanly.

---

## 📋 Checklist for the next session

- [ ] Confirm v1.1.7 is still latest on npm (`npm view sipcode version`)
- [ ] Confirm CI is still green (`gh run list --workflow=release.yml --limit 1`)
- [ ] Confirm Anuj's MCP integration still works (one of the `mcp__sipcode__*` tools)
- [ ] Then: ask Anuj "draft the launch posts now, or is there something else to fix first?"
- [ ] If launch: draft 3 platform-specific posts, get his approval, then he posts manually

---

## 💡 Wisdom we collected (for the new Claude to inherit)

1. **Test in production = ship 5 patches in a day.** Don't trust `npm test`; trust the e2e gate.
2. **Honest numbers beat inflated numbers.** Anuj rejected "65–90% savings" framing in favor of "measured 62.6% via reproducible benchmark." That credibility is part of the brand.
3. **Privacy is engineered, not promised.** The privacy guard test is the contract.
4. **The wedge is `sipcode why` — install-free demo.** It's the conversion funnel. Everything else is downstream.
5. **The MCP server is the differentiator nobody else has.** It's not in any competitor's repo.
6. **Anuj wants to be told when he's wrong.** The `cmd /c` debug, the @latest config bug, the inflated estimate — all caught by him pushing back. Reward that, don't placate.
7. **The launch is one tag away.** Don't add scope. Anuj has done the hard part.

---

*End of continuation packet. Whoever picks up next — read this top-to-bottom, then you have full state.*
