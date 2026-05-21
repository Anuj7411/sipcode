# Sipcode Engineering Pipeline

> The gates every change passes through before it reaches users.
> **Last updated:** 2026-05-21 (introduced after the v1.1.0–v1.1.5 bug streak)

---

## Why this exists

Between v1.1.0 and v1.1.5, we shipped 5 patches in 24 hours, each fixing a bug introduced by the previous. **Every single one of those bugs passed `npm test` locally.** They reached users because there was no gate between "tests pass" and "published to npm."

This document defines the gates. **Every change ships through this pipeline. No exceptions.**

---

## The 5 gates

```
LOCAL CHANGE
    │
    ▼
[1] PRE-COMMIT       — typecheck + unit tests run locally before commit
    │
    ▼
[2] PUSH TO MAIN     — git history records the change
    │
    ▼
[3] CI: UNIT TESTS   — 802+ tests pass in clean Linux runner
    │
    ▼
[4] CI: BUILD        — tsc compiles, copy-assets bundles fonts/pricing
    │
    ▼
[5] CI: E2E SMOKE    ★ THE GATE ★
    │                  - npm pack → real tarball
    │                  - install in clean tmpdir
    │                  - verify both binaries run
    │                  - verify sipcode --version matches package.json
    │                  - verify MCP server boots + handshake + 4 tools
    │                  - verify tarball contains fonts + pricing
    │                  - verify privacy guard preserved
    │                  - ANY failure → workflow exits 1, publish blocked
    │
    ▼
[6] CI: PUBLISH      — only if [5] passed. OIDC via Trusted Publishers.
    │
    ▼
[7] CI: SMOKE-VERIFY — post-publish, npm view confirms version landed
                       (retries 6× for CDN propagation)
```

---

## What each gate catches

| Gate | Catches |
|---|---|
| **[1] pre-commit** | Type errors, basic test regressions, syntax errors |
| **[3] CI unit tests** | Logic regressions across the 802-test suite (analyzers, render, validators, etc.) |
| **[4] CI build** | Compilation failures, missing asset copy |
| **[5] CI E2E smoke** ★ | **Tarball shape, binary installation, runtime behavior, MCP server bootability, version reporting, privacy guard preservation** — the bugs unit tests can't see |
| **[6] OIDC publish** | npm auth failures, registry permissions |
| **[7] post-publish verify** | CDN propagation, package reachability |

---

## What broke before gate [5] existed

Each of these reached users:

| Bug | Symptom | Caught by gate [5]? |
|---|---|---|
| v1.0.0 missing pricing JSON in tarball | `sipcode why` crashed on first run | ✅ Yes (`tarball contents` test) |
| v1.0.0 missing fonts in tarball | `sipcode receipt` PNG render failed | ✅ Yes (`tarball contents` test) |
| v1.1.0 hardcoded `SERVER_VERSION = "1.1.0"` | MCP server always claimed to be v1.1.0 | ✅ Yes (`reports the actual package version` test) |
| v1.1.0 `recommend.ts` hardcoded old SKUs | Every estimate recommendation = Sonnet | ✅ Yes (unit test now exists; e2e would also catch via `--help` smoke) |
| v1.1.3–1.1.4 `sipcode-mcp@latest` 404 | Claude Desktop showed "Server disconnected" | ✅ Yes (MCP handshake test would fail) |
| OIDC npm 11.5.1 requirement | Publish step 404 | ✅ Yes (CI itself would fail before publish) |

**5/5 historical bugs would have been caught.**

---

## How to add a new gate

When a class of bug slips through, add a regression test to gate [5] (`tests/e2e/release-smoke.test.ts`) that would have caught it. **Never fix a production bug without also adding the regression test that proves it can't recur.**

Naming convention for regression-guard tests:

```typescript
it("[v1.0.0 bug regression guard] tarball includes pricing JSON", () => {
  expect(existsSync(...)).toBe(true);
});
```

The `[vX.Y.Z bug regression guard]` prefix makes it easy to grep for the history of failures.

---

## Running the gate locally

Before pushing a release-bound commit:

```bash
# 1. Unit tests (fast, runs all 802 tests)
npm test

# 2. Build (verify tsc + asset copy succeed)
npm run build

# 3. E2E smoke (slow, ~30s — does the full pack + install + verify cycle)
npm run test:e2e
```

If all three pass locally, your change will pass CI. If `test:e2e` fails locally, **do NOT push the tag** — the CI gate will fail too and you'll just get a failure email.

---

## What `test:e2e` does (in plain English)

1. **`npm pack`** — produces the exact `sipcode-X.Y.Z.tgz` that would be uploaded to npm.
2. **`mkdtemp`** — creates a brand-new empty directory.
3. **`npm install <tarball>`** — installs the tarball into that directory the same way a real user's `npm install -g` would.
4. **Verifies file structure**:
   - `dist/cli.js`, `dist/mcp/server.js`, both bin shims exist
   - `dist/lib/pricing/2026-05-01.json` is present
   - `dist/modules/receipt/assets/fonts/*.ttf` are present
   - `tests/`, `_export/`, `.git/` are NOT present
5. **Runs `sipcode --version`** and asserts the output matches `package.json` version.
6. **Runs `sipcode --help`** and asserts every documented command is listed.
7. **Spawns `sipcode-mcp`** as a child process, performs the MCP JSON-RPC `initialize` + `tools/list` handshake, asserts:
   - Stderr contains `[sipcode-mcp] connected (sipcode vX.Y.Z, 4 tools)` with the real version
   - Exactly 4 tools register with the expected names
   - Each tool has a description (≥20 chars) and an input schema
8. **Scans compiled `dist/*.js`** for forbidden network imports (`node:http`, `node:https`, etc.), excluding the allowlisted `lib/fs.js` seam.

Total runtime: ~25 seconds on a clean Linux runner.

---

## Promotion path (current — single tag)

Currently we publish directly to `@latest` on every tag push. **This is acceptable because gate [5] is now the safety net.**

If we ever start seeing bugs slip through gate [5] (because they're environmental — only show up on certain OSs, only with certain npm versions, only after CDN propagation, etc.), we should add a `@next` staging tag with a 24h soak before promoting to `@latest`. **For now, we don't.**

---

## What the user does (zero steps)

This pipeline runs entirely in CI. The user does nothing — just normal `git push --tags`. The pipeline either succeeds (silent, package live) or fails (the user gets one failure email with a specific reason, no mystery).

**Promise:** if CI is green for a tag, the published package works.
