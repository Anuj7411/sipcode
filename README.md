<div align="center">

# Sipcode

**A token-economy toolkit for Claude Code — it *measures* what your sessions spend, and *reduces* it at runtime.**

[![npm version](https://img.shields.io/npm/v/sipcode.svg?color=5B4FCF&label=npm)](https://www.npmjs.com/package/sipcode)
[![License: MIT](https://img.shields.io/badge/License-MIT-0A0A0A.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-972%20passing-5B4FCF)](#)
[![Benchmark](https://img.shields.io/badge/corpus%20median-62.6%25-5B4FCF)](benchmark/METHODOLOGY.md)

</div>

---

## What Sipcode is (and what it isn't)

Sipcode has two halves. Be clear about which one you're using:

- **The meter** — read-only tools that *observe* your token usage: per-session forensic audit, before/after impact verification, cross-session stats, cost prediction, an agent-friendliness score. The meter never changes how Claude Code behaves; it just shows you where the tokens went. Installing the meter does **not** lower your bill, the same way an electricity meter doesn't lower your power bill.

- **The valve** — `sipcode proxy`, added in v1.5. A Claude Code **PreToolUse hook** that rewrites tool *inputs* at runtime so tools emit naturally-compact output (`git status` → `git status -s`, `git log` → `git log --oneline -n 20`, `git diff` → capped to 200 lines, recursive `grep` → `-c`). This genuinely *reduces* the tokens that re-enter your context on every turn.

The valve is the part that saves tokens. The meter is the part that proves it.

> **Honesty note.** This README distinguishes **verified**, **reproducible**, and **estimated** claims throughout. Nothing here is a round number we made up.

---

## The valve: `sipcode proxy`

```bash
npm install -g sipcode
sipcode proxy --install      # registers the PreToolUse hook in ~/.claude/settings.json
# restart Claude Code, then work normally
sipcode proxy --stats        # see what it rewrote and the estimated tokens saved
sipcode proxy --uninstall    # fully reversible
```

### How it works (verified)

Claude Code fires a `PreToolUse` hook before running any tool. Sipcode's hook inspects the command and, when it recognizes a verbose one, returns `hookSpecificOutput.updatedInput` with a tighter equivalent. Claude Code runs the rewritten command, so the tool result that lands in your context is smaller — and because tool results are re-sent on every subsequent turn until compaction, the saving **compounds**.

This mechanic is **verified end-to-end**: with the proxy installed, `git log` in a 139-commit repo returns exactly 20 lines instead of the full history, and the hook records the rewrite. Claude Code honors `updatedInput` — no restart-and-pray.

### What it rewrites today

| Tool / command | Rewrite | Effect |
|---|---|---|
| `git status` | `git status -s` | short format |
| `git log` | `git log --oneline -n 20` | 20 one-liners, not full history |
| `git diff` / `git show` | `… \| head -200` | caps huge diffs |
| `npm ls` / `npm list` | `--depth=0` | top-level only |
| `cargo build/check/test` | `--quiet` | drops "Compiling…" noise |
| `ls`, `find` | `… \| head -50/100` | caps long listings |
| `grep -r` | `grep -c -r` | per-file match counts |
| `cat <file>` | size-aware `awk` | full file if small; head+tail elision only if >300 lines |
| `Grep` tool | `head_limit=50` | Claude Code's Grep defaults to 250 |
| `Glob` tool | `head_limit=100` | caps path floods |

Every rewrite is **recoverable** — the agent can always re-run with explicit flags to get the full output. Rewrites skip commands that are already compact, already length-limited, or chained with `&&`/`||`/`;`/`|` (so the proxy never mangles a compound command).

> **Note:** there is intentionally **no** `Read`-tool rewrite. Claude Code's `Read` already defaults to a 2000-line cap, so injecting a limit would be a no-op — we don't book a saving we don't deliver.

### How much does it actually save?

**Honest answer: it depends on your workload, and you should measure your own.**

- On **tool-heavy** sessions (lots of git/grep/ls/diff/cat), tool output is a large share of context growth, so the proxy can meaningfully extend how long you work before hitting usage limits.
- On **reasoning- or codegen-heavy** sessions, tool output is a smaller share, so the saving is smaller.

We deliberately **do not** claim a fixed "get N× more sessions" multiplier — that number is entirely workload-dependent, and printing a fake one would be exactly the kind of thing this tool exists to catch. Instead, measure it on *your* sessions:

```bash
sipcode proxy --stats     # tokens the proxy rewrote away (heuristic per-rewrite estimate)
sipcode impact            # before/after on your real Claude Code sessions, around your install date
```

---

## The meter: see where your tokens go

```bash
npx sipcode why          # where your last session burned tokens
npx sipcode impact       # A/B your spend before vs after installing Sipcode — on your own data
npx sipcode stats        # cross-session totals, sparkline, top-N expensive sessions
npx sipcode estimate "<task>"   # predict a task's cost per model before you run it
npx sipcode score        # 24-check static audit of your codebase's agent-friendliness
```

The meter reads only the transcripts Claude Code already writes to `~/.claude/projects/`. It makes **zero** network calls and never sends your code anywhere (see [Privacy](#privacy)).

---

## The benchmark: the one reproducible number

```bash
npx sipcode benchmark
```

**62.6% median token reduction** across Sipcode's locked 20-task corpus (range **37.4%–80.6%**, corpus v1.0.0).

What this number *is*: a static re-analysis of 20 captured task transcripts, comparing a baseline run against one optimized with Sipcode's compression methodology (read-once caching, output compression, smart manifest). It is **reproducible by anyone** — `git clone && npx sipcode benchmark` reproduces it on your machine in under 90 seconds, no signup, no network beyond fetching the corpus.

What this number is **not**: it is **not** a measurement of the runtime proxy, and it is **not** a promise about your specific sessions. It measures the methodology on a fixed corpus. Your mileage varies — which is why `sipcode impact` exists to measure *your* actual sessions.

Full methodology, including how to challenge a number: [`benchmark/METHODOLOGY.md`](benchmark/METHODOLOGY.md). There's also a harder subset: `sipcode benchmark --hardest`.

You can also preview what the proxy *would* rewrite over the corpus's recorded tool calls (heuristic, not live re-execution):

```bash
sipcode benchmark --vs-rtk
```

---

## MCP server — Sipcode inside Claude Desktop & Claude Code

Sipcode ships an MCP server (`sipcode-mcp`) exposing **12 tools** your agent can call live in a conversation. It's both a meter *and* a valve controller — an agent can install the proxy, check its status, audit a project, or predict a cost mid-chat.

**Meter tools:** `get_sipcode_info`, `verify_sipcode_impact`, `list_recent_sessions`, `audit_latest_session`, `get_project_manifest`, `estimate_task_cost`, `get_agent_score`, `get_session_stats`, `get_proxy_stats`, `get_proxy_status`.
**Valve control:** `install_proxy`, `uninstall_proxy`.

### Setup (Claude Desktop)

1. Install Sipcode globally: `npm install -g sipcode`
2. Open your Claude Desktop config:

   | OS | Path |
   |---|---|
   | Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
   | macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
   | Linux | `~/.config/Claude/claude_desktop_config.json` |

3. Add the `sipcode` entry inside `mcpServers`:

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
   > Windows needs the `cmd /c` wrapper because `npm i -g` registers `sipcode-mcp` as a `.cmd` shim, which Claude Desktop's launcher can't invoke directly. On macOS/Linux it's a real executable.

4. Fully quit and reopen Claude Desktop.

In **Claude Code**, add the same server to `.mcp.json` in your project (or `~/.claude.json` globally).

Full tool docs: [`docs/MCP.md`](docs/MCP.md).

---

## Installation

| | Command | When |
|---|---|---|
| **Try once** | `npx sipcode <cmd>` | no install; npx fetches latest each run |
| **Install** | `npm install -g sipcode` | instant startup; update with `npm install -g sipcode@latest` |

Same package, same command, every OS. There's no auto-updater — update explicitly (~monthly is plenty unless a security advisory is pinned here or on [Releases](https://github.com/Anuj7411/sipcode/releases)).

---

## What Sipcode does NOT do

Stating this plainly because trust is the product:

- **It does not read its own usage from inside a chat.** Neither Sipcode nor any tool can read the live token meter of the conversation it's running in. The meter reads Claude Code's *transcript files on disk* after the fact — not the current turn.
- **The meter does not reduce consumption.** Only the valve (`sipcode proxy`) does. Auditing is observation.
- **It makes no network calls** from any core path — enforced by a test that fails CI if a network module is imported. Your code never leaves your machine.
- **It does not guarantee a savings multiplier.** Savings are workload-dependent; measure your own.
- **The proxy never silently loses data** — every rewrite is recoverable by re-running with explicit flags.

---

## Privacy

Local-first by engineering, not by promise. A static guard test fails CI if `node:http`/`https`/`net`/`dns` is ever imported into a core path. The proxy's rewriter functions are additionally guarded to import no filesystem or network modules at all. Nothing is uploaded, logged remotely, or phoned home.

| Action | Effect on Claude Code |
|---|---|
| `sipcode why / stats / receipt / score / estimate / benchmark / impact` | 🟢 read-only on local transcripts; behavior unchanged |
| `sipcode manifest` (no `--inject`) | 🟢 writes only `.sipcode/manifest.md` |
| `sipcode init / rules --install / hygiene --install / proxy --install` | 🟡 explicit, clearly-marked edits to `CLAUDE.md` and/or `~/.claude/settings.json`; reversible with `--uninstall` |
| `sipcode-mcp` | 🟡 dormant until a tool is invoked; the two `*_proxy` write-tools edit `settings.json`, all others are read-only |

---

## Commands

| Command | What it does |
|---|---|
| `sipcode why` | Where your last session burned tokens |
| `sipcode proxy` | **The valve** — install/uninstall/diff/stats the runtime input-rewriting hook |
| `sipcode impact` | A/B your spend before vs after Sipcode, on your own sessions |
| `sipcode stats` | Cross-session analytics + optional standalone HTML |
| `sipcode estimate "<task>"` | Per-model cost prediction before you run a task |
| `sipcode score` | 24-check agent-friendliness audit + tier badge |
| `sipcode benchmark` | Reproducible 20-task corpus; `--hardest`, `--vs-rtk` |
| `sipcode receipt` | Shareable PNG receipt of a session's savings |
| `sipcode hygiene` | Read-once rules + context-pressure hooks |
| `sipcode rules` | Output-compression rules installed in `CLAUDE.md` |
| `sipcode manifest` / `init` | Project manifest; multi-agent setup (`--agent cursor`) |

---

## Contributing

Bug reports, feature requests, weird edge cases → [open an issue](https://github.com/Anuj7411/sipcode/issues). If the proxy ever mangles a command or hides something it shouldn't, that's a bug — file it with the command and we'll add a guard.

## Author

**[Anuj Ojha](https://github.com/Anuj7411)** — solo dev. Also author of [Answerable](https://github.com/Anuj7411/answerable), the SEO optimization CLI for Next.js.

## License

MIT — see [LICENSE](LICENSE).
