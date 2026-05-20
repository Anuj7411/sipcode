# Sipcode — Privacy

> Local-first, zero-telemetry, asserted by a test.

Sipcode is a CLI that reads your machine and writes to your machine. it does not phone home. this document spells out what that means, what it does NOT cover, and where the assertion lives in source.

## What sipcode does NOT do

- no analytics. no event pings. no error reporting service.
- no telemetry. not even a "first run, opt out anytime" kind. nothing.
- no signup. no account. no signed-in mode. no API key prompt.
- no auto-update check, no version ping, no usage counter.
- no background daemon. sipcode runs only when you run a command and exits when it's done.

## What sipcode reads

local files only:

- **`~/.claude/projects/<hash>/*.jsonl`** — claude code's own session transcripts, which it already writes to your machine. `sipcode why`, `stats`, `receipt`, `benchmark` parse these read-only.
- **your repo's source files** — for `manifest`, `score`, `init`. tree-sitter does the parsing in-process.
- **git history (via local `git`)** — for hot-files and change-frequency. invokes the `git` binary on disk via the standard child-process API.
- **the pricing file shipped in the npm package** — `src/lib/pricing/*.json`. ships with each release. never fetched.

## What sipcode writes

every write is triggered by a command you ran. no background writes, no opportunistic writes.

- **`.sipcode/` artifacts in your repo** — manifest, receipts (HTML + PNG), stats HTML, badge JSON, score HTML, benchmark HTML.
- **one named sub-block in your `CLAUDE.md`** — between recognizable markers. `sipcode rules --uninstall` reverses it byte-identically.
- **optional entries in `~/.claude/settings.json`** — ONLY when you run `sipcode hygiene --install`. never otherwise. `--uninstall` removes them.
- **optional hook scripts at `~/.claude/hooks/sipcode-*.mjs`** — same gate. these scripts also run zero-network; the privacy guard test scans them too.
- **the receipt PNG is copied to your system clipboard** — ONLY when you run `sipcode receipt`, never silently. via the OS's standard clipboard tool, locally.

## What sipcode never does without you running a command

touches nothing on disk. there is no daemon, no installed service, no startup item. `npm install -g @sipcode/cli` puts a binary on your path and that is it.

## The asserted property

the "no network" guarantee is not a footer promise — it is a static property of the codebase, enforced by `tests/privacy/no-network.test.ts`. that test scans every typescript file under `src/` and fails the build if it finds:

- a runtime import of `node:http`, `node:https`, `node:net`, `node:dgram`, `node:tls`, or `node:dns`.
- a top-level `fetch(`, `new XMLHttpRequest`, or `new WebSocket(`.
- the same patterns inside `src/modules/hygiene/hookScript.ts`, which generates scripts that run outside the main process.

type-only imports (`import type { Server } from "node:http"`) are erased at compile time and are allowed. nothing else is.

if this test fails on a release tag, **that release violates the privacy claim**. open an issue immediately at https://github.com/Anuj7411/sipcode/issues.

every command file in `src/commands/` also imports a marker constant `ASSERT_NO_NETWORK` from `src/lib/privacy.ts`. it has no runtime effect — it is a contract a future contributor sees at the top of the file when they consider adding a fetch call.

## Honest scope

the guarantee covers **sipcode's own code paths**. it does not extend to third-party libraries (chalk, commander, prompts, etc.), to claude code itself, or to your shell / OS / editor. we publish the test and the source so you can re-verify.

## Future telemetry

when (if) hosted analytics ship in a future version, they will be:

- **explicit opt-in** — via `sipcode link` or similar. never default-on.
- **quarantined** — all network IO will live in a separate `src/modules/cloud/` directory, clearly excluded from this privacy guarantee.
- **announced** — you'll see a clear notification on first install of the version that introduces it.

the privacy guard test is the gate. weakening it requires updating this document and shipping a major version. that is not security theater; that is a contract.
