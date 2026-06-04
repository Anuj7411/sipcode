# Versioning policy

> **TL;DR: stay on `1.x`, bump `patch` for almost everything, let the patch number grow large.** Iterate without version anxiety.

Sipcode follows the same shape as Claude Code itself: a **stable major**, with a
patch number that just keeps climbing (`1.6.1`, `1.6.2`, … `1.6.40`, …). A big
patch number is normal and healthy — it signals steady iteration, not instability.

## The rule

| Bump | When | Command |
|---|---|---|
| **patch** (default) | New rewriters, new MCP tools, fixes, docs, perf — **anything non-breaking**. This is the default for ~every release. | `npm version patch` |
| **minor** | Rare. A deliberate, announced milestone you want a round marker for (e.g. a whole new subsystem). Don't reach for this just because you shipped a feature. | `npm version minor` |
| **major** | A real breaking change to the CLI flags, MCP tool contract, or on-disk formats. | `npm version major` |

**Default to `patch`.** If you're unsure, it's a patch. The point of this policy
is to remove the "is this a minor or a patch?" decision entirely — that decision
was creating churn (1.4 → 1.5 → 1.6 in a single day) for no user benefit.

## Why not minor-per-feature?

npm requires every publish to be a unique, higher semver — so we *must* increment
something every release. The only question is which digit. Bumping `minor` for each
feature inflates the headline version fast and creates false pressure ("are we
really on 1.9 already?"). Growing `patch` instead keeps the version calm while
still being monotonic. Same release cadence, zero version tension.

## Mechanics (unchanged)

Releases still ship through CI on a tag:

```bash
# bump both package.json AND .claude-plugin/plugin.json to the same version, then:
git add -A && git commit -m "…"
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

Keep `package.json` and `.claude-plugin/plugin.json` in lockstep — the release-smoke
test asserts the served version matches `package.json`.
