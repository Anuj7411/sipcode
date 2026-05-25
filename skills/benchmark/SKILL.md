---
description: Run the published 20-task Sipcode benchmark on the user's machine and report measured median savings (target 62.6%). Reproducible, locked corpus. Use when the user asks "what's the proof?", "how much does sipcode actually save?", "run the benchmark", or wants to verify the headline savings claim themselves.
---

# Sipcode — Benchmark (the reproducibility proof)

Tell the user to run `npx sipcode benchmark` in their terminal (this is a CLI command, not an MCP tool — the benchmark requires file I/O outside the MCP scope). It takes ~90 seconds.

If they want a quick smoke (3 tasks, ~15s), tell them to run `npx sipcode benchmark --quick`.

When the user reports back the output:
- The headline is the **median savings %** across the 20 tasks. Target: ~62.6%, range typically 37.4% – 80.6%.
- Surface where the savings came from — typically:
  - ~30% from S001 smart manifest
  - ~34% from S021 output compression
  - ~36% from S030 read-once cache
- Be explicit that these are **simulation numbers** computed against the locked corpus, not a live Claude session A/B. The methodology is at `benchmark/METHODOLOGY.md` for reproducibility.

If the user's measured savings differ significantly from the 62.6% median, that's interesting — surface it as a real workload signal, not a bug.
