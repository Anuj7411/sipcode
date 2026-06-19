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
  <a href="https://github.com/Anuj7411/sipcode/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-5B4FCF" alt="MIT licensed" /></a>
  <img src="https://img.shields.io/badge/tests-1%2C317%20passing-28C840" alt="1317 tests passing" />
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
| **Reproducible benchmark on locked corpus** | ✓ 62.6% median (20 tasks) | ✗ | ✗ | ✗ |
| **Self-introspection MCP tools** | ✓ 15 tools | ✗ | ✗ | partial |
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

Sipcode measures the bloat, then removes the parts Claude does not need. The savings are not theoretical. Run `sipcode benchmark` on any machine and you will see the same 62.6% median reduction on the locked 20-task corpus.

---

## The two-minute tour

After installing, here are the five commands that show you what Sipcode is doing.

### 1. `sipcode drift`

Tells you if your current Claude Code session is drifting from your normal usage pattern. Bloated context, repeated reads, stale signals are all flagged here.

```
✓ Sipcode drift: no drift, context health stable vs your recent baseline.
```

### 2. `sipcode proxy --stats`

Shows what Sipcode caught in the current session, broken down by rewriter.

```
Sipcode proxy, rewrite stats
  total rewrites:    144
  est. tokens saved: ~288,685 (heuristic)
  signal kept:       67% (med), weighted across all rewrites
```

### 3. `sipcode benchmark`

Runs the locked 20-task corpus and produces a verifiable savings number. Anyone, anywhere can run this and get 62.6%.

```
62.6%  median savings on a locked 20-task corpus
       range 37.4% to 80.6%   3,567,170 tokens   $67.43
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

## How to install (more detail)

Sipcode works on Mac, Linux, and Windows. You need Node.js 18 or newer.

### Step 1. Install Node.js

Skip this step if you already have Node.js. Otherwise:

- **Mac:** `brew install node`
- **Linux (Ubuntu / Debian):** `sudo apt install nodejs npm`
- **Windows:** Download from [nodejs.org](https://nodejs.org/)

Verify it worked:

```bash
node --version
```

You should see `v18.0.0` or higher.

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

You should see `1.6.15` or higher.

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

## What you get

| Feature | What it does for you |
|---|---|
| Context-rot detection | Warns when your Claude Code session is starting to behave worse than your norm |
| Re-read deduplication | Catches duplicate file reads and skips them, saving tokens and time |
| Compression-integrity scoring | For every saving, tells you what percentage of the original signal was kept |
| Spend telemetry | Daily, monthly, projected. All from your own transcripts, no cloud upload |
| MCP server | 15 tools registered for Claude Desktop, so you can ask Claude itself about your usage |
| Reproducible benchmark | A locked 20-task corpus that anyone can run and verify |

---

## Frequently asked questions

### Is it really free?

Yes. MIT license. No tracking. No telemetry sent to us. No paid tier. You can read every line of source code on GitHub.

### Does it send my code anywhere?

No. Sipcode makes zero network calls during normal use. Everything runs locally on your machine. We have a privacy test that fails if any network code is imported into the source.

### How is it different from other context tools?

See the [comparison page](https://anuj7411.github.io/sipcode/compare/). The short version: Sipcode is the only one with a published reproducible benchmark, zero false-dedup by architecture, and mid-session install support.

### What is "context rot"?

When Claude's context window fills up with stale, repeated, or off-topic information, the quality of its answers drops. Sipcode measures this with `sipcode drift` and removes most of the waste with the proxy hook.

### Does it work with Cursor or other AI tools?

Today, only with Claude Code (since Claude Code is the only tool that exposes the hooks Sipcode needs). Support for other CLIs is something we are exploring.

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
| `sipcode drift` | Check if the current session is drifting from your norm |
| `sipcode proxy --stats` | See what the proxy caught this session |
| `sipcode benchmark` | Run the locked 20-task corpus |
| `sipcode today` | Today's spend summary |
| `sipcode forecast` | Month-end spend projection |
| `sipcode impact` | Before vs after Sipcode comparison |
| `sipcode why` | Per-session forensics |
| `sipcode score` | Audit your repo for AI-friendliness |
| `sipcode receipt` | Generate a shareable PDF receipt of a session |

Run any of them with `--help` for full options.

---

## Requirements

- Node.js 18 or newer
- Claude Code installed (for the proxy hook). Sipcode also works as standalone CLI tools (benchmark, score, etc.) without Claude Code installed.

---

## License

MIT. See [LICENSE](LICENSE).

---

## Acknowledgments

Built with care for the indie developers who burn through their Claude Max plan in two hours. The 62.6% benchmark methodology is documented in [benchmark/METHODOLOGY.md](benchmark/METHODOLOGY.md). Anthropic's published research on context-window quality informs the integrity-scoring approach.
