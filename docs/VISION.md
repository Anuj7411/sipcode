# Sipcode — North Star

**Authored:** 2026-05-22 by Anuj Ojha.
**Purpose:** The single source of truth for what Sipcode is being built toward. Any product decision, feature trade-off, or strategic pivot must be checked against this document. Saved here so it survives across sessions, future contributors, and pivots.

---

## The six things Sipcode is dreamed to be

1. **A tool that tells you WHERE your Claude Code tokens went** — install-free, instant, forensic. (`sipcode why`)

2. **Built with the engineering rigor of Answerable** — pure runners, I/O seams, branded types, stable IDs as public API, 5-gate release pipeline, privacy contract asserted by CI.

3. **Honest about its numbers** — no marketing-grade claims that data can't defend. Reproducible benchmark. Integrity contract that refuses to confirm savings when windows aren't comparable.

4. **A real tool for real indie devs** — built because Anuj's own Claude Code Max plan was burning out in 2 hours. Not abstract. Not enterprise-first. For the developers who feel the cost themselves.

5. **A real shipping product** — on npm, in Claude Desktop chat, audited by real users, surviving real skeptical analysis. Already shipping as of v1.2.3.

6. **The best token-saving tool — and not just for Claude Code.**
   - Best optimizer in raw measurable savings, not just best observatory.
   - Launching on Claude Code first because that's where Anuj's pain lives.
   - Expanding to Cursor, Codex, Gemini CLI, Aider, and every other AI coding agent users actually use.
   - Built with **the latest token-optimization technologies** — AST-aware semantic compression, symbol-level virtual reads, predictive pre-summarize, adaptive context-pressure compression, cross-session output recycling — not just heuristic line filters.
   - Beating RTK and any other competitor on the metric users actually care about: measurable tokens saved on real workloads.

---

## What "best token saver" means concretely

This is not a marketing claim. It's a measurable, falsifiable target.

For any user running Claude Code (or, post-v2.0, any supported agent), **Sipcode should produce a higher token reduction on the same real workload than any competing tool, on a published benchmark anyone can reproduce.**

The targets:

| Layer | Today | Phase A (week 1) | Phase B (week 4) | Phase C (~v2.0) |
|---|---|---|---|---|
| Tool-output proxy (every `git status`, `npm ls`, file read) | ❌ Not done | ✅ Match RTK 60–90% | ⚠️ Exceeds RTK on code reads (96%+) via AST | ⚠️ Predictive pre-summarize closes the loop |
| LLM output compression (Claude's responses to user) | ✅ `sipcode rules` | (no change) | (no change) | Adaptive compression |
| Codebase manifest (compressed map) | ✅ `sipcode manifest` | (no change) | Symbol-level reads layered on top | Co-edit prediction |
| Read-once cache | ⚠️ `sipcode hygiene` warns only | (no change) | ✅ Enforced (real LRU) | Cross-session persistence |
| Multi-agent support | ⚠️ Claude Code + Cursor | (no change) | Add Codex transcript parser | Add Gemini, Aider, OpenCode |

By the end of Phase B, Sipcode should be measurably the better optimizer than RTK on code-heavy real workloads. By the end of Phase C, no competitor should be able to match Sipcode's coverage + depth without a year of work.

---

## Multi-agent roadmap — the second half of the vision

Sipcode launches on Claude Code because that's where Anuj's own pain lives. But the vision is the **universal token saver** — supporting every AI coding agent users actually use.

Phased agent expansion:

| Phase | Agents added | Why this order |
|---|---|---|
| **v1.0** (now) | Claude Code (full), Cursor (partial — config injection, no transcript parsing) | Where Anuj's own usage lives. The product is dogfooded. |
| **v1.4–v1.5** (next 2 months) | Cursor (full transcript parsing), Codex | Next-largest user bases. Codex transcripts are simpler to parse than Cursor's. |
| **v2.0** | Gemini CLI, Aider, OpenCode | Major open-source coding agents. Gemini CLI is Google-blessed and growing fast. |
| **v2.x** | Continue, Cline, Roo, Windsurf, Hermes, Kilo, Antigravity | Long tail. Add on user signal, not speculatively. |

For each agent, Sipcode needs:
- A transcript parser (each agent writes session logs differently)
- An agent-specific config injection (CLAUDE.md for Claude Code, .cursorrules for Cursor, AGENTS.md for Codex, GEMINI.md for Gemini, etc.)
- An MCP server bridge (already universal — Claude Desktop, Cursor, Continue all support MCP)

The agent abstraction layer (`src/modules/agents/`) was designed for this. The Cursor adapter shipped in v1.0 is the proof-of-concept.

---

## Innovation principle — don't just copy

The vision is **not** "match RTK and call it done." The vision is **innovation that creates a structural moat**.

Concretely, Sipcode commits to building optimization layers RTK has NOT built and probably can't easily build:

1. **AST-aware semantic compression** — parse the actual code, not just filter lines. (Phase B)
2. **Symbol-level virtual reads** — return only the function/class the agent needs, not the whole file. (Phase B)
3. **Predictive pre-summarize from git co-edit history** — anticipate next reads, don't just react. (Phase C)
4. **Adaptive context-pressure compression** — light at 50%, aggressive at 70%, summary-only at 90%. (Phase C)
5. **Cross-session output recycling** — persistent compressed cache that survives session boundaries. (Phase C)
6. **Compression integrity scoring** — honest "we dropped X% of structural detail" signal so users know when summaries hide answers. (Phase C)

These aren't features. They're **engineering bets** — research-grade approaches that, if shipped, give Sipcode a moat that doesn't depend on first-mover advantage or marketing spend.

---

## What this means for every decision from here

Use this checklist for every product/feature decision:

- [ ] Does it move us toward being **the best token saver**, not just the best observatory?
- [ ] Does it work toward **multi-agent universality**, or does it lock us into Claude Code only?
- [ ] Does it use **a latest-technology approach** (AST, semantic, predictive), or is it a heuristic filter we could have built in 2024?
- [ ] Does it preserve **honest numbers** (no marketing-grade claims)?
- [ ] Does it preserve **engineering rigor** (tests, pure runners, privacy contract)?
- [ ] Does it serve the **real indie dev** who feels the cost themselves?

A decision that fails ANY of these checks is the wrong decision for Sipcode.

---

## The current state vs. the North Star

**Where we are today (2026-05-22, v1.2.3):**

- ✅ Items 1–5 of the dream are shipped and working.
- ⚠️ Item 6 (best token saver, multi-agent) is partially started:
  - 62.6% measured savings on the benchmark — real, but requires opt-in installs
  - Cursor adapter shipped (partial — config injection only)
  - No tool-output proxy yet (RTK does this; we don't)
  - No AST-aware compression yet
  - No multi-agent transcript parsing beyond Claude Code yet

**Where we are committed to going (next 4 weeks):**

- Phase A (week 1): Parity proxy ships. RTK is matched on tool-output filtering. v1.3.0.
- Phase B (weeks 2–4): AST-aware semantic compression. Symbol-level reads. Read-once cache enforced. **Sipcode is now MEASURABLY the better optimizer on code-heavy workloads.** v1.4.0.

**Where we are committed to going (next 3 months):**

- Phase C (~v2.0): Predictive, adaptive, cross-session. The moat.
- Codex + full Cursor transcript parsing. The second agent shipped.

**Where we are committed to going (next 6–12 months):**

- Multi-agent: Gemini CLI, Aider, OpenCode all supported.
- The Sipcode Index — quarterly published savings benchmark across all coding agents. Becomes the cited source.

---

## A short version, for when this doc is too long to read

**Sipcode is being built to be the best token-saving tool for every AI coding agent — measurable, reproducible, honest, and built with the latest semantic compression technology rather than heuristic line filters. It launches on Claude Code first because that's where the maker's pain lives, but the ultimate target is universal.**

If a decision doesn't advance this, don't make it.
