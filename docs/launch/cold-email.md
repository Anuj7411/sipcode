# Cold email templates — Sipcode v1.6.11

Three variants for three audiences. All under 200 words. Personalized in the first line; the rest is reusable.

---

## Variant A — for dev-tool newsletter curators

> **Subject:** Sipcode — an open-source token optimizer for Claude Code that's actually about reliability
>
> Hi [name],
>
> I saw you covered [their recent issue / tool] — thanks for that, I bookmarked it.
>
> Short pitch: I built an open-source tool called Sipcode that keeps Claude Code's context clean. It rewrites bulky tool calls, dedupes re-reads, and warns you when a session starts to drift from your baseline. MIT, zero telemetry.
>
> Reproducible proof: `npx sipcode benchmark` runs a locked 20-task corpus on the reader's machine. 62.6% median token savings. The transcripts are public so the number can be verified.
>
> What's different from RTK (the obvious comparison): drift detector, re-read dedup, integrity scoring, and AST-aware reads — features RTK structurally cannot match because they're stateless and we're stateful per session.
>
> Repo: https://github.com/Anuj7411/sipcode
> Site: https://anuj7411.github.io/sipcode/
>
> Worth a 30-second look? Happy to send the demo flow or hop on a 10-min call.
>
> Thanks,
> Anuj

---

## Variant B — for indie devs who tweet about Claude Code

> **Subject:** Saw your post about [specific Claude Code pain point] — built a tool for that
>
> Hi [name],
>
> Caught your tweet about [specific pain — e.g. "Claude going in circles on big refactors" / "burning the Max plan in 2h" / "context rotting after 20 turns"]. Same problem hit me last month.
>
> I built Sipcode (open source, MIT) to fix exactly that. It keeps Claude's context clean: rewrites bulky tool calls, refuses to reload files Claude already has in context, warns you when your session starts drifting from your baseline. 62.6% measured token savings on a locked benchmark anyone can run: `npx sipcode benchmark`.
>
> Honest disclaimer: it doesn't stop hallucinations (LLMs hallucinate). It reduces drift-driven errors. Anthropic measured a 29% quality lift from cleaner context; Sipcode is the tool that makes that lift accessible to individual devs.
>
> Three-line install:
>
> ```
> npm i -g sipcode
> sipcode proxy --install
> sipcode why
> ```
>
> https://github.com/Anuj7411/sipcode
>
> If it doesn't help your workflow, send me the session and I'll tell you why.
>
> Anuj

---

## Variant C — for AI/LLM podcast hosts

> **Subject:** Sipcode — open-source context engineering for Claude Code (pitching a guest spot)
>
> Hi [host],
>
> Long-time listener of [show] — your [specific episode] on [topic] is what nudged me to build the thing I'm writing about.
>
> I shipped Sipcode (open source, MIT, on npm) last week. It's a token optimizer for Claude Code, but the actual pitch is "context engineering as a category for individual devs." The reliability lane is wide open — enterprise eval has $80M-funded incumbents (Braintrust, LangSmith) but they all need SDK + cloud + team pricing. Sipcode reads the `.jsonl` files Claude Code writes locally. No account. No telemetry.
>
> Three things I think your audience would find interesting:
>
> 1. The drift detector — silent unless your context rots vs your baseline. First version of context-rot detection I've seen in open source.
> 2. Per-rewriter integrity scoring — every truncation tells you how much signal it kept. Pure honesty signal RTK and friends don't ship.
> 3. The 2027 vision: predictive context from git co-edit history, cross-session hygiene. Both committed for v2.
>
> 30-min chat? Happy to demo live.
>
> Repo: https://github.com/Anuj7411/sipcode
>
> Anuj
> @[handle]

---

## Subject-line variants (split-test)

- "open-source token optimizer for Claude Code that's actually about reliability" (60)
- "Sipcode — 62.6% measured token savings + drift detector" (51)
- "Built a thing for context rot in Claude Code" (45)
- "Sipcode — context engineering for individual Claude Code devs" (60)

---

## Targeting list (mix and personalize)

**Newsletter curators**
- TLDR AI
- The Rundown AI
- AI Tidbits
- Last Week in AI
- The Sequence

**Dev-tool roundups**
- Console (console.dev)
- Tools for Developers (Substack)
- StackShare weekly
- Dev.to top of the week curators

**Indie-dev podcasters / streamers**
- The Pragmatic Engineer
- Latent Space (swyx)
- Software Engineering Daily
- Tools and Toys (Pete Brown)

**Reddit (the user already noted Reddit bans their posts — DO NOT post)**

---

## Send schedule

- **Day 0 (launch):** Send Variant A to curators (5–8 emails).
- **Day 0 + 4 hours:** Send Variant B to indie devs who recently posted about context rot / Claude limits (5–10 emails).
- **Day 1 morning:** Send Variant C to podcasters (3–4 emails).
- **Day 3:** Follow up with one-line reminder to any curator who hasn't replied. ONE follow-up only.

---

## Anti-patterns to avoid (per user preferences locked in memory)

- No em-dashes in body copy.
- No "I'm just reaching out" / "I hope this finds you well" / "Following up here."
- No exclamation marks anywhere.
- No fake numbers. The 62.6% is real. The 29% is Anthropic's, cited. Don't invent any others.
- No "revolutionize / transform / disrupt / unleash."
- Single ask per email. One follow-up max.
