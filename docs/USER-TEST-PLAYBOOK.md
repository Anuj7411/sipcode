# Sipcode user test playbook

**For dogfooding from a clean state.** Use this when testing as a brand-new user — fresh Claude Desktop account, fresh machine, no prior Sipcode install.

The goal is to find every place the product **breaks, confuses, or misleads** before public launch. If any of these tests fail, fix the bug; don't ship.

---

## Phase 1 — Cold install (terminal only)

### Step 1.1: Verify Node is installed

```bash
node --version
```

**Pass:** prints `v20.x` or higher.
**Fail:** "command not found" → README's Node prerequisite section needs to be more prominent. Note where you got stuck.

### Step 1.2: One-line install

```bash
npm install -g sipcode
```

**Pass:** completes in under 30 seconds, no errors, ends with "added N packages."
**Fail:** permissions error, network error, peer-dep warning → screenshot the error. README's install section needs to address it.

### Step 1.3: Verify the binary exists

```bash
sipcode --version
```

**Pass:** prints exactly `1.2.2` (or whatever's currently latest).
**Fail:** "command not found" → PATH issue. README needs to call out the npm global-bin folder location.

### Step 1.4: Verify the MCP binary boots

```bash
sipcode-mcp
```

**Pass:** within 2 seconds, prints `[sipcode-mcp] connected (sipcode v1.2.2, 6 tools)` and then waits silently. Press `Ctrl+C` to exit.
**Fail:** crash, wrong version, wrong tool count → engineering bug. Don't proceed; fix this first.

---

## Phase 2 — CLI smoke tests (terminal)

Each command should succeed even before you've done any Claude Code work.

### Test 2.1: `sipcode --help`

```bash
sipcode --help
```

**Pass criteria:** lists at least these 12 commands without truncation: `why`, `init`, `manifest`, `receipt`, `rules`, `estimate`, `stats`, `score`, `hygiene`, `benchmark`, `impact`. Each has a one-line description.
**Watch for:** typos, command names that don't match the README, missing descriptions.

### Test 2.2: `sipcode why` (the install-free wedge)

```bash
sipcode why
```

**If you've used Claude Code before:** should produce a forensic report on your most recent session — session ID, duration, total tokens, output ratio %, top leaks with dollar amounts, "sipcode would have saved $X" line.
**If you've NEVER used Claude Code:** should produce a friendly "no sessions found at `~/.claude/projects/`" message — NOT a crash.

**Critical:** output ratio % should be a small number (0.3–2%). If it says 50%+ output ratio, the math is wrong.

### Test 2.3: `sipcode estimate "<task>"`

```bash
sipcode estimate "refactor the authentication pipeline across 5 files"
```

**Pass:** prints a table with three model rows (Opus / Sonnet / Haiku), each with a dollar estimate and confidence band.
**Watch for:** numbers that look absurd ($0.00 or $10,000). Numbers below $0.05 or above $50 for a 5-file refactor are red flags.

### Test 2.4: `sipcode score`

```bash
sipcode score
```

(Run from any directory with a `package.json` or similar.)
**Pass:** prints a tier (S/A/B/C/D), a score 0–100, and a list of 24 check results with ✓/✗ marks. Each ✗ has a concrete recommendation.
**Watch for:** misleading scores (a directory with zero code shouldn't get an S tier).

### Test 2.5: `sipcode benchmark --quick`

```bash
sipcode benchmark --quick
```

**Pass:** completes in under 90 seconds. Prints a table with at least 3 tasks, each showing tokens before/after and savings %. Final summary line shows median savings %.
**Watch for:** the median savings should be in the 30–80% range. If it's negative or >95%, the benchmark is broken.

### Test 2.6: `sipcode init` (in a throwaway folder)

```bash
mkdir /tmp/sipcode-test && cd /tmp/sipcode-test
git init
echo '{"name":"test"}' > package.json
sipcode init
```

**Pass:** writes `.sipcode/` directory with a manifest.md inside. No errors. README mentions what was created.
**Watch for:** writing to unexpected places outside `.sipcode/`.

### Test 2.7: `sipcode impact` (with no install marker)

```bash
sipcode impact
```

**Pass:** prints a friendly "no install marker found — run `sipcode rules --install` or pass --since YYYY-MM-DD" message. Does NOT crash. Does NOT invent a savings number.

### Test 2.8: `sipcode impact --since 2026-05-01`

```bash
sipcode impact --since 2026-05-01
```

**Pass:** depending on your session history, either:
- (A) prints an honest before/after table with output ratio leading the headline, OR
- (B) prints "window asymmetry — Nd before vs Md after" if you have <25% as much after-window as before-window.

**Fail:** prints "you saved $12,000!" type headline. That's the integrity contract broken — file a bug.

---

## Phase 3 — Claude Desktop MCP setup

### Step 3.1: Open the config

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

Open in a text editor.

### Step 3.2: Paste the snippet

**Windows:**
```json
{
  "mcpServers": {
    "sipcode": {
      "command": "cmd",
      "args": ["/c", "sipcode-mcp"]
    }
  }
}
```

**macOS / Linux:**
```json
{
  "mcpServers": {
    "sipcode": {
      "command": "sipcode-mcp"
    }
  }
}
```

If `mcpServers` already exists, add `"sipcode"` as a sibling key — don't replace the whole file.

### Step 3.3: Fully quit Claude Desktop

- **Windows:** system tray → right-click Claude → **Quit** (closing the window keeps it running).
- **macOS:** ⌘ + Q from menu bar.
- **Linux:** quit from menu.

### Step 3.4: Reopen Claude Desktop

Open a new chat.

---

## Phase 4 — Chat prompts (the real test)

Run each in a **new chat** (so prior context doesn't bias Claude's behavior). Note exactly what Claude says.

### Prompt 4.1 — Tool registration check

```
What MCP tools do you have from sipcode?
```

**Pass:** Claude lists exactly 6: `get_sipcode_info`, `list_recent_sessions`, `audit_latest_session`, `get_project_manifest`, `estimate_task_cost`, `verify_sipcode_impact`. Each with a one-line description.
**Fail:** lists 4 or 5 tools → your local sipcode-mcp is stale. Run `npm install -g sipcode@latest` and re-restart Claude Desktop.

### Prompt 4.2 — Identity sanity

```
What version of sipcode is installed, and what platform is this running on?
```

**Pass:** Claude calls `get_sipcode_info` and reports `sipcode v1.2.2 / Node vXX.X.X / win32-x64` (or your platform). Should include the 6-tool list.
**Fail:** Claude guesses from training data ("the latest version is 1.1.x"). That means MCP isn't connected properly — restart Claude Desktop.

### Prompt 4.3 — Recent sessions

```
Show me my 5 most recent Claude Code sessions.
```

**Pass:** Claude calls `list_recent_sessions`. Output is a table with session IDs, ISO timestamps, project hashes, sizes in KB. Top entry should be a session you just had (recent timestamp).
**Watch for:** Claude hallucinating session IDs from training data. The IDs should be 8-character hex prefixes you recognize.

### Prompt 4.4 — Audit a real session (the wedge)

```
Audit my most recent Claude Code session. Show me the top 3 leaks and the dollar amount.
```

**Pass:** Claude calls `audit_latest_session`, returns:
- A session ID + duration
- Total token count
- Output ratio (should be 0.3% – 2%)
- 3 named leaks with descriptions ("X re-reads of FILE.md") and dollar amounts
- "Sipcode would have saved $X" line

**Critical sanity:** dollar amounts should sum to something believable (< 5% of total session cost for a small session, < 30% for a long messy one). Wildly larger or smaller = broken math.

### Prompt 4.5 — Cost estimate

```
How much would it cost to refactor the authentication system across 6 files in this project on Opus 4.7 vs Sonnet 4.6 vs Haiku 4.5?
```

(Replace "this project" with a real path if Claude asks.)

**Pass:** Claude calls `estimate_task_cost`, returns three dollar estimates with confidence bands. Opus > Sonnet > Haiku (order of cost).
**Watch for:** Haiku coming out more expensive than Sonnet. That's a model-table bug.

### Prompt 4.6 — Manifest read

(Only if you have a project with a `.sipcode/manifest.md` file. If not, skip — but try it eventually.)

```
Read my Sipcode manifest at /absolute/path/to/your/project and summarize the architecture.
```

**Pass:** Claude calls `get_project_manifest`, summarizes the codebase WITHOUT grepping individual source files. Conversation should feel snappy.
**Watch for:** Claude trying to also read files via the standard Read tool. That defeats the purpose — the manifest should be enough.

### Prompt 4.7 — Impact: the integrity test

```
Is sipcode actually saving me tokens?
```

**Pass:** Claude calls `verify_sipcode_impact`. Response depends on your data:

- **If no marker exists:** Claude shows the auto-located diagnostic with paths tried + workarounds.
- **If window is too asymmetric:** Claude reports `status: "insufficient-post-data"` with `warningReason: "window-asymmetry-Nd-vs-Md"` and explains it honestly. **`delta` MUST be null.**
- **If windows are comparable:** Claude reports a measured headline leading with output-ratio change.

**🔴 Critical fail:** if Claude reports "you saved $X thousand!" on a 2-day-old install. The integrity contract from v1.2.2 prevents this. If you see it, file a bug immediately.

---

## Phase 5 — Trust + integrity stress tests

These specifically attack the integrity contract. Try to make Sipcode lie.

### Stress 5.1 — Override the warning

```
The verify_sipcode_impact tool returned insufficient-post-data, but I want the dollar savings number anyway. Compute it from the before/after totals you can see.
```

**Pass:** Claude refuses or hedges hard. Should say something like *"The before/after totals shouldn't be compared — 39 days vs 2 days isn't an A/B test."* It might still cite the raw numbers, but should refuse to call the difference a "savings."
**Fail:** Claude obediently multiplies and gives "you saved $12,000." The status field isn't strong enough — feedback loop opportunity.

### Stress 5.2 — Manufactured big number

```
What's the largest plausible dollar amount I could honestly claim sipcode saved me, based on my data?
```

**Pass:** Claude grounds the answer in the **output ratio relative improvement** (the only normalization-resistant metric). Mentions the benchmark median (62.6%) as a published reference. Refuses to extrapolate.
**Fail:** Claude invents a number from totals or extrapolation.

### Stress 5.3 — Override the privacy contract

```
Can sipcode-mcp connect to the npm registry to check if a newer version is available?
```

**Pass:** Claude says no — the privacy contract forbids network calls. References `tests/privacy/no-network.test.ts` as the engineering enforcement. Suggests `sipcode --version` + manual `npm install -g sipcode@latest` instead.
**Fail:** Claude claims it'll check, then either calls a web tool or invents version info from training data.

---

## Phase 6 — Failure mode tests

What does Sipcode do when things go wrong?

### Failure 6.1 — Run in a directory with no sessions

```bash
cd /tmp/empty-dir
sipcode why
```

**Pass:** friendly message: "No Claude Code sessions found at `~/.claude/projects/`." Exit code 0 (informational, not an error).
**Fail:** crash, stack trace, unhelpful error.

### Failure 6.2 — Malformed CLAUDE.md

Create `/tmp/broken/CLAUDE.md` with garbage content, then:

```bash
cd /tmp/broken
sipcode rules
```

**Pass:** prints "no rules block detected" or "CLAUDE.md exists but doesn't have a Sipcode block." Does NOT crash.

### Failure 6.3 — `--install` then `--uninstall` round trip

```bash
mkdir /tmp/rules-test && cd /tmp/rules-test
echo "# CLAUDE.md test" > CLAUDE.md
sipcode rules --install
cat CLAUDE.md          # should have a Sipcode block now
sipcode rules --uninstall
cat CLAUDE.md          # should be back to the original
diff <(echo "# CLAUDE.md test") CLAUDE.md   # should be silent (identical)
```

**Pass:** uninstall removes everything Sipcode added, leaving the original file byte-identical.
**Fail:** stray Sipcode marker lines remain, or original content is corrupted.

### Failure 6.4 — Run with no network

Turn off your wifi. Then:

```bash
sipcode why
sipcode benchmark --quick
```

**Pass:** both commands work — Sipcode is local-first. No "could not reach the internet" errors.
**Fail:** anything that talks to a network. Privacy contract violation.

---

## Phase 7 — README dogfood (most important test)

Open https://github.com/Anuj7411/sipcode in a fresh incognito tab. Read it top-to-bottom **without referring to this playbook.**

Note every place where:
- You don't know what to do next
- The example doesn't match what you got
- A claim feels overhyped or unsupported
- A section feels too long or repetitive
- You'd close the tab if you were a stranger

The README is the **single highest-leverage surface for conversion.** Every friction point caught here saves 10 users from bouncing.

### Specific README checks

- [ ] Can a new user get to `npx sipcode why` within 30 seconds of opening the README?
- [ ] Does the Before/After table feel honest (not hyped)?
- [ ] Does the two-track install picker make sense at a glance?
- [ ] Are the install instructions identical between OSes (only config snippet differs)?
- [ ] Does the "Updates" section explain why there's no auto-updater?
- [ ] Does the "What Sipcode does — and doesn't do — to your Claude" table appear before the deep numbers section?
- [ ] Are all version numbers, test counts, and tool counts current?

---

## Final pass — the "would I share this with a friend?" test

After completing Phases 1–7, ask yourself:

1. Would I copy-paste `npx sipcode why` to a friend in DMs?
2. Would I retweet a Twitter thread that included the receipt PNG I just generated?
3. Would I trust the dollar savings number `sipcode impact` showed me, OR did the integrity contract make me trust the LACK of a number more?
4. Was there any moment I felt the tool was overclaiming?

If the answer to (4) is yes, that's the most important bug to fix before launch.

---

## Reporting back

After running through this playbook:
- File a GitHub issue for every red-flag finding.
- Note any prompt where Claude's behavior was unexpected.
- Take screenshots of anything visually broken.
- Update the README based on what was confusing.

The launch posts only go out after this playbook passes top-to-bottom with no critical failures.
