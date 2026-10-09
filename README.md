<p align="center">
  <a href="https://anuj7411.github.io/sipcode/" aria-label="Sipcode">
    <img src="https://raw.githubusercontent.com/Anuj7411/sipcode/main/docs/brand/icon/icon-color.png" alt="Sipcode" width="120" />
  </a>
</p>

<h1 align="center">Sipcode</h1>

<p align="center">
  <strong>Keep Claude Code's context clean for sharper answers and lower cost, automatically.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/sipcode"><img src="https://img.shields.io/npm/v/sipcode?color=5B4FCF&label=npm" alt="npm" /></a>
  <a href="https://github.com/Anuj7411/sipcode/stargazers"><img src="https://img.shields.io/github/stars/Anuj7411/sipcode?color=5B4FCF&label=stars" alt="GitHub stars" /></a>
  <a href="https://www.npmjs.com/package/sipcode"><img src="https://img.shields.io/npm/dm/sipcode?color=5B4FCF&label=downloads" alt="npm downloads per month" /></a>
  <a href="https://github.com/Anuj7411/sipcode/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-5B4FCF" alt="MIT licensed" /></a>
  <img src="https://img.shields.io/badge/tests-2%2C015%20passing-28C840" alt="2015 tests passing" />
  <img src="https://img.shields.io/badge/network%20calls-0-2D3142" alt="zero network calls" />
</p>

<p align="center">
  <a href="https://anuj7411.github.io/sipcode/">Website</a> · <a href="https://anuj7411.github.io/sipcode/compare/">Compare</a> · <a href="https://github.com/Anuj7411/sipcode/releases">Releases</a>
</p>

---

## Install in 30 seconds

```bash
npm i -g sipcode
sipcode init
```

That is it. Your next Claude Code session will use Sipcode automatically. Verify a few minutes later:

```bash
sipcode drift
```

If the output reads `no drift, context health stable`, Sipcode is doing its job.

> **Already installed? Keep it fresh.** Sipcode makes zero network calls, so it can't pop an "update available" notice. Build a weekly habit: run `sipcode update` (or `npm i -g sipcode@latest`) to pull the latest fixes. Full details in [Updating Sipcode](#updating-sipcode).

---

## What is Sipcode?

Sipcode is a free command-line tool that sits between you and Claude Code. It does three things:

1. It watches Claude Code's context window and warns you when it starts to bloat (we call this "context rot")
2. It catches duplicate file reads and other waste before they reach Claude, so you pay less for the same answers
3. It gives you receipts. Every saving is measurable in your terminal.

It is open source under the MIT license. It makes zero network calls during normal use. Your data never leaves your laptop.

---

## How Sipcode compares

| | Sipcode | Tool A | Tool B | Tool C |
|---|---|---|---|---|
| **Approach** | Live PreToolUse hook | Cross-session memory store | Static methodology | RAG retrieval server |
| **Caps verbose tool output** | ✓ | ✗ | docs only | ✗ |
| **Dedups same-session re-reads** | ✓ | ✗ | docs only | ✗ |
| **Mid-session install support** | ✓ Verified Warm-Fill | n/a | n/a | n/a |
| **Zero false-dedup by construction** | ✓ | n/a | n/a | n/a |
| **Reproducible benchmark on locked corpus** | ✓ 62.6% median (20 synthetic tasks) | ✗ | ✗ | ✗ |
| **Self-introspection MCP tools** | ✓ 15 tools | ✗ | ✗ | partial |
| **Agents covered** | Claude Code (all features); OpenAI Codex (spend analytics only, no hook) | not compared | not compared | not compared |
| **Zero network calls in normal use** | ✓ | ✓ | n/a | ✗ |
| **MIT licensed** | ✓ | ✓ | ✓ | ✓ |

Sipcode is **complementary to memory tools** that persist context across sessions (Tool A in the table). Sipcode keeps each individual session clean. They solve different problems. Run both for maximum effect.

Full feature-by-feature comparison with tool names revealed: [anuj7411.github.io/sipcode/compare](https://anuj7411.github.io/sipcode/compare/)

---

## Why you probably want it

If you use Claude Code for real work, you have already felt this:

- Long sessions get expensive fast. A two-hour session on Claude Max can burn through your daily plan
- Quality drops as the context window fills. Claude starts re-reading files, repeating itself, losing the thread of what you asked
- You cannot tell what is bloat and what is signal

Sipcode measures the bloat, then removes the parts Claude does not need. Run `sipcode benchmark` on any machine and you will see the same 62.6% median reduction on the locked 20-task corpus. That corpus is synthetic: scripted pairs of Claude Code transcripts (without and with Sipcode), not recordings of live sessions. It shows what Sipcode's mechanisms remove from a modeled session. Your own number depends on your workload, and `sipcode impact` measures it on your real sessions.

---

## The two-minute tour

After installing, here are the five commands that show you what Sipcode is doing.

### 1. `sipcode drift`

Tells you if your current Claude Code session is drifting from your normal usage pattern. Bloated context, repeated reads, stale signals are all flagged here.

```
✓ Sipcode drift: no drift, context health stable vs your recent baseline.
```

By default it checks your most recent session, across Claude Code and Codex. `--session <id>` checks a specific one, `--here` limits it to sessions from the folder you are in, and `--agent claude-code` or `--agent codex` picks the tool.

### 2. `sipcode proxy --stats`

Shows what Sipcode caught in the current session, broken down by rewriter.

```
Sipcode proxy, rewrite stats
  total rewrites:    144
  est. tokens saved: ~288,685 (heuristic)
  signal kept:       67% (med), weighted across all rewrites
```

### 3. `sipcode benchmark`

Runs the locked 20-task corpus and produces a reproducible savings number. Anyone, anywhere can run this and get 62.6%. The transcripts are scripted, not recorded from live sessions, so read it as a model of Sipcode's mechanisms rather than a measured bill (see [METHODOLOGY](benchmark/METHODOLOGY.md)).

```
62.6%  median savings on a locked 20-task corpus
       range 37.4% to 80.6%   3,567,170 tokens   $22.48
```

### 4. `sipcode today`

Daily spend summary. Tokens used, sessions, output ratio, comparison to your 30-day median.

```
spend so far    $1.20    across 4 sessions
tokens so far   943.8K   output ratio 3.7%
```

### 5. `sipcode forecast`

Month-end projection based on your last 14 days.

```
projected month-end   $17,674   (range $14,139 to $21,208)
```

---

## Codex

Sipcode also reads OpenAI Codex CLI session logs (`~/.codex/sessions` and `~/.codex/archived_sessions`, or the folder `CODEX_HOME` points to). For Codex this is spend analytics only: Sipcode reports what your Codex sessions used and where the tokens went. It does not change what Codex does.

**Commands that read Codex:** `stats`, `today`, `forecast`, `trend`, `impact`, `why`, `receipt` and `drift`, plus the session tools in the MCP server (they take an optional `agent` input: `"claude-code"` or `"codex"`).

- `--agent codex` shows Codex only. `--agent claude-code` shows Claude Code only.
- With no `--agent` flag and both tools installed, `stats`, `today`, `forecast`, `trend` and `impact` print one section per tool. `stats`, `today` and `forecast` end with one combined line, in this shape:

  ```
  Both tools: <total tokens> tokens · ~$<Claude Code> + ~$<Codex>
  ```

- `why`, `receipt` and `drift` report on the most recent session across both tools. When the other tool has a recent session too, a one-line hint names it and the flag that shows it.
- `--here` works for Codex too: it matches the working folder Codex recorded for each session.
- `--json` covers one tool per call. Without `--agent` it covers Claude Code and prints a note on stderr when Codex logs exist too. Add `--agent codex` for Codex JSON.
- With no `--agent` flag on a machine with Cursor and Codex, Sipcode shows Codex (it does not read Cursor's session logs).

**How Codex tokens are counted.** Sipcode reads Codex's per-request usage records, or, in logs from older Codex versions, the change in the running total Codex logs after each request. Cached input is part of Codex's input count, so Sipcode never bills cached tokens twice. A request copied into a resumed or forked session file is counted once. On the maintainer's machine, Sipcode's per-file totals equal Codex's own final `total_token_usage` on all 15 real session logs, and an independent counter that shares no code with Sipcode ([`scripts/verify-counts.mjs`](scripts/verify-counts.mjs)) cross-checks every period command against the same logs.

**Prices.** Codex models are priced from OpenAI's API price table ([developers.openai.com/api/docs/pricing](https://developers.openai.com/api/docs/pricing), and each Codex model's page under developers.openai.com/api/docs/models, as of 2026-10-09), including the long-context rate for prompts over 272,000 input tokens. A model with no known price is shown as unpriced: its tokens are still counted, a line under the cost says how many were left out of it, and it is never shown as $0.

**Not supported for Codex yet:** writing rules to `AGENTS.md` (`rules`, and the rules step of `init`), registering the MCP server in Codex, the proxy and hooks (`proxy`, `hygiene`), `estimate` and `benchmark`. `rules --agent codex` and `estimate --agent codex` stop with error E009 instead of showing Claude Code data. Compressed Codex logs (`.jsonl.zst`) are skipped, and a note says how many.

---

## How to install (more detail)

Sipcode works on Mac, Linux, and Windows. You need Node.js 20 or newer.

### Step 1. Install Node.js

Skip this step if you already have Node.js. Otherwise:

- **Mac:** `brew install node`
- **Linux:** open [nodejs.org/en/download](https://nodejs.org/en/download), choose the LTS version, Linux and nvm, and run the commands shown there. (The `nodejs` package in Ubuntu's and Debian's own repositories is often older than Node 20.)
- **Windows:** Download from [nodejs.org](https://nodejs.org/)

Verify it worked:

```bash
node --version
```

You should see `v20.0.0` or higher.

### Step 2. Install Sipcode globally

```bash
npm i -g sipcode
```

This downloads Sipcode from npm and makes the `sipcode` command available everywhere.

If you see permission errors on Mac or Linux, try:

```bash
sudo npm i -g sipcode
```

Verify it installed:

```bash
sipcode --version
```

You should see `1.7.0` or higher.

### Step 3. Run `sipcode init` to wire it into Claude Code

```bash
sipcode init
```

This command does four things:

1. Creates a small `.sipcode/manifest.md` file in your current project so Claude knows what your project is about
2. Adds a small block to your `CLAUDE.md` (or creates one) with rules that keep Claude's replies terse
3. Installs the Sipcode hook into Claude Code, which is the thing that actually saves tokens
4. Marks the date so `sipcode impact` can show you before-and-after savings later

You will see a checklist as it runs. Each step shows a checkmark when it completes.

**The two questions it asks** (and what to pick):

**1. Manifest budget.** How lean to keep the project summary Sipcode injects.
- **tighten** (recommended): auto-trims low-signal sections so the summary stays lean, and never blocks you.
- **strict**: hard-caps the manifest at 2k tokens and refuses if it would go over.
- **off**: no cap, the manifest can grow to any size.

**2. Output compression rules.** How terse Claude's replies are in this project.
- **default** (recommended): diff-style edits, no "here's what I did" preamble.
- **strict**: telegraphic, clipped replies, for power users who want maximum brevity.
- **verbose**: extra context and explanation, good while you are still learning the tool.
- **skip**: don't install reply rules at all.

Not sure? Take the recommended option in each. You can change either choice later: run `sipcode rules --mode <default|strict|verbose>` for the reply style, or re-run `sipcode manifest` to regenerate the summary.

### Step 4. Open a new Claude Code session

Sipcode picks up automatically on the next tool call Claude makes. No restart needed in most cases. To be safe, you can close any existing Claude Code window and open a fresh one.

Now Claude Code will be using Sipcode in the background.

### Step 5. After about an hour of work, check it

```bash
sipcode drift
sipcode proxy --stats
```

If drift says "no drift" and proxy --stats shows a few dozen rewrites with savings, everything is working.

---

## Updating Sipcode

Sipcode never checks for updates on its own. That would require a network call, and zero network calls in normal use is a guaranteed property of the codebase (a test fails the build otherwise). Updating is always a manual, explicit step.

To update to the latest version:

```bash
npm i -g sipcode@latest
```

Or use the built-in helper:

```bash
sipcode update          # prints your current version + the update command
sipcode update --run    # runs the update in place for you
```

After updating, confirm with `sipcode --version` and see what changed in the [CHANGELOG](CHANGELOG.md). The MCP config never needs re-pasting; Claude asks the server for its tools on every reconnect, so new tools appear automatically.

**Release cadence:** patch releases ship whenever a fix or improvement is ready, often within a day or two of a reported issue. Since Sipcode can't notify you (zero network calls), a good habit is to run `sipcode update` about once a week. It's a one-second check, and `--run` upgrades you on the spot if something's new. Watch or star the [repo](https://github.com/Anuj7411/sipcode) to catch releases too.

---

## What you get

| Feature | What it does for you |
|---|---|
| Context-rot detection | Warns when your Claude Code session is starting to behave worse than your norm |
| Re-read deduplication | Catches duplicate file reads and skips them, saving tokens and time |
| Compression-integrity scoring | For every saving, tells you what percentage of the original signal was kept |
| Spend telemetry | Daily, monthly, projected. All from your own transcripts (Claude Code and Codex), no cloud upload |
| Task cost estimation | Predicts what a coding task will cost across Opus, Sonnet, and Haiku before you run it |
| Codebase health score | Rates your repo 0-100 on how easy it is for an AI agent to work in |
| MCP server | 15 tools registered for Claude Desktop, so you can ask Claude itself about your usage |
| Reproducible benchmark | A locked 20-task corpus that anyone can run and verify |

---

## Frequently asked questions

### Is it really free?

Yes. MIT license. No tracking. No telemetry sent to us. No paid tier. You can read every line of source code on GitHub.

### Does it send my code anywhere?

No. Sipcode makes zero network calls during normal use. Everything runs locally on your machine. We have a privacy test that fails if any network code is imported into the source.

To make repeat runs fast, Sipcode keeps a few caches on your own disk under `~/.sipcode/` (token counts per session log for `today` and `forecast`, per-session metrics for `drift`). They never hold message text, are never uploaded, and are rebuilt automatically if you delete them. [PRIVACY.md](PRIVACY.md) lists exactly what is stored and where.

### How is it different from other context tools?

See the [comparison page](https://anuj7411.github.io/sipcode/compare/). The short version: Sipcode is the only one with a published reproducible benchmark, zero false-dedup by architecture, and mid-session install support.

### What is "context rot"?

When Claude's context window fills up with stale, repeated, or off-topic information, the quality of its answers drops. Sipcode measures this with `sipcode drift` and removes most of the waste with the proxy hook.

### Does it work with Cursor or other AI tools?

The proxy, hooks and rules work with Claude Code. Sipcode also reads OpenAI Codex session logs for spend analytics (`stats`, `today`, `forecast`, `trend`, `impact`, `why`, `receipt`, `drift`); see [Codex](#codex) for what works and what is not supported for Codex yet. For Cursor, `sipcode rules --agent cursor` writes the output-compression rules to Cursor's rules file; Cursor's session logs are not read.

### How do I update?

```bash
npm i -g sipcode@latest
```

Or run `sipcode update` to see your version and the command, or `sipcode update --run` to update in place. Sipcode never auto-checks for updates (zero network calls), so updating is always explicit. See the [CHANGELOG](CHANGELOG.md) for what changed.

### How do I uninstall?

```bash
sipcode proxy --uninstall
npm uninstall -g sipcode
```

---

## Commands

| Command | What it does |
|---|---|
| `sipcode init` | Set up Sipcode in a project (manifest + CLAUDE.md + proxy hook) |
| `sipcode update` | Show how to update to the latest version (or `--run` to update now) |
| `sipcode hygiene` | Install Session Hygiene: read-once rules + context-pressure hooks |
| `sipcode rules` | Install, switch, or inspect the output-compression rules in CLAUDE.md |
| `sipcode manifest` | Generate or refresh the project manifest |
| `sipcode drift` | Check if the current session is drifting from your norm (`--session`, `--here`, `--agent`) |
| `sipcode proxy --stats` | See what the proxy caught this session (also `--install` / `--uninstall`) |
| `sipcode benchmark` | Run the locked 20-task corpus for a verifiable savings number |
| `sipcode estimate` | Predict what a task will cost across models before you run it |
| `sipcode today` | Today's spend summary vs your 30-day median |
| `sipcode stats` | Cumulative token savings across all sessions (`--html` writes `.sipcode/stats.html` for Claude Code and `.sipcode/stats-codex.html` for Codex) |
| `sipcode forecast` | Month-end spend projection from your last 14 days |
| `sipcode trend` | Track one metric over time, to see if it's getting better |
| `sipcode why` | Per-session forensics: where your tokens died |
| `sipcode impact` | A/B compare your spend before vs after Sipcode |
| `sipcode score` | Audit your repo for AI-friendliness (0-100, tiered badge) |
| `sipcode receipt` | Generate a shareable PNG receipt of a session |

Run any of them with `--help` for full options.

**Tip: which sessions do these report on?** By default, `why`, `stats`, `today`, `forecast`, `trend`, `impact`, `receipt` and `drift` look across **all** your projects, not just the folder you are standing in. So if you run `sipcode why` inside project A but project B had the most recent activity, you will see project B. To scope any of them to the project you are currently in, add `--here` (for example, `sipcode why --here` or `sipcode today --here`). The same goes for Codex sessions. Use `sipcode why --list` to see every session and pick a specific one with `--session <id>`.

---

## Requirements

- Node.js 20 or newer
- Claude Code installed (for the proxy hook). Sipcode also works as standalone CLI tools (benchmark, score, etc.) without Claude Code installed.
- Optional: OpenAI Codex CLI, for Codex spend analytics.

---

## License

MIT. See [LICENSE](LICENSE).

---

## Acknowledgments

Built with care for the indie developers who burn through their Claude Max plan in two hours. The 62.6% benchmark methodology is documented in [benchmark/METHODOLOGY.md](benchmark/METHODOLOGY.md). Anthropic's published research on context-window quality informs the integrity-scoring approach.
