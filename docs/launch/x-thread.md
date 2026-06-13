# X (Twitter) launch thread — Sipcode v1.6.11

> Copy-paste each tweet (numbered) as a reply chain on launch day. Limit per tweet: 280 chars. Embed images/code blocks where noted.

---

## 1/9 (the hook)

I was burning my Claude Code Max plan in 2 hours.

Not because I was working that hard. Because my context was rotting: stale reads, duplicate file fetches, and a model that started losing the thread.

So I built Sipcode. Open source. MIT. Available now.

`npm i -g sipcode`

---

## 2/9 (the differentiator — keep this above the fold)

Most token tools just truncate output.

Sipcode keeps your context clean so Claude gives the right answer. Token savings prove it works — they aren't the pitch.

The proof number, anyone can run:
`npx sipcode benchmark` → 62.6% median savings on a locked 20-task corpus.

---

## 3/9 (what's inside)

Four reliability features RTK and friends do not ship:

- Drift detector — silent unless your context bloats vs your baseline
- Re-read dedup — refuses to reload files already in your context
- Integrity scoring — every rewrite tells you how much signal it kept
- AST-aware reads — returns only the symbol Claude searched for

---

## 4/9 (the honesty line)

I do not claim Sipcode stops hallucinations. LLMs hallucinate.

What I claim: cleaner context reduces drift-driven errors. Anthropic's own research found a 29% quality lift from editing stale context. Sipcode is the tool that makes that lift accessible to individual devs.

---

## 5/9 (the proof block — embed a screenshot of the table)

The 20-task benchmark is in the repo. Same prompts, two recorded sessions per task, real Anthropic usage. Total saved across the corpus: 3.57M tokens, ~$67.

You don't have to take my word for it:
`npx sipcode benchmark`

---

## 6/9 (what's in Claude Desktop)

15 MCP tools land in Claude Desktop. Two new ones I shipped this week:

- `get_today_summary` — ask "how am I doing today?" in chat
- `forecast_monthly_spend` — ask "how much will I spend this month?"

Adaptive 30/14/7/3 day baselines. Confidence bands. No SDK, no account.

---

## 7/9 (the next step)

Coming in v2 (committed, not vapor):

- Predictive context — Sipcode reads your git co-edit history, pre-summarizes the next file Claude will probably need
- Cross-session hygiene — your context stays clean across days, not just sessions

RTK is stateless. We are not.

---

## 8/9 (the install)

Three steps, ~60 seconds:

```
npm i -g sipcode
sipcode proxy --install
sipcode why    # audit your last Claude Code session
```

Site: https://anuj7411.github.io/sipcode/
Repo: https://github.com/Anuj7411/sipcode

---

## 9/9 (the founder note)

Indie dev, building in public. If Sipcode saves you tokens, the repo is open and the issues are open.

If you have a session where Sipcode does NOT help, I want to know. Send the transcript or run `sipcode why --json` and DM me.

#ClaudeCode #AI #DevTools

---

## Reply-game prep (have these ready in your notes app)

**"How is this different from RTK?"**
> Coverage parity on Bash. Beyond that: native-tool layer (Read/Grep/Glob), re-read dedup, drift detector, integrity scoring, AST-aware reads. RTK is regex-based and stateless. Sipcode is stateful per session.

**"Does this work with Cursor?"**
> Partial. Config injection works on Cursor today. Full transcript parsing for Cursor sessions lands in v2.

**"Show me a number I can verify."**
> `npx sipcode benchmark` runs the locked 20-task corpus on your machine. Median 62.6%. Range 37.4%–80.6%. The transcripts are in the repo.

**"Will this break my workflow?"**
> Every rewrite is non-destructive. The hook degrades to a no-op on any error. If something breaks, `sipcode proxy --uninstall` removes it in one command. Tests gate every release (1247 passing on v1.6.11).
