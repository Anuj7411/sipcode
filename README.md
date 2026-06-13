<div align="center">

# Sipcode

**Sip your tokens — don't gulp them.** Keep Claude Code's context clean: fewer tokens spent, sharper answers, and the savings measured so you can trust them.

### [**Visit the site →**](https://anuj7411.github.io/sipcode/) · [npm](https://www.npmjs.com/package/sipcode) · [benchmark methodology](benchmark/METHODOLOGY.md) · [changelog](CHANGELOG.md)

[![npm version](https://img.shields.io/npm/v/sipcode.svg?color=5B4FCF&label=npm)](https://www.npmjs.com/package/sipcode)
[![License: MIT](https://img.shields.io/badge/License-MIT-0A0A0A.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-1104%20passing-5B4FCF)](#)
[![Benchmark](https://img.shields.io/badge/corpus%20median-62.6%25-5B4FCF)](benchmark/METHODOLOGY.md)

</div>

---

## Token savings (illustrative 30-min Claude Code session)

| Operation | How often | Without Sipcode | With Sipcode | Savings |
|---|---|---|---|---|
| `git status` | 10× | 8,000 | 1,500 | **−81%** |
| `git log` | 5× | 12,500 | 2,000 | **−84%** |
| `git diff` / `git show` | 4× | 16,000 | 6,000 | **−62%** |
| `grep -r` | 6× | 12,000 | 2,400 | **−80%** |
| `ls` / `find` | 8× | 12,000 | 3,200 | **−73%** |
| `cat` (large files) | 5× | 15,000 | 6,000 | **−60%** |
| `npm ls` | 2× | 10,000 | 1,600 | **−84%** |
| Grep tool | 4× | 10,000 | 2,000 | **−80%** |
| Glob tool | 3× | 4,500 | 1,500 | **−67%** |
| **Total** | | **~100,000** | **~26,200** | **~−74%** |

> ⚠️ **These are illustrative estimates** for a tool-heavy session, not a promise about yours — savings depend entirely on how many commands your session runs. **Two numbers you can trust instead:** the reproducible benchmark below (`npx sipcode benchmark` → 62.6% median on a locked corpus), and your *own* real number after using it (`sipcode proxy --stats`).

---

## What Sipcode is — in one picture

Sipcode is two things, and it matters which surface you're on:

| | **Claude Code** (terminal / VS Code / JetBrains) | **Claude Desktop** (the chat app) |
|---|---|---|
| **The valve** — actually reduces tokens by rewriting commands | ✅ **Yes** — this is where it works | ❌ No (chat has no shell commands to optimize) |
| **The meter** — audit, cost prediction, savings proof, score | ✅ via CLI **and** MCP tools | ✅ via MCP tools |

**Plain-English version:** if you use Claude Code in your terminal, install the **valve** and it quietly saves you tokens. If you only use the Claude **Desktop chat app**, you get the **meter** (analytics + cost tools) inside chat, and you can use it to turn on the valve for whenever you do use Claude Code.

### Why clean context matters — not just cost

A bloated, redundant context doesn't only cost more tokens — it makes the model *worse*. As stale junk piles up, Claude starts hedging, forgetting fixes you already made, and mixing up files. People call it **context rot**. Keeping context lean is both a measured token win **and** — per Anthropic's own published research — a quality win (leaner context ≈ **29% better outcomes**; well-maintained context ≈ **40% fewer agent errors**).

So "sip, don't gulp" cuts two ways: a *gulp* is a bloated context that's expensive *and* makes your agent sloppy; a *sip* is clean, measured context that's cheaper *and* sharper. Sipcode cleans context automatically (the **valve**), measures it (the **meter**), and warns you when it starts to rot (**drift**, below). The token savings are your proof the cleaning is real.

> We **cite** the reliability numbers above from published research — we don't claim them as Sipcode's own measurement. The part Sipcode measures and proves is the token/context reduction.

---

## Get started

### A) Claude Code — turn on the valve (saves tokens)

Copy-paste this **one block**. That's the whole setup:

```bash
npm install -g sipcode      # 1. install the toolkit
sipcode proxy --install     # 2. turn ON the optimizer (writes a Claude Code hook)
```

Then **restart Claude Code** and work exactly as you normally do. Done.

> 🔑 **Important:** step 1 alone does *nothing* to your tokens — it just puts the tool on your machine. The optimizer only turns on after step 2 (`sipcode proxy --install`). To turn it off at any time: `sipcode proxy --uninstall`.

**Don't have Node.js?** Install it once from [nodejs.org](https://nodejs.org) (the LTS button). That's the only prerequisite.

### B) Claude Desktop — add the meter (analytics in chat)

1. Install the toolkit: `npm install -g sipcode`
2. Open your Claude Desktop config file:

   | Your OS | File to open |
   |---|---|
   | **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |
   | **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
   | **Linux** | `~/.config/Claude/claude_desktop_config.json` |

3. Add the `sipcode` block inside `"mcpServers"` (if the file is empty, paste the whole thing):

   **Windows:**
   ```json
   {
     "mcpServers": {
       "sipcode": { "command": "cmd", "args": ["/c", "sipcode-mcp"] }
     }
   }
   ```
   **macOS / Linux:**
   ```json
   {
     "mcpServers": {
       "sipcode": { "command": "sipcode-mcp" }
     }
   }
   ```
   > 💡 Windows needs the `cmd /c` part because of how Windows runs the program. Copy the Windows block exactly.

4. **Fully quit and reopen Claude Desktop.** Then just ask Claude things like *"use sipcode to show my token stats"* or *"turn on the sipcode proxy"* — it will call the right tool.

---

## How it works

Claude Code asks to run a command. Before it runs, Sipcode's hook swaps it for a leaner equivalent that returns the same information in fewer tokens. Because that output sits in Claude's context for the rest of the conversation, the saving **compounds** on every later turn.

```
WITHOUT Sipcode                          WITH Sipcode (proxy installed)

Claude ── "git status" ──▶ shell         Claude ── "git status" ──▶ [Sipcode hook]
       ◀── ~800 tokens ────                                              │ rewrites to
           (full output)                                                 ▼ "git status -s"
                                                            shell ──▶ runs the short form
                                                 Claude ◀── ~150 tokens (same info, compact)
```

Every rewrite is **safe and reversible** — Claude can always re-run the full command with explicit flags. Sipcode never touches commands that are already compact, already limited, or chained with `&&`, `||`, `;`, or `|`.

---

## What it optimizes

**Git**
```
git status        →  git status -s              # short format
git log           →  git log --oneline -n 20    # 20 one-liners, not full history
git diff / show   →  … | head -200              # caps huge diffs
```
**Files & search**
```
ls, find          →  … | head -50 / -100        # caps long listings
grep -r           →  grep -c -r                 # per-file match counts
cat <file>        →  size-aware: full file if small, head+tail only if >300 lines
```
**Package & build tools**
```
npm ls / list     →  --depth=0                  # top-level deps only
cargo build/test  →  --quiet                    # drops "Compiling…" noise
```
**Claude Code's built-in tools** (an edge RTK doesn't have — these go through our hook too)
```
Grep tool         →  head_limit=50              # Claude Code's default is 250
Glob tool         →  head_limit=100             # caps path floods
```

> There is intentionally **no** `Read`-tool rewrite: Claude Code's `Read` already caps at 2000 lines, so adding a limit would save nothing. We don't book savings we don't deliver.

---

## Check that it's working

### Claude Code (the valve)

```bash
sipcode proxy --diff      # preview exactly what the install will change (writes nothing)
sipcode proxy --stats     # after using Claude Code for a bit: shows what it rewrote + tokens saved
```

Quick manual proof: with the proxy installed, run `git log` in any repo with more than 20 commits — you'll get exactly 20 one-line entries instead of the full history. That's the rewrite firing.

### Claude Desktop (the meter)

In a Claude Desktop chat, ask: **"What sipcode tools do you have?"** Claude will call `get_sipcode_info` and list them — if you see the version and tool list, the MCP server is wired up correctly. Then try **"use sipcode to check the proxy status."**

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| **Installed the proxy but tokens look the same** | Did you **restart Claude Code** after `sipcode proxy --install`? Hooks load at startup. Then run `sipcode proxy --stats` after some use to confirm rewrites are happening. |
| **`sipcode: command not found`** | The global install didn't land on your PATH. Re-run `npm install -g sipcode`; if it persists, reopen your terminal. No Node.js? Install it from [nodejs.org](https://nodejs.org). |
| **Claude Desktop says the sipcode server "is down" / won't start** | 99% of the time it's the config. On **Windows** you must use `"command": "cmd", "args": ["/c", "sipcode-mcp"]`. Confirm `npm install -g sipcode` succeeded, then **fully quit and reopen** Claude Desktop (not just close the window). |
| **A command's output got cut off and I needed the rest** | That's by design — re-run it with an explicit flag (e.g. `git diff <file>`, `grep -rn …`). If a rewrite ever hides something it shouldn't, that's a bug — please [file it](https://github.com/Anuj7411/sipcode/issues). |
| **Want to turn it all off** | `sipcode proxy --uninstall` (removes the hook, fully reversible). |

---

## The meter — see and prove your savings

Works in your terminal (CLI) and inside Claude Desktop (MCP tool, in parentheses):

```bash
sipcode why          # where your last session burned tokens   (audit_latest_session)
sipcode impact       # your spend before vs after Sipcode       (verify_sipcode_impact)
sipcode stats        # cross-session totals + top spenders      (get_session_stats)
sipcode estimate "…" # predict a task's cost per model          (estimate_task_cost)
sipcode score        # 24-check agent-friendliness audit        (get_agent_score)
sipcode proxy --stats# what the valve has rewritten             (get_proxy_stats)
```

The meter reads only the transcripts Claude Code already writes to `~/.claude/projects/`. **Zero network calls** — your code never leaves your machine ([Privacy](#privacy)).

---

## Catch context drift

`sipcode drift` watches whether your recent Claude Code sessions are quietly getting more expensive or context-bloated — and **stays silent unless something actually regressed.** A smoke alarm, not a dashboard you have to babysit.

```bash
sipcode drift          # e.g. ⚠ cost/turn up ~34%; cache hit rate 71% → 48%
sipcode drift --json   # machine-readable   (also the get_drift_report MCP tool)
```

It compares your latest session against the median of your recent ones — conservative thresholds, so no false alarms — and names what moved: **cost/turn up**, **cache-hit-rate down**, or **re-read waste up**. These cost tokens *and* degrade answer quality (context rot), so catching them early keeps your agent both cheap and sharp.

---

## The benchmark — the one number you can reproduce

```bash
npx sipcode benchmark
```

**62.6% median token reduction** across a locked 20-task corpus (range **37.4%–80.6%**). This is the optimization *methodology* measured on captured transcripts — **anyone can reproduce it** in under 90 seconds, no signup. It is **not** a promise about your sessions (use `sipcode impact` for that) and **not** a measurement of the live proxy. Full method: [`benchmark/METHODOLOGY.md`](benchmark/METHODOLOGY.md).

---

## MCP tools (13, for Claude Desktop & Claude Code)

**Meter (read-only):** `get_sipcode_info`, `verify_sipcode_impact`, `list_recent_sessions`, `audit_latest_session`, `get_project_manifest`, `estimate_task_cost`, `get_agent_score`, `get_session_stats`, `get_proxy_stats`, `get_proxy_status`, `get_drift_report`
**Valve control (writes settings.json):** `install_proxy`, `uninstall_proxy`

So a Desktop user never has to touch a terminal: ask Claude to *install the proxy*, *check savings*, *audit a project*, or *predict a cost* — all from chat. Full docs: [`docs/MCP.md`](docs/MCP.md).

---

## What Sipcode does NOT do

Stating this plainly because trust is the product:

- **It does not optimize the Claude Desktop chat itself** — the valve only rewrites Claude Code tool calls. Desktop gets the meter.
- **Installing the npm package alone changes nothing** — you must run `sipcode proxy --install` to turn on the valve.
- **The meter never reduces tokens** — auditing is observation; only the valve reduces.
- **No network calls** from any core path — enforced by a CI test. Your code never leaves your machine.
- **No guaranteed savings multiplier** — it's workload-dependent; measure your own.
- **It never silently loses data** — every rewrite is recoverable by re-running with explicit flags.

---

## Privacy

Local-first by engineering, not by promise. A CI test fails the build if `node:http`/`https`/`net`/`dns` is ever imported into a core path, and the proxy's rewriter functions are guarded to import no filesystem or network modules at all. Nothing is uploaded or phoned home.

---

## Command reference

| Command | What it does |
|---|---|
| `sipcode proxy --install / --uninstall / --diff / --stats` | The valve — runtime command optimizer |
| `sipcode why` | Where your last session burned tokens |
| `sipcode impact` | Before/after your own spend |
| `sipcode stats` | Cross-session analytics |
| `sipcode estimate "<task>"` | Per-model cost prediction |
| `sipcode score` | Agent-friendliness audit + badge |
| `sipcode drift` | Flag context/cost regressions vs your baseline (silent unless it regressed) |
| `sipcode benchmark` | Reproducible corpus (`--hardest`, `--vs-rtk`) |
| `sipcode receipt` | Shareable PNG of a session's savings |
| `sipcode hygiene` | Read-once rules + context-pressure hooks |
| `sipcode rules` | Output-compression rules in `CLAUDE.md` |
| `sipcode manifest` / `init` | Project manifest; multi-agent (`--agent cursor`) |

---

## Updating

```bash
npm install -g sipcode@latest
```

No auto-updater. Monthly is plenty unless a security note is pinned here or on [Releases](https://github.com/Anuj7411/sipcode/releases). The proxy hook points at your global install, so it picks up updates automatically — no need to re-run `proxy --install`.

## Contributing & author

Bugs, edge cases, or a rewrite that hides something it shouldn't → [open an issue](https://github.com/Anuj7411/sipcode/issues).
Built by **[Anuj Ojha](https://github.com/Anuj7411)** — solo dev, also author of [Answerable](https://github.com/Anuj7411/answerable). MIT licensed.
