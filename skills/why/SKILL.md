---
description: Forensic audit of the user's most recent Claude Code session. Returns total spend, output ratio, duplicate file reads, idle context after auto-compact, top expensive tool calls, and an estimate of what Sipcode would have RECOVERED if optimizers were active. Use when the user asks "where did my tokens go?", "audit my last session", "why was that session so expensive?", or any forensic question about a past Claude Code session.
---

# Sipcode — Why (session forensics)

Call the `sipcode:audit_latest_session` MCP tool to produce a forensic report of the user's most recent Claude Code session.

If the user provides a session ID prefix (e.g., "audit session 3bca35e2"), pass it as the `session_id` argument. Otherwise, omit and the tool will pick the most recent session across all projects.

When presenting the result:
- Lead with the **output ratio** (the percentage of total tokens that were actual code output). 0.3–2% is typical.
- Surface the **top 3 leaks** with their dollar cost.
- The "Sipcode estimates ~X tokens were RECOVERABLE" line is **potential**, not realized. Only realized after `sipcode rules --install` + new sessions + `sipcode impact`. Be explicit about this when relaying the number.
- If the session is unusually large (> $10) or unusually wasteful (output ratio < 0.2%), call that out.

Do NOT extrapolate the single-session savings across many sessions. Each session is its own forensic snapshot.
