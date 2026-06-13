# Sipcode launch kit

Drafted 2026-06-13 for v1.6.11. Copy-paste-ready, anchored on the locked positioning (reliability headline, tokens as proof, two committed v2 features, no overclaiming).

## Files

- [`x-thread.md`](x-thread.md) — 9-tweet X/Twitter thread + reply-game prep
- [`product-hunt.md`](product-hunt.md) — tagline + listing description + first-comment + media plan
- [`cold-email.md`](cold-email.md) — three audience variants + targeting list + send schedule

## Recommended launch sequence

1. **Pre-launch (T-1 day):** Schedule the X thread for posting at the same time as the Product Hunt go-live (PH suggests 12:01am PT). Pre-warm the screenshots referenced in `product-hunt.md` § Gallery.
2. **T-0 (Product Hunt goes live):** Post the X thread first tweet. Pin it. PH posting kicks off.
3. **T-0 + 4 hours:** Send the Cold Email Variant A batch to dev-tool curators.
4. **T-0 + 8 hours:** Reply-game on X — answer every reply with one of the prepped responses in `x-thread.md`.
5. **T+1 day:** Cold Email Variant B to indie devs who tweet about context-rot pain. Variant C to podcasters.
6. **T+3 days:** One follow-up to any curator who hasn't replied.
7. **T+7 days:** Run `sipcode impact` on the user's real session history and post the personal A/B result as a follow-up tweet ("after 7 days of dogfooding, here's my actual delta").

## Hard NOs (locked rules — see project_sipcode_positioning.md memory)

- Never claim "Sipcode stops hallucinations." Use "reduces drift-driven errors" and cite Anthropic's 29% quality lift, never claim it as ours.
- Never invent numbers. Only cite: 62.6% measured corpus, 3.57M tokens / $67 saved, 1247 tests, 15 MCP tools, 366,500 heuristic tokens saved.
- No em-dashes. Use commas, colons, periods, or parentheses.
- No "revolutionize / transform / disrupt / unleash / supercharge / crush / blast."
- No exclamation marks in body copy.
- No "not just X but Y" rhythm. No "both X and Y" structures.
- No Reddit posts (Anuj's Reddit accounts get banned).
- No "coming soon" placeholders. Concrete v2 commitments (predictive context, cross-session hygiene) are allowed because they're committed with a one-liner each.

## Numbers cheat sheet (the only numbers to ever cite)

| Claim | Number | Provenance |
|---|---|---|
| Measured corpus token savings | 62.6% median (range 37.4%–80.6%) | `npx sipcode benchmark` on the locked 20-task corpus, reproducible |
| Total tokens saved across the corpus | 3,567,170 | Same benchmark |
| Total dollars saved across the corpus | $67.43 | Same benchmark, priced via the bundled pricing JSON |
| Heuristic per-call savings on the corpus | 144 rewrites, ~366,500 tokens | `sipcode benchmark --vs-rtk` heuristic preview |
| Tests passing on v1.6.11 | 1247 | `npm test` |
| MCP tools | 15 | `[sipcode-mcp] connected (sipcode v1.6.11, 15 tools)` |
| Anthropic's quality lift from cleaner context | +29% (CITED, not measured by us) | Anthropic's context-editing research |

## Personal-anecdote slot (fill in before launch)

Replace `[YOUR PERSONAL DELTA]` in tweets and the PH first-comment with the actual number from your own `sipcode impact` after 7 days of post-install sessions. This is the strongest possible launch claim because it's first-person.
