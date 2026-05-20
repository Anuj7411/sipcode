# Sipcode Benchmark — Methodology

> the document the press should quote.

Sipcode publishes a reproducible benchmark suite — not a marketing claim, a runnable test you can verify yourself in under 30 seconds:

```bash
git clone https://github.com/Anuj7411/sipcode.git
cd sipcode
npm install
npx sipcode benchmark
```

The number that prints is the same one quoted in the README, computed the same way, on the same locked corpus.

---

## What we measure

For each task we measure five things per "flavor" (baseline and optimized):

- **total tokens** — `input_tokens + output_tokens + cache_read_input_tokens + cache_creation_input_tokens`, summed across every assistant turn in the transcript.
- **estimated cost** — `total_tokens × pricing_per_mtok` against the pricing file shipped with the release (`src/lib/pricing/<date>.json`). Always cite the pricing file's `as_of` date.
- **output ratio** — `output_tokens / total_tokens`, expressed as a percentage. Surfaces the 0.6% study finding.
- **distinct file reads** — count of unique paths surfaced as `Read` tool calls.
- **duplicate reads** — count of paths read more than once in the same session.

The **per-task savings** number is then:

```
savings_pct = (baseline_total - optimized_total) / baseline_total
```

We also compute **per-module attribution** — how many of the saved tokens came from S001 (the smart manifest letting the agent skip exploration), S021 (diff-output enforcement on file edits), and S030 (the read-once cache substituting summaries for re-reads). Attribution sums to 100% of saved tokens; individual percentages reflect how the savings broke down on this corpus.

## What we do not measure

- **task correctness.** SWE-Bench and friends already do this well. Sipcode's claim is "you can do the same task for fewer tokens" — not "Sipcode makes the agent smarter."
- **wall-clock time.** Token economy isn't latency economy; conflating them is dishonest.
- **model quality.** We don't grade response quality. We grade token count.

## How the corpus was built

10 tasks (BT001 through BT010) covering refactor, debug, feature, test, review, docs, migration, onboarding, optimization, and cross-file bugfix work — the workflow categories that actually drive Claude Code spend in our user research.

Each task ships:

```
benchmark/corpus/BTxxx/
  task.yml                       # locked metadata: id, title, category, difficulty
  prompt.md                      # the natural-language prompt the agent received
  expected.md                    # human-readable acceptance criteria
  baseline-transcript.jsonl      # a captured "Sipcode not active" session
  optimized-transcript.jsonl     # a captured "Sipcode active" session
  repo/                          # the synthetic project the agent worked on
```

Both transcripts use Claude Code's actual `.jsonl` format and pass Sipcode's own zod schema validator (the same parser that powers `sipcode why`). The baseline shows realistic exploration-heavy behavior: the agent re-reads files, holds large context, writes verbose responses, doesn't have a manifest. The optimized shows a session with the Sipcode manifest already in context, diff-format edits, and the read-once cache simulated (the agent's second read of a previously-read path is replaced by a one-line summary).

The transcripts were captured against Claude Opus 4 (`claude-opus-4-7`) and locked at the time of release. They are not regenerated on every benchmark run — that would be non-reproducible because model versions, sampling, and pricing drift over time. **Reproducibility means the same input produces the same output.**

## How we aggregate

The **headline number** is the **median** of the per-task savings percentages — not the mean.

Median is more honest than mean for this kind of corpus because:

- Mean is skewed by tasks like BT001 (large refactor, high dup-read win) and BT006 (small docs task, low ceiling).
- Median tells you the savings you should expect on a *typical* task, not the average lifted by outliers.

The total dollar amount saved is computed by summing baseline costs minus optimized costs across all 10 tasks at current pricing.

## How to reproduce

1. Clone the Sipcode repo at the tagged release.
2. `npm install` (no native bindings outside dev deps).
3. `npx sipcode benchmark` (use `--json` for machine-readable output, `--html` for a shareable report).

The corpus and pricing files are version-controlled. The aggregation logic is pure (no `clock.now()`, no `Math.random()`, no network calls). Two runs on the same commit always produce byte-identical JSON and HTML output. Run the benchmark once, run it again, diff the JSON — you'll get an empty diff.

## How to challenge a number

If a published Sipcode savings claim doesn't match what you measure on your own sessions, the gap is one of three things:

1. **Your sessions don't look like the corpus.** Pure docs / chat sessions look like BT006 (~37% savings); cross-file refactors look like BT001 (~62%). If your team mostly does small Q&A, you'll see less. The corpus is a fair sample of agent workflows — not a guarantee for any individual session.
2. **You haven't installed the full stack.** The 62% number assumes manifest + output compression + read-once cache are all active. With only the manifest (no rules, no hygiene hooks), expect ~32% of the total — see the per-module attribution.
3. **You found a real divergence.** Open an issue at https://github.com/Anuj7411/sipcode/issues with your `sipcode why --json` output. We refresh the corpus quarterly; persuasive counter-examples land in the next refresh.

## What we commit to

- **Corpus version stability.** BT001 through BT010 never get renamed or renumbered. New tasks are appended (BT011+) when the corpus refreshes.
- **Pricing transparency.** Every release ships with a dated pricing file. Receipts and benchmarks always cite which one they used.
- **Honest variance.** Whatever the suite says — 28%, 62%, 51% — is what ships in the README. We don't tune the headline.
- **Quarterly refresh.** The corpus is reviewed every quarter for relevance. Community PRs that add credible new tasks (with proper baseline + optimized transcript pairs) get merged.

## License

The corpus, transcripts, methodology, and aggregation logic are MIT-licensed. Fork it, run it on your own setup, publish counter-numbers. We'd rather be wrong publicly than right secretly.
