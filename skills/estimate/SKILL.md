---
description: Predict the dollar cost of a coding task across Opus 4.7, Sonnet 4.6, and Haiku 4.5 BEFORE the user runs it. Pure heuristic + historical-anchor math, zero LLM calls. Use when the user asks "how much will X cost?", "is this task worth doing on Opus?", "estimate the refactor", or any pre-flight pricing question.
---

# Sipcode — Estimate (pre-flight cost prediction)

Call the `sipcode:estimate_task_cost` MCP tool with:
- `task`: natural-language task description (≥3 chars). Example: `"refactor the auth pipeline across 6 files"`.
- `cwd`: absolute path to the project root the task will run in. If the user didn't specify a directory, ask before calling.

The tool returns per-model dollar predictions with a confidence band.

When presenting:
- Show all three models (Opus / Sonnet / Haiku) side-by-side, not just the most expensive.
- Surface the confidence band — if it's wide, say so honestly. If the tool reports `confidence: "low"` because no past sessions matched this complexity tier, mention that the estimate is heuristic-only.
- Make a model recommendation grounded in the cost spread. If Haiku is within ~10% of Sonnet for the task, recommend Haiku. If the task complexity is high (5+ files), Opus is usually worth the cost.
- Never invent precision. Round to whole cents unless the estimate is sub-$0.10.
