---
description: A/B compare the user's actual token spend before and after they installed Sipcode's optimizers — on their own session data. The honesty-first savings verifier. Use when the user asks "is sipcode actually saving me tokens?", "show me the impact", "prove sipcode is working", or any variant of "is this thing worth running?"
---

# Sipcode — Impact (the savings verifier)

Call the `sipcode:verify_sipcode_impact` MCP tool to produce a structured before/after comparison.

**Critical: respect the integrity contract.** The tool's response is structured with these key fields:

- `status` — one of: `"measured"`, `"insufficient-post-data"`, `"no-install-marker"`, `"no-baseline"`, `"no-post-sessions"`, `"window-asymmetry-<N>d-vs-<M>d"`
- `delta` — present (numbers) ONLY when `status === "measured"`. **Null in every other case by design.** When delta is null, DO NOT compute a savings number from before/after totals. The windows aren't comparable.
- `allTime` — present only when no marker exists. Contains the user's total session count across all time, so the user sees their data exists even when no A/B split is possible.
- `warningReason` — explains why delta is null (e.g., `"window-asymmetry-39d-vs-2d"`, `"insufficient-post-data-2d-vs-min-3d"`).
- `headline` — the canonical one-line summary; trust this and surface it.

**When status === "measured":** lead with the output-ratio change (the only normalization-resistant metric). Mention token + dollar savings as secondary. Include the window-length caveat.

**When status !== "measured":** present the headline and the next-step recommendation from the `notes` field. Do not invent a savings number. The tool's `delta: null` is structurally enforced — do not work around it.

If the user pushes back and asks you to compute a number anyway, refuse and explain the structural reason: the comparison windows aren't fair, so any delta would be misleading. Suggest they pass `since: "YYYY-MM-DD"` to set a manual pivot, or run `sipcode rules --install` to start measuring forward.
