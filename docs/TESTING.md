# Sipcode Testing Guide

> The canonical reference for every test category, what runs when, and the regression-guard pattern for permanently fixing every class of bug.

**Tests on this branch:** 814 passing across 5 categories. **Bugs caught & permanently guarded against:** 6.

---

## 🔁 Who runs what — the TL;DR

You don't run anything manually for a release. **Everything is automated.** Here's the truth table:

| Test category | Where it runs | When | Your action |
|---|---|---|---|
| Unit tests | GitHub Actions CI | Every push to `main`, every tag | None — automatic |
| Build (typecheck + asset copy) | GitHub Actions CI | Every push, every tag | None — automatic |
| **E2E release smoke** ★ | GitHub Actions CI | Every tag (`v*.*.*`) | None — automatic. **Blocks publish if it fails.** |
| Privacy guard | GitHub Actions CI (in unit tests) | Every push, every tag | None — automatic |
| Post-publish CDN verify | GitHub Actions CI | After successful publish | None — automatic, retries 6× |

Optional local runs (if you want extra confidence before pushing):

| Command | Runtime | What it covers |
|---|---|---|
| `npm test` | ~15 sec | The 802 unit tests + integration tests |
| `npm run test:e2e` | ~25 sec | The 12 release-gate smoke tests (full pack + install + verify) |
| `npm run build` | ~5 sec | Typecheck + asset copy verification |

You don't need to run any of these. **Pushing a tag does it all in CI.**

---

## 📋 The 5 test categories in detail

### 1. Unit tests (`tests/**/*.test.ts`)

**What:** 802 tests covering pure-runner logic — analyzers, renderers, validators, formatters, error handling, schema parsing.

**When:** Every push and tag. Runs in `npm test`.

**What it catches:** Logic regressions, type errors, broken pure functions, wrong outputs for given inputs.

**What it can't catch:** Anything that requires the package to be packed, installed, or executed as a real binary. (That's category 3.)

**Run locally:** `npm test`

**Coverage target:** ≥85% on every shipped module. Current: 802/802 passing.

---

### 2. Integration tests (`tests/integration/*.test.ts`)

**What:** End-to-end tests that drive a full command (`runWhy`, `runManifest`, etc.) through `InMemoryFs` / `FakeGit` / `FakeClipboard` seams. Tests the full pipeline without real file-system or network.

**When:** Part of `npm test`. Runs on every push.

**What it catches:** Wiring bugs, command-flag handling, multi-module orchestration regressions.

**Run locally:** Implicit in `npm test`.

---

### 3. E2E release smoke test (`tests/e2e/release-smoke.test.ts`) ★ THE RELEASE GATE

**What:** 12 tests that simulate a REAL user install:
1. `npm pack` → produces the exact tarball that would be published
2. Install that tarball in a clean temp directory
3. Verify every shipped artifact + every documented behavior

**When:** Excluded from `npm test` (too slow). Runs via `npm run test:e2e` locally, and **as a blocking step in CI before every publish** (see `.github/workflows/release.yml`).

**What it catches:**

| Assertion | Bug class it guards against |
|---|---|
| Tarball is 100KB–10MB | Build broken in catastrophic ways |
| Both binaries install | Bin entry missing from `package.json` |
| `dist/mcp/server.js` present | MCP server not compiled |
| Pricing JSON in tarball | **v1.0.0 bug** — missing assets |
| Fonts in tarball | **v1.0.0 bug** — receipt PNG crashes |
| `tests/` NOT in tarball | Privacy/size leak |
| `sipcode --version` matches `package.json` | **v1.0.0–v1.1.5 bug** — hardcoded SERVER_VERSION |
| `sipcode --help` lists all 10 commands | Missing command registration |
| `sipcode-mcp` boots cleanly | **v1.1.3 @latest bug** — config didn't actually work |
| MCP handshake completes + 4 tools register | **v1.1.3 @latest bug** — would catch this with the actual MCP protocol |
| Each tool has description + schema | Tool definition regression |
| No `node:http/https/net/dns` in compiled `dist/` | Privacy violation |

**Run locally:** `npm run test:e2e`

**Runtime:** ~25 seconds (because it does a real `npm pack` + `npm install`).

**⭐ This is the gate that turns "test passes" into "ships safely."** Any failure here blocks the publish entirely. No bug in any of the above classes can reach users.

---

### 4. Privacy guard (`tests/privacy/no-network.test.ts`)

**What:** Static-analysis test that scans every `src/**/*.ts` file for forbidden network primitives (`node:http`, `node:https`, `node:net`, `node:dgram`, `node:tls`, `node:dns`, runtime `fetch()`, `XMLHttpRequest`, `WebSocket`).

**When:** Part of `npm test`. Runs on every push.

**What it catches:** Anyone (including future-me) ever trying to add a network call to a core code path. Privacy contract is **engineered**, not just promised.

**Allowlist:** `src/lib/fs.ts` (the FileSystem seam) — explicitly documented in the test file. Currently empty even for the allowlist.

**Plus:** E2E smoke test #12 catches the same property in the **compiled** `dist/` — so even if someone bypasses the source check, the build-time check catches them.

**Run locally:** Implicit in `npm test`. Or directly: `npx vitest run tests/privacy/no-network.test.ts`

---

### 5. Post-publish CDN verify (`.github/workflows/release.yml`, last step)

**What:** After `npm publish` succeeds, run `npm view sipcode@<version> version` up to 6 times over 60 seconds. Confirms the package actually reached the registry CDN (not just submitted).

**When:** Automatic in CI after publish.

**What it catches:** Publish appears to succeed but version never propagates (npm internal issue, registry hiccup). Now retries instead of false-failing.

**Why this matters:** v1.1.2's workflow flagged "FAILURE" because the smoke ran 5 seconds after publish and the CDN took 30 seconds. The package was actually fine. New retry loop prevents that false alarm.

---

## 🛡️ The regression-guard pattern

**Rule:** When a production bug ships, the fix has TWO parts:
1. Fix the bug
2. Add a test to `tests/e2e/release-smoke.test.ts` (or a unit test if the bug is logic-only) that would have caught it

**Naming convention:**
```typescript
it("[vX.Y.Z bug regression guard] descriptive name", () => { ... });
```

Why the prefix:
- Easy to grep history: `grep -r "regression guard" tests/`
- Documents the cost of each bug
- Forces honesty about the bug instead of quietly fixing it

**Example from `release-smoke.test.ts`:**
```typescript
it("[v1.0.0 bug regression guard] includes pricing JSON", () => {
  expect(existsSync(path.join(pkgRoot, "dist", "lib", "pricing", "2026-05-01.json"))).toBe(true);
});

it("[SERVER_VERSION hardcoded bug regression guard] sipcode-mcp boots and reports the actual package version", async () => {
  const r = await mcpHandshake(sipcodeMcpBin);
  expect(r.startupLog).toContain(`v${EXPECTED_VERSION}`);
});
```

---

## 📜 Bug postmortems — historical bugs and the regression guards added

Each entry below is a bug that DID reach users, the regression-guard test we added to ensure it can never recur, and the line number where it lives.

### v1.0.0 — missing assets in published tarball

**Symptom:** `sipcode why` crashed because pricing JSON wasn't in `dist/`. `sipcode receipt` crashed because fonts weren't bundled.

**Root cause:** `tsc` compiles `.ts` to `.js` but doesn't copy non-TS assets. `scripts/copy-assets.mjs` existed but wasn't part of the build step.

**Fix in code:** Added `npm run build` to chain `tsc && node scripts/copy-assets.mjs`.

**Regression guard:** `tests/e2e/release-smoke.test.ts`:
- `"includes pricing JSON [v1.0.0 bug regression guard]"`
- `"includes receipt fonts [v1.0.0 bug regression guard]"`

---

### v1.0.0 → v1.1.4 — hardcoded `SERVER_VERSION = "1.1.0"` in MCP server

**Symptom:** MCP server always reported `v1.1.0` regardless of actual published version. Confusing for debugging, made it impossible to tell which version was running.

**Root cause:** When I first wrote `src/mcp/server.ts`, I hardcoded `SERVER_VERSION = "1.1.0"` as a literal. Forgot to make it dynamic.

**Fix in code:** Use ESM-safe `readFileSync(import.meta.url + "../../package.json")` to read the version at runtime.

**Regression guard:** `tests/e2e/release-smoke.test.ts`:
- `"boots and reports the actual package version [SERVER_VERSION hardcoded bug regression guard]"`

---

### v1.1.0 — `recommend.ts` not updated after `PREDICTION_MODELS` change

**Symptom:** Every `sipcode estimate` call returned "use Sonnet" regardless of task complexity.

**Root cause:** Changed `PREDICTION_MODELS` from `claude-opus-4` to `claude-opus-4-7` etc., but `src/modules/estimate/recommend.ts` still hardcoded the old base SKUs in `predictions.find()` calls. The find returned `undefined` and fell back to the default ("sonnet").

**Fix in code:** Update `recommend.ts` to use the same SKU strings as `PREDICTION_MODELS`.

**Regression guard:** `tests/modules/estimate/recommend.test.ts` — extended the "model selection truth table" tests to cover all complexity tiers explicitly. If `recommend.ts` ever silently falls back, these tests fail.

---

### v1.1.3–v1.1.4 — `sipcode-mcp@latest` 404 (the @latest bug)

**Symptom:** Claude Desktop showed "MCP sipcode: Server disconnected" after restart. Cause: my README told users to use `"args": ["-y", "sipcode-mcp@latest"]` in their `claude_desktop_config.json`. npx interpreted this as "find a package called `sipcode-mcp` at version `latest`" — but **`sipcode-mcp` is a binary, not a package on npm**. The correct invocation is `"args": ["-y", "-p", "sipcode", "sipcode-mcp"]`.

**Root cause:** I documented a config I never actually tested in a clean environment. It happened to work for users who had `npm install -g sipcode` already because npx found the binary on PATH first.

**Fix in code:** README + docs/MCP.md updated with the two correct patterns:
- Pattern A (recommended): `"command": "cmd", "args": ["/c", "sipcode-mcp"]` (requires global install)
- Pattern B: `"command": "cmd", "args": ["/c", "npx", "-y", "-p", "sipcode", "sipcode-mcp"]` (no install)

**Regression guard:** `tests/e2e/release-smoke.test.ts`:
- `"sipcode-mcp boots and reports the actual package version"`
- `"registers exactly the 4 documented MCP tools"`

These run the actual binary that the actual config patterns spawn. If the binary doesn't boot, the gate fails before publish.

---

### v1.1.0 publish — npm 10.x bypassing OIDC

**Symptom:** Tag pushed, workflow ran, `npm publish` returned 404 misleadingly.

**Root cause:** OIDC publishing requires npm CLI ≥ 11.5.1. Node 22's bundled npm is 10.x. The publish step silently fell back to token auth (which we didn't have configured for OIDC users) and 404'd.

**Fix in code:** `release.yml` step `upgrade npm to OIDC-capable version (>=11.5.1) via corepack` runs `corepack enable && corepack prepare npm@latest --activate` before the publish.

**Regression guard:** The CI workflow itself is the guard. If the upgrade step ever breaks, publish fails loudly with the right error.

---

### v1.1.2 — CI smoke-test false positive (CDN propagation lag)

**Symptom:** Workflow reported "FAILURE" but the package was actually published. Smoke step ran 5 seconds after publish; npm CDN takes 15-45 seconds.

**Root cause:** Bad timing assumption.

**Fix in code:** `release.yml` smoke-test step now retries 6× over 60 seconds:
```bash
for i in 1 2 3 4 5 6; do
  OUT="$(npm view ... 2>/dev/null)"
  if [ -n "$OUT" ]; then echo "found"; exit 0; fi
  sleep 10
done
exit 1
```

**Regression guard:** Built into the workflow itself.

---

## 🆕 How to add a new test category

If you find yourself wanting to add tests that don't fit the existing 5 categories:

1. **Decide if it's blocking or informational.** Blocking = should fail CI. Informational = output for review.
2. **Choose where it lives:**
   - Pure logic test → `tests/modules/<module>/<name>.test.ts`
   - Multi-module integration → `tests/integration/<name>.integration.test.ts`
   - Tests a property of the SHIPPED package → `tests/e2e/<name>.test.ts`
   - Static property of the source code → `tests/<property>/<name>.test.ts`
3. **Update this document** with the new category, what it catches, and when it runs.

---

## 🎯 Promise of this pipeline

If `gh workflow list` says all checks are green on a tag, the published package:
- Installs correctly
- Has all required assets
- Reports the correct version
- Has a working MCP server with all 4 tools
- Has no network calls in core code paths
- Is reachable on the npm CDN

If you ever see a published Sipcode version that violates any of these, **the gate has a hole.** File an issue, write a regression-guard test, ship the fix. **Each bug only happens once.**
