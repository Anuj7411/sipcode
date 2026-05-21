# Sipcode MCP server

> Run Sipcode inside Claude desktop, Claude Code, Cursor, and any other MCP-aware AI client.

Starting in v1.1.0, Sipcode ships an MCP (Model Context Protocol) server that exposes the same offline analytics that the CLI gives you — but **as tools your AI agent can call live during a conversation**.

This means: when you're chatting with Claude in the desktop app and you ask *"how expensive will this refactor be?"* — Claude can call Sipcode's `estimate_task_cost` tool right there in the chat and give you a real, sourced prediction.

---

## Quick setup (Claude desktop app)

### 1. Install Sipcode globally (same command on every OS):

```bash
npm install -g sipcode
```

### 2. Open your Claude desktop config file:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

### 3. Add the Sipcode MCP server. Pick the snippet for your OS:

**🪟 Windows:**

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

**🍎 macOS / 🐧 Linux:**

```json
{
  "mcpServers": {
    "sipcode": {
      "command": "sipcode-mcp"
    }
  }
}
```

> Why the difference: on Windows, `npm install -g` registers `sipcode-mcp` as a `.cmd` batch shim. Claude Desktop can't launch `.cmd` files directly, so the `cmd /c` wrapper is required. macOS and Linux register `sipcode-mcp` as a real executable.

If the file already has other MCP servers, add `"sipcode"` as a sibling key inside `mcpServers`. Don't replace the whole file.

### 4. Fully quit and reopen Claude Desktop.

On Windows that means system tray → right-click Claude → **Quit** (closing the window keeps the app running). On macOS press ⌘ + Q. On Linux quit from the application menu.

### 5. Updates work the same way on every OS:

```bash
npm install -g sipcode@latest
```

There's no auto-updater — every platform updates with the same explicit command. The MCP config never needs to be re-pasted; Claude Desktop asks the server "what tools do you have?" on every reconnect, so new tools just appear.

That's it. Open any chat and ask:

> *"How expensive would it be to refactor my auth pipeline?"*

Claude will discover the `estimate_task_cost` tool, call it with your task description, and answer with a real cost band per model.

---

## What the MCP server exposes

Six tools, all backed by Sipcode's existing zero-LLM analyzers:

### `get_sipcode_info`

Returns the installed Sipcode version, the full list of registered MCP tools, the Node runtime version, and the host platform. No arguments.

**When Claude uses it:** when you ask "what version of sipcode is installed?", "what tools do you have from sipcode?", or "is sipcode working?". The fastest sanity check that the MCP server is wired up correctly.

### `list_recent_sessions`

Lists your N most recent Claude Code sessions from `~/.claude/projects`, newest first. Returns session id, timestamp, project hash, file size.

**When Claude uses it:** when you ask "what sessions do I have?" or "show me my recent work" or before targeting `audit_latest_session` at a specific session.

### `audit_latest_session`

Audits a Claude Code session and returns a JSON report: total spend, output ratio, duplicate file reads, idle context, top expensive tool calls, and what Sipcode would have saved. The exact equivalent of running `sipcode why` from the terminal.

**When Claude uses it:** when you ask "where did my tokens go?" or "audit my last session" or "how am I doing on token spend?"

**Optional argument:** `session_id` (string) — if omitted, picks the most recent session across all projects.

### `get_project_manifest`

Returns the Sipcode project manifest for a given directory — a <2k-token compressed codebase map. If no manifest exists yet, returns an error telling Claude to ask the user to run `sipcode manifest` first.

**When Claude uses it:** BEFORE exploring an unfamiliar codebase. Reading the manifest first is far cheaper than grepping through files.

**Required argument:** `cwd` (string) — absolute path to the project root.

### `estimate_task_cost`

Predicts the cost of a coding task across Opus / Sonnet / Haiku before the user runs it. Uses Sipcode's heuristic + historical-anchor approach.

**When Claude uses it:** when you ask "how expensive is X?" or before quoting a refactor / debugging job.

**Required arguments:** `task` (string, ≥3 chars) and `cwd` (string).

### `verify_sipcode_impact`

A/B-compares the user's token spend before vs after Sipcode's optimizers were installed. Reads Claude Code sessions from `~/.claude/projects/` and the install marker from `.sipcode/install-state.json`. Returns a JSON impact report with before/after totals (sessions, tokens, cost, output ratio) and a delta block. **The on-your-own-data proof-of-savings tool.**

**When Claude uses it:** when the user asks "is sipcode actually saving me tokens?", "show me the impact", or "prove sipcode is working."

**Optional arguments:** `cwd` (absolute path; defaults to the server's cwd) and `since` (YYYY-MM-DD override for the install date, skipping the install-state lookup).

---

## Privacy

The MCP server runs entirely on your machine. It is bound by **the same privacy contract as the CLI** — see `PRIVACY.md`. Zero network calls. Zero telemetry. The same static test (`tests/privacy/no-network.test.ts`) that asserts no network imports in core paths covers the MCP server file too.

Specifically:
- The MCP server reads `~/.claude/projects/*.jsonl` (only when called by a tool that needs it)
- It reads the pricing data bundled inside the published package
- It reads project files from the `cwd` argument when generating a manifest
- It writes nothing to disk
- It opens no network sockets

When the Claude desktop app talks to the MCP server, **the conversation between you and Claude still goes through Anthropic's servers** (Sipcode doesn't change that). What Sipcode adds is purely the local tool-call layer.

---

## Compatibility

The MCP server is a standard MCP stdio server. It works with:

| Client | How to wire it up |
|---|---|
| **Claude desktop** | Add to `claude_desktop_config.json` as shown above |
| **Claude Code (the CLI)** | Add to `.mcp.json` in your project, or `~/.claude.json` globally |
| **Cursor** | Add to Cursor's MCP settings (Cursor v0.42+) |
| **Continue.dev** | Add to Continue's config |
| **Codex / Gemini CLI / OpenCode / Aider** | Any MCP-compliant client |

---

## Troubleshooting

### "Tool not found" / "MCP server failed to start"

Check that you can run `sipcode-mcp` from your terminal directly (after `npm install -g sipcode`). If it prints `[sipcode-mcp] connected (sipcode vX.Y.Z, 6 tools)` and then waits for input, the server is healthy. Press `Ctrl+C` to exit.

If `npx sipcode-mcp` fails: confirm `npm install -g sipcode` succeeded with `sipcode --version` showing `1.1.0` or later.

### "No sessions found" when calling `audit_latest_session`

The server is looking at `~/.claude/projects/`. If you've never used Claude Code (the CLI), there are no sessions to audit. The MCP server can only audit Claude Code transcripts — not desktop or web chat sessions, since those live on Anthropic's servers.

### "No manifest at ..." when calling `get_project_manifest`

Run `sipcode manifest` once in the target directory. The MCP server reads the manifest from disk but does NOT generate one automatically — that's intentional, so the agent never silently builds a manifest in a directory the user didn't intend.

---

## What this DOESN'T do

To be honest about the scope:

- **The MCP server cannot audit your Claude desktop chats.** Those conversations live on Anthropic's servers; Sipcode has no access. The MCP tools work with Claude Code transcripts (the local `.jsonl` files) and your local codebase.
- **The MCP server cannot inject CLAUDE.md rules at runtime.** Sipcode's output-compression rules are loaded by Claude Code at session start, not by the MCP tool layer.
- **The MCP server cannot stop a chat from running over budget.** It can warn (via `audit_latest_session` retroactively) but it cannot block ongoing token spend in real time.

For full optimization, the recommended workflow is still:
1. Use the **CLI** (`sipcode init`) to set up your project (manifest + rules)
2. Use the **MCP server** in chats for live cost questions and audits
3. Use the **CLI** (`sipcode receipt`) to generate shareable receipts post-session

---

## Roadmap

- **v1.2:** add a `dry_run_task` tool that uses `sipcode plan` (when shipped) to produce a structured pre-flight spec before the agent commits.
- **v2.0:** browser extension for claude.ai web chat — would capture conversations as they happen so `audit_latest_session` works for web sessions too.
