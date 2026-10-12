# Sipcode Codex plugin + `sipcode regress` (v1.7.2) design

**Status:** approved by the maintainer (four skills, `sipcode regress`, GitHub marketplace now, public directory later). This document fills in the details and records every decision taken while grounding the design in the real code, the prototype and the official Codex plugin docs.
**Branch:** `codex-plugin` (from `main` at 5f2c9df, v1.7.1). **Ships as:** v1.7.2 (patch).
**Plan:** `docs/superpowers/plans/2026-10-12-codex-plugin.md`.

---

## 1. Goal

A "Sipcode" plugin for Codex (the ChatGPT desktop app and the Codex CLI) lets a user ask four questions in plain words and get answers computed by the published `sipcode` CLI from their own local logs:

| # | The user asks | The skill runs |
|---|---|---|
| 1 | "How much did I spend on Codex today / this month?" | `sipcode today\|forecast\|stats --agent codex --json` |
| 2 | "How close am I to my limit? Did it shrink?" | `sipcode limits --json` (`--since all` for history) |
| 3 | "Why was my last session so expensive?" | `sipcode why --agent codex --json` |
| 4 | "Did Codex / Claude Code get worse after an update?" | `sipcode regress --bug-report` (new command) |

Question 4 needs a new command. `sipcode regress` ports the prototype detector (branch `regress-prototype`, `prototypes/regress/regress.mjs`) into Sipcode, rebuilt on Sipcode's verified loaders: Claude Code request merge (`message.id` + `requestId`), cross-file dedupe, Codex token accounting and the account-wide limit periods of `sipcode limits`.

## 2. Non-goals

- No MCP tool for `regress` in this release (decision in section 7). The MCP tool count stays 16.
- No local stdio MCP server, lifecycle hooks or apps in the plugin: they would make it ineligible for OpenAI's public plugin directory ([submission rules](https://developers.openai.com/plugins/deploy/submission)).
- No bundled scripts in the plugin. The prototype shipped `scripts/regress.mjs` inside the skill; the skills now call the published CLI only.
- The skills never read, grep or summarise raw logs, and never install anything.
- No new regression checks beyond the prototype's six, and no catalog entries beyond R1 to R5.
- No `--since`, `--here`, `--claude-dir` or `--codex-dir` on `regress` (folders come from `SIPCODE_PROJECTS_DIR` / `CODEX_HOME`, like every other command).
- Not reading Claude Code subagent transcripts (`<project>/<session>/subagents/*.jsonl`): Sipcode's discovery never has, and they are excluded from every check anyway.
- Directory submission itself (section 9.2 is the checklist for later).

## 3. Sources

- Prototype, read with `git show regress-prototype:<path>`: `prototypes/regress/{regress.mjs,README.md,test.mjs,make-fixtures.mjs}`, `plugins/sipcode/plugin.json`, `plugins/sipcode/skills/sipcode-regress/{SKILL.md,scripts/regress.mjs}` (identical to `prototypes/regress/regress.mjs`), `.agents/plugins/marketplace.json`.
- Official docs (fetched 2026-10-12):
  - Build plugins: https://developers.openai.com/codex/plugins/build (layout, manifest, marketplace, `codex plugin marketplace add`)
  - Plugin packaging: https://developers.openai.com/plugins/build/plugins (portable manifest, `extensions.com.openai.interface`, marketplace fields)
  - Skills: https://developers.openai.com/plugins/build/skills and https://learn.chatgpt.com/docs/build-skills (SKILL.md frontmatter, `agents/openai.yaml`, discovery, implicit invocation)
  - Submission: https://developers.openai.com/plugins/deploy/submission (eligibility, field limits, assets, portal steps)
  - Guidelines: https://developers.openai.com/plugins/plugin-guidelines
  - Manifest schema: https://agent-plugins.org/schemas/1.0.0/plugin.schema.json
  - OpenAI's own marketplace repo, for current real-world shape: https://github.com/openai/plugins (`.agents/plugins/marketplace.json`, `plugins/*/.codex-plugin/plugin.json`)
- Sipcode code: `src/cli.ts`, `src/commands/limits.ts`, `src/modules/limits/*`, `src/modules/agents/{loadSessions,usageSessions}.ts`, `src/modules/agents/codex/{parse,discover,rateLimits}.ts`, `src/modules/transcript/{parse,discover,dedupe}.ts`, `src/lib/messages.ts`, `scripts/verify-counts.mjs`, `tests/e2e/release-smoke.test.ts`, `package.json` (`files` allowlist).

---

## 4. What users see

### 4.1 Install (README "Use Sipcode inside Codex")

1. `npm i -g sipcode` once (Node 20+).
2. Codex CLI: `codex plugin marketplace add Anuj7411/sipcode`, then `/plugins` in Codex and install **Sipcode**.
3. ChatGPT desktop app: open the Plugins screen, add a marketplace with `https://github.com/Anuj7411/sipcode` (a third-party guide describes this as Plugins > Add more; OpenAI's docs only document the CLI command and marketplace files), then install **Sipcode** from it. The exact button names are confirmed in the manual acceptance step (section 10.5) before the README text is final.
4. Ask in plain words, or pick a skill with `$` (Codex CLI) / `@` (ChatGPT).

### 4.2 Rules every skill follows

1. **Published CLI only.** Run `sipcode --version` first. Not found: say "Sipcode is not installed. Run `npm i -g sipcode` once in a terminal, then ask again." and stop. Never `npx` (the Codex sandbox usually blocks network), never install anything. Older than 1.7.2: tell the user to run `npm i -g sipcode@latest` and stop.
2. **Sandbox.** If the sandbox blocks `~/.codex` (or `~/.claude` for regress), request permission / escalation to run the same command again with read access. Never report an empty result caused by the sandbox.
3. **No raw logs.** Never open, read, search or summarise the log files, never paste their contents; work only from Sipcode's output. Lines on stderr starting with `note:` are part of the answer.
4. **Exact numbers.** Quote numbers exactly as printed; no rounding, adding or recomputing.
5. **Wording.** Never "nerfed". Limit cuts are always "possible", with the other-devices caveat. A regress finding outside the known catalog is "a signal worth reporting, not proof of a bug". Dollar figures for Codex are "at API prices" (a ChatGPT plan is not billed per token). Explicit user instructions win over a skill.

### 4.3 Skills

All four live in `plugins/sipcode/skills/<name>/SKILL.md` with `name` and `description` frontmatter. The description is what Codex matches implicitly, so it leads with the use case and the trigger words ([skills docs](https://learn.chatgpt.com/docs/build-skills)).

| Skill | Trigger description (summary; full text in the plan, Task 11) | Commands |
|---|---|---|
| `sipcode-spend` | how much they spent on Codex, tokens today or this month, what this month will cost | `sipcode today --agent codex --json`; `sipcode forecast --agent codex --json`; `sipcode stats --agent codex --since <7d\|30d\|90d\|all\|yyyy-mm-dd> --json` |
| `sipcode-limits` | how close to the Codex limit, when it resets, what used it, whether the limit got smaller | `sipcode limits --json`; `sipcode limits --json --since all` |
| `sipcode-why` | why the last Codex session was so expensive, where the tokens went | `sipcode why --agent codex --json`; `sipcode why --agent codex --list` then `sipcode why --agent codex --session <id> --json` |
| `sipcode-regress` | whether Codex or Claude Code got worse or more expensive after an update, limit burning faster, whether an update changed costs | `sipcode regress --bug-report` (both tools); `--agent codex` or `--agent claude-code` only when the user limits the question to one tool |

Report rules per skill (fields are the real `--json` field names):

- **spend.** `today`: `today.totalSpendUSD`, `today.totalTokens`, then `comparison.spendDeltaPct` vs `baseline.medianSpendPerDayUSD`; statuses `no-sessions-today` / `no-baseline` / `no-data` said plainly. `forecast`: `monthEnd.spendSoFarUSD`, `monthEnd.projectedSpendUSD` with `confidenceLowUSD`..`confidenceHighUSD`, last month when `comparison.lastMonthSpendUSD` is not null; a non-`ok` status is explained, not projected. `stats`: `totals.estCostUSD`, `totals.totalTokens`, `sessionCount`, `topExpensive` on request. Unpriced tokens: counted but not in the dollar figure.
- **limits.** Empty `windows`: no readings yet. Per window: `label`, `usedPercent`, `resetsAt`, `projection.kind` (`runs-out` with `at`, `lasts`, `reached`, `reset-since`, `too-early`). `asOf` = last Codex request. `usedBy` + `unattributedPercent` (other devices or cloud). `possibleCut` → "a possible limit cut" around `at`, about `factor` times, always with the other-devices caveat.
- **why.** `header`, `punchline.totalTokens`, `totals.estCostUSD` (at API prices), then `topExpensive`, `duplicates`, `idle`, `topLeaks`. `estimatedSavings` is a Claude Code setup figure; never presented as a saving available in Codex (Sipcode does not act inside Codex).
- **regress.** (1) Quote the coverage lines exactly. "Nothing to analyse" or exit 2: no logs could be read, not a clean result, never "no regressions". WARNING: partial result, ask for read access and rerun. "Not enough data to compare versions yet": say so, also not a clean result. (2) Findings: versions, evidence numbers, catalog match (R1 to R5). (3) Outside the catalog: signal, not proof. (4) Codex finding: could also be a plan limit change at the same time, and other devices share the limit; any limit change is "possible". (5) No findings: "No regressions detected in your logs" plus the coverage. (6) Offer the bug-report block; token counts only; review before posting. Rules: never "nerfed"; subagent and Agent SDK runs are left out by design; Codex versions are compared only within one plan and window.

---

## 5. `sipcode regress`

### 5.1 Command line

```
sipcode regress [--json] [--bug-report] [--min-n <n>] [--agent claude-code|codex|auto]
```

- `--agent`: `auto` or omitted = both tools; `claude-code` or `codex` = that tool only; `cursor` = E009 (`regressCursor`); anything else = the standard unknown-agent message. Exit 1 on both errors.
- `--min-n`: whole number 1..1000, default 20 (the prototype's `--min-n`). Anything else = E010 `regressBadMinN`, exit 1.
- `--bug-report`: adds the GitHub-issue block (terminal) or the `bugReport` field (JSON).
- Folders: `SIPCODE_PROJECTS_DIR` (default `~/.claude/projects`) and `CODEX_HOME` (default `~/.codex`, reading `sessions/` and `archived_sessions/`), like every Sipcode command. Zero network calls.

### 5.2 Inputs, rebuilt on Sipcode's loaders

| Input | Prototype | `sipcode regress` |
|---|---|---|
| Claude Code files | recursive walk of `~/.claude/projects` (includes `subagents/`) | `loadSessions` over Claude Code discovery (project folders, observer folders skipped; subagent files not read) |
| One request | first line of each `message.id\|requestId` (first copy across files wins, in walk order) | Sipcode's parser: lines of a request merged, largest value per usage field; cross-file dedupe: the file that started first keeps the request, carrying the largest usage of all copies (`DedupeIndex`) |
| Kept requests | assistant lines with usage, a `version`, model not `<synthetic>` | same rule on the parsed turn (`missingUsage`, `version`, model) |
| Cache write | `max(cache_creation_input_tokens, 5m + 1h)` | same (the parser already does this) |
| 5-minute write | nested `ephemeral_5m_input_tokens` | `cacheCreationTokens - cacheCreation1hTokens` when the nested split was logged (`cacheSplitLogged`), else 0. Identical whenever the nested split is consistent; differs only for a line whose nested split is all zero while the top-level field is not |
| After tool result | last user line before the request held a `tool_result` | same, tracked by the parser (`afterToolResult`) |
| Automated | `isSidechain` or path contains `/subagents/`; entrypoint `sdk-*` | `isSidechain` (`sidechain`) or entrypoint `sdk-*` (subagent files are never read) |
| Session label | first 8 chars of the line's `sessionId` | first 8 chars of the session file's id (`SessionMeta.sessionId`); sessions are counted per file |
| Codex requests | per-file consecutive `token_count` deltas of `primary.used_percent` | `loadSessions` over Codex discovery (records or token_count deltas, cross-file dedupe), version = `cli_version` on line 1 of the file (pre-release suffix dropped) |
| Codex limit | per-file deltas of the primary window only | `loadCodexReadings` + `buildPeriods` (account-wide periods, every window), `attribute` (each rise shared by the requests since the previous rise, by tokens) |

New per-request fields on `AssistantTurn` (Claude Code parser only; optional, set only when present or true): `version`, `entrypoint`, `sidechain`, `afterToolResult`, `cacheSplitLogged`. They travel through dedupe (non-usage fields come from the kept copy) and through the usage cache (whose schema id moves from `sipcode-usage-cache/2` to `/3`, as its own comment requires when the parse output changes). Codex discovery copies line 1's `cli_version` into `SessionMeta.cliVersion`. `LimitPeriod` gains an optional `planType` (the newest reading's). Claude Code discovery now counts folders and files it could not read (`listClaudeSessions`), so the period commands also print the existing "N log folder(s) could not be read" note for Claude Code, as they already do for Codex.

Verified on the maintainer's machine (2026-10-12, read-only, numbers only): interactive Claude Code requests 27,671 in both the prototype and the port; automated requests left out 710 (prototype 20,491, because it also read 4.8 GB of subagent files); sessions 42 (prototype 40, it counted line session ids); 32 versions 2.1.121 to 2.1.295; windows covered R1, R4, R5; Codex 930 requests in 15 files, 3 comparable groups; zero findings in both. A cold run took 31 s (prototype 61 s).

### 5.3 Checks (thresholds unchanged from the prototype)

Each version is compared with the user's OTHER versions (their own baseline). Only interactive main-conversation requests count (subagent and Agent SDK requests use a different cache policy by design). Each file's kept rows are one sequence in time order. `minN` = `--min-n` (default 20); `smallN` = `max(5, floor(minN / 4))`.

| Check | Sample | Flagged when | Catalog |
|---|---|---|---|
| `warm-cache-miss` "Prompt cache missing on back-to-back turns" | pairs of consecutive requests 0..5 min apart, context >= 30,000 and >= 60% of the previous context; a miss = cache read < 30% of context | version has >= minN pairs, miss rate >= 25% and >= 3 x max(rate of every other pair, 1%) | R2, R3 |
| `post-idle-cold` "Cache stays cold for several turns after an idle break" | a request >= 60 min after the previous one, followed by two requests each <= 5 min apart with context >= 30,000; cold = both have cache read < 30% of context; sampled under the idle request's version | >= smallN returns, cold rate >= 50% and >= 3 x max(others, 2%) | R3 |
| `ttl-5m` "Main-conversation cache written with the 5-minute TTL instead of 1-hour" | requests with 5m + 1h > 0; share = sum 5m / (sum 5m + 1h) per version | version has >= minN requests; share >= 50%; request-weighted mean share of the other versions with >= minN requests <= 20%; those have >= minN requests in total. Note: "If you use an API key, cloud provider or usage credits, 5-minute TTL is expected, not a bug." | R4 |
| `uncached-input` "Large uncached input on tool-result turns (context not being cached)" | requests after a tool result with context >= 20,000, per model and version | group has >= smallN requests; upper median uncached input >= 500; the same model's other versions' upper median of medians < 100, or no other version of the model (prototype rule, kept) | R1 |
| `hourly-rebuild` "Whole prompt cache rebuilt about every hour" | full rebuild = request <= 5 min after one with context >= 50,000, keeping >= 60% of it, reading < 20% of that previous context from cache; gaps between consecutive rebuilds in one file, under the later rebuild's version | version has >= 4 gaps and >= half of them are 50 to 70 min | R5 |
| `codex-limit-burn` "Codex rate limit drains faster per token" | per (Codex version, model, plan, limit id, window): percent charged to its requests / (uncached input + output tokens / 1M) | group has >= 200,000 work tokens and >= 2 x the upper median of the other counted groups with the same plan, limit id and window (any model) | none |

- Upper median (prototype): middle element, the upper one for an even count.
- Adjacent flagged versions (adjacent in the check's own version order) merge into one finding `from` .. `to`; a merged range matches every overlapping catalog entry (on the ground-truth data 2.1.76 and 2.1.90 merge into one `warm-cache-miss` finding matching R2 and R3, exactly as in the prototype).
- Each evidence line ends with `  [matches known R2]` when its own version is in an entry's range.
- Up to 3 example requests per finding (warm, idle, uncached): `session <8 chars> <ISO time> ...token counts...`.
- **Codex specifics.** A rise with no request on this computer (other devices, cloud) is left out (it is "unattributed" in `limits`); requests after a period's last rise are not charged yet and are left out; a reading whose plan changes starts no special rule, the plan is part of the group. Every Codex finding carries the note: "Limits are shared with Codex on your other devices and in the cloud. A limit change on your plan at the same time as the update would look the same: run `sipcode limits` to see whether a limit may have shrunk." Plus, when the plan has groups on another window: "Your plan's limit window changed during this period; only same-window versions were compared." (prototype), and when no peer ran the same model: "This version ran a different model than your other versions; the model may explain the difference." (new).

Known catalog (unchanged): R1 `uncached-input` 2.1.257..2.1.259 fixed 2.1.260; R2 `warm-cache-miss` 2.1.69..2.1.89 fixed 2.1.90; R3 `post-idle-cold` + `warm-cache-miss` 2.1.85..2.1.100 fixed 2.1.101; R4 `ttl-5m` 2.1.0..2.1.128 fixed 2.1.129; R5 `hourly-rebuild` 2.1.0..2.1.247 fixed 2.1.248, with the prototype's `what` and `ref` texts.

### 5.4 Coverage

- Claude Code: interactive requests, automated requests left out, session files with an interactive request, distinct versions, first and last version, first and last UTC date, catalog ids whose range contains any version.
- Codex: requests read, sessions, versions, first and last version and date, limit readings, comparable groups.
- `comparable`: Claude Code has 2+ versions with >= minN interactive requests, or a Codex group has a peer on the same plan, limit and window.

### 5.5 Terminal output

```
sipcode regress · local only, no network
Claude Code: 27,671 interactive requests in 42 sessions (710 subagent and Agent SDK requests left out of the comparison), 2026-05-04 to 2026-10-12, versions 2.1.121 to 2.1.295
Known-regression windows your logs cover: R1, R4, R5
Codex: 930 requests in 15 sessions, 2026-03-28 to 2026-10-08, versions 0.118.0 to 0.162.0, 3 version/model groups with enough limit data
[Not found or not readable: <folder>]               one per missing folder
[WARNING: N log file(s) or folder(s) could not be read. Results cover only what was readable. If this runs inside a sandbox (for example Codex), allow read access to <claude dir> and <codex dir> and run it again.]
[note: N compressed Codex log(s) (.jsonl.zst) skipped: Sipcode cannot read compressed logs yet.]

<one of>
Nothing to analyse: no interactive Claude Code requests and no Codex requests could be read. This is NOT a clean result.      (exit 2)
No regressions detected in your logs.                                                                 (comparable)
Not enough data to compare versions yet: Claude Code needs 2 versions with 20 or more requests each, Codex needs 2 versions with 200,000 or more tokens on the same plan and limit window. This is not a clean result.   (names only the tools asked for)
● <title>  [<id>]  Claude Code|Codex <from>[ to <to>]  = known R2, R3 | (not in the known-issue catalog)
    <evidence lines>
    e.g. <example lines>
    note: <note>
[Not enough data to compare Codex|Claude Code versions yet: <what it needs>. This is not a clean result for Codex|Claude Code.]   for a tool read but not compared, when the other tool was compared or a finding was reported (review fix)
[blank + "A finding that is not in the known-issue catalog is a signal worth reporting, not proof of a bug."]   when any finding is outside the catalog
[blank + "---- paste into a GitHub issue (review it first) ----" + blank + bug-report block]                       with --bug-report
```

A line for an agent that was not asked for is omitted. Missing Claude Code data: `Claude Code: no readable interactive requests in <dir>` (or, when only subagent and Agent SDK requests were read, `Claude Code: no interactive requests in <dir> (N subagent and Agent SDK requests left out of the comparison)`); missing Codex data: `Codex: no readable requests in <dir>`.

### 5.6 JSON (`--json`, schema `sipcode-regress/1`)

```json
{
  "schemaVersion": "sipcode-regress/1",
  "agents": ["claude-code", "codex"],
  "minN": 20,
  "coverage": { "claudeCode": { "requests": 0, "excludedAutomated": 0, "sessions": 0, "versions": 0, "firstVersion": null, "lastVersion": null, "from": null, "to": null, "knownWindowsCovered": [] } | null,
                "codex": { "requests": 0, "sessions": 0, "versions": 0, "firstVersion": null, "lastVersion": null, "from": null, "to": null, "readings": 0, "groups": 0 } | null },
  "access": { "missingDirs": [], "unreadableFiles": 0, "unreadableFolders": 0, "skippedCompressed": 0, "nothingRead": false },
  "comparable": true,
  "comparableByAgent": { "claudeCode": true | false | null, "codex": true | false | null },   // null: not asked for
  "findings": [{ "id": "...", "agent": "claude-code|codex", "title": "...", "from": "...", "to": "...",
                 "known": [{ "id": "R2", "what": "...", "ref": "...", "fixed": "..." }],
                 "evidence": ["..."], "examples": ["..."], "note": null }],
  "checks": { "claudeCode": { "warmCacheMiss": [{ "version", "n", "rate", "baseline", "baselineN" }], "postIdleCold": [same], "ttl5m": [{ "version", "n", "share5m", "baseline" }],
                              "uncachedInput": [{ "model", "version", "n", "median", "baseline" }], "hourlyRebuild": [{ "version", "n", "hourly" }] } | null,
              "codex": [{ "version", "model", "plan", "limitId", "windowMinutes", "requests", "percent", "workTokens", "percentPerMillion" }] | null },
  "bugReport": "..." | null           // only with --bug-report; null when there are no findings
}
```

`checks` is there so `scripts/verify-counts.mjs` can compare every table with an independent computation.

### 5.7 Bug-report block

Per finding: `### <title>`, blank, `**Detected by** sipcode regress <version> from local logs only (no data left the machine).`, `**Affected Claude Code|Codex versions (from my logs):** <from>[ to <to>]`, `**My data:** <requests> requests, <sessions> sessions, <from> to <to>` (Codex: `<n> Codex requests, ...`), blank, `**Evidence**` + bullets, then `**Sample requests (token counts only)**` + bullets when there are examples, `**Matches known issue:** R2 <what> (<ref>, fixed in <fixed>)` when matched, `_Note: <note>_` when there is a note. Token counts, versions, dates and 8-character session ids only: never prompts, code, paths or commands. (The prototype printed "Affected Claude Code versions" for Codex findings too; fixed.)

### 5.8 Exit codes and states

| State | Exit | Output |
|---|---|---|
| Ran, with or without findings | 0 | report |
| Bad `--agent`, `--min-n`, or a loader error | 1 | message on stderr |
| No interactive Claude Code request and no Codex request read (from the agents asked for) | 2 | "Nothing to analyse ... This is NOT a clean result." / `access.nothingRead: true` |
| Data read but nothing comparable and no findings | 0 | "Not enough data ... This is not a clean result." / `comparable: false` |
| Some files or folders unreadable | 0 (2 if nothing read) | WARNING line / `access.unreadable*` |
| Damaged limit-reading lines | as above | stderr `note: N Codex limit reading(s) could not be read and were skipped.` (same as `limits`) |

### 5.9 Speed, memory, privacy

The checks keep a compact row per request (about 38K rows on the maintainer's machine). Requests come from `loadSessions` with the usage cache (`~/.sipcode/usage-cache/*.json`), so a warm run skips unchanged files; the cache now also stores the request tags above (versions, entrypoint, flags; no text). PRIVACY.md gains `regress` in the read list and the new cache fields. Nothing is uploaded.

---

## 6. Changes from the prototype (complete list)

1. Inputs come from Sipcode's loaders (section 5.2): request merge by largest field, first-started-file dedupe, subagent files not read, sessions counted per file, Codex via account-wide periods and rise attribution (concurrent sessions no longer double-count a rise; other-device rises are left out).
2. Codex compares every limit window (the prototype read `primary` only) and adds `limitId` to the group.
3. Codex note about a different model (new) and the always-on plan-change caveat (maintainer rule).
4. "Not enough data" state (new) instead of "No regressions detected" when nothing was comparable.
5. "Nothing read" now means no request read from either tool. The prototype also returned exit 2 when Codex had logs but no group reached 200,000 work tokens and Claude Code had none, and printed "no readable ... logs were found", which was false in that case.
6. Missing-folder line reads "Not found or not readable" (a sandbox can hide a folder).
7. WARNING no longer claims "(permission denied)": Sipcode cannot tell why a read failed.
8. Ranges print "2.1.100 to 2.1.105" (the prototype used a hyphen) and "50 to 70 minutes".
9. Each finding names its tool ("Claude Code 2.1.76", "Codex 0.142.0").
10. Bug report names the right tool and the Sipcode version.
11. JSON gains `schemaVersion`, `agents`, `minN`, `comparable`, per-agent `coverage`, the `checks` tables and optional `bugReport`; `access.unreadable` splits into files / folders / compressed.
12. Flags: `--claude-dir` / `--codex-dir` dropped (env vars as everywhere); `--agent` added; `--min-n` validated.

Everything else (the six checks, every threshold, the catalog, minN default 20, the coverage line content, exit 2 "NOT a clean result", the bug-report contents, the subagent and SDK exclusion, the TTL note, the same plan-and-window rule) is carried unchanged.

## 7. MCP: no regress tool in 1.7.2

A `regress` MCP tool would not fit the existing pattern: MCP tools must answer within the 10 s timeout (`tests/guards/mcp-tool-timeouts.test.ts`), and a cold `regress` reads every Claude Code transcript in full (31 s on the maintainer's 4.8 GB of logs). The plugin calls the CLI, not MCP, so nothing needs it. The tool count stays 16 and no count assertion or doc changes.

---

## 8. Plugin files (per the official docs)

```
.agents/plugins/marketplace.json          repo marketplace (docs: $REPO_ROOT/.agents/plugins/marketplace.json)
plugins/sipcode/
  plugin.json                             portable manifest (root, recommended by the docs)
  .codex-plugin/plugin.json               compatibility overlay for older Codex builds (docs: optional; only this file in that folder)
  assets/logo.png                         180 x 180 PNG (copy of docs/site/public/apple-touch-icon.png); logo and composerIcon
  skills/sipcode-spend/SKILL.md
  skills/sipcode-limits/SKILL.md
  skills/sipcode-why/SKILL.md
  skills/sipcode-regress/SKILL.md
```

- `plugin.json`: `$schema` `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`, `name` `sipcode`, `version` = package version (1.7.2; a test keeps them equal), `description`, `author` {`name`, `url`}, `homepage`, `repository`, `license` `MIT`, `keywords`, and `extensions["com.openai"].interface`: `displayName` "Sipcode", `shortDescription` "Spend, limits and regressions" (29 of 30 chars), `longDescription`, `developerName` "Anuj Ojha", `category` "Developer Tools" (the category OpenAI's own marketplace uses for 27 developer plugins), `capabilities` ["Read"], `websiteURL`, `privacyPolicyURL` (PRIVACY.md on GitHub), `defaultPrompt` (3 prompts), `brandColor` `#5B4FCF` (the site's accent), `composerIcon` and `logo` `./assets/logo.png`. No `skills` key: the 1.0.0 schema sets `additionalProperties: false` and portable packages discover `skills/` automatically. No `hooks`, `apps` or MCP config.
- `.codex-plugin/plugin.json`: the older Codex layout that OpenAI's own repo still uses (`interface` at the top level, `"skills": "./skills/"`), with the same identity fields and an identical `interface`. Per the docs it is ignored whenever the root manifest has `extensions["com.openai"]`, so it only helps Codex builds that predate the portable layout. A test keeps the two in sync.
- `marketplace.json`: `name` "sipcode", `interface.displayName` "Sipcode", one plugin entry: `name`, `source` {`source`: "local", `path`: "./plugins/sipcode"}, `policy` {`installation`: "AVAILABLE", `authentication`: "ON_INSTALL"}, `category` "Developer Tools".
- Neither folder ships in the npm package: `package.json` `files` is an allowlist (`dist`, `benchmark/...`, docs) and the validation test asserts it never names `plugins` or `.agents`.

### 8.1 Where the official docs differ from the prototype's files (docs win)

| Prototype | Docs / now |
|---|---|
| `plugin.json` had only `$schema`, `name`, `version` 0.1.1, `description`, `license`, `homepage`, `repository` | adds `author` (required for Codex submission), `keywords`, and `extensions["com.openai"].interface` with the listing fields (`displayName`, `shortDescription`, `longDescription`, `developerName`, `category`, `capabilities`, URLs, `defaultPrompt`, `brandColor`, `composerIcon`, `logo`); version follows the npm version |
| no `.codex-plugin/plugin.json` | added as the documented compatibility overlay for older Codex (OpenAI's own marketplace repo still uses only this layout) |
| no assets | `logo` and `composerIcon` are required for the directory (square, >= 48 px, PNG/JPEG/WebP/SVG, <= 5 MiB) |
| marketplace: no top-level `interface`; `interface.displayName` inside the plugin entry | top-level `interface.displayName` (the marketplace title); the plugin entry has `name`, `source`, `policy`, `category` only |
| one skill with a bundled `scripts/regress.mjs` run with `node` | four skills, no scripts: they call the published `sipcode` CLI (installed once with npm) |
| skill told the user to install Node.js | skill tells the user to run `npm i -g sipcode` |

## 9. Distribution

### 9.1 Now: GitHub marketplace

Merge to `main` and publish 1.7.2 to npm (the existing tag-triggered OIDC workflow). Anyone can then run `codex plugin marketplace add Anuj7411/sipcode` (or `--ref v1.7.2` to pin) or add the repo from the desktop app's Plugins screen, and install Sipcode. `codex plugin marketplace upgrade sipcode` picks up later changes. The install cache lives at `~/.codex/plugins/cache/sipcode/sipcode/<version>/`.

### 9.2 Later: OpenAI public plugin directory (checklist for the maintainer)

Eligibility (already met by the design): skills only; no hooks, apps or local stdio MCP server; no secrets in the ZIP; no reviewer instructions or test credentials in the ZIP.

On platform.openai.com:
1. Organization owner, or a member with the **Apps Management Write** role (https://platform.openai.com/settings/organization/people/roles).
2. Complete individual or business verification (https://platform.openai.com/settings/organization/general); the directory shows the verified developer name.
3. https://platform.openai.com/plugins → **Upload new or existing plugin** → choose the developer identity → **Upload plugin** with a ZIP of `plugins/sipcode/` (manifest at the ZIP root).
4. Fix anything the automated metadata and skill scans report (**Copy issues**, fix, **Upload plugin to fix issues**); the skill scans must pass.
5. No MCP server, so no domain verification, OAuth, test cases or demo recording.
6. **Submit for review**, complete the policy attestations, track **Review status**; feedback comes by email; one active review at a time.
7. After approval, open the approved version and **Publish plugin**. Each later change: bump the plugin version, upload a new ZIP with **Upload plugin to make changes**, review, publish.

Decisions before submitting (section 12): `termsOfServiceURL` and `supportURL` (the portal lists all four URLs as required for MCP review; for a skills-only plugin they may be optional, the portal will say), whether "Claude Code" may appear in the listing text, a dedicated logo, screenshots (optional), and whether the npm-install prerequisite passes review (the guidelines do not address it).

---

## 10. Testing and proof

### 10.1 Unit tests (new files)

- `tests/modules/transcript/parse-regress-fields.test.ts`: version, entrypoint, sidechain, afterToolResult (tool_result yes, prompt no, mixed yes), cacheSplitLogged, merged lines keep the first line's tags.
- `tests/modules/transcript/discover-counts.test.ts`: `listClaudeSessions` counts an unreadable projects folder, project folder and file; `listAllSessions` unchanged.
- `tests/modules/agents/codex/discover-cli-version.test.ts`: `cliVersion` copied from line 1, absent when missing.
- `tests/modules/limits/periods-plan.test.ts`: `planType` = newest reading's, per period, absent when none.
- `tests/modules/regress/{catalog,rows,claude,codex,format}.test.ts`: version compare, catalog matching, row building (skips, 5m derivation, automated, time order), each Claude check firing and not firing at its thresholds (minN, smallN, compaction pairs, baselines, 4 gaps, merge), Codex table (percent per 1M, tail after the last rise, 200K floor, other-device rise), Codex flagging (2x, same plan/window, notes), coverage, terminal/JSON/bug-report shapes.

### 10.2 Integration tests

`tests/integration/regress.integration.test.ts` with `tests/integration/regress-fixtures.ts`, a port of `make-fixtures.mjs` to in-memory Claude Code transcripts and Codex rollouts (Codex laid out as consecutive weekly periods so the account-wide model sees each version's own rises):
- ground truth: all six checks fire and map to R1 to R5 (Codex: no catalog entry); the clean set has zero findings and prints "No regressions detected in your logs.";
- coverage numbers, SDK and sidechain sessions left out, a resumed copy counted once;
- terminal lines, catalog tags, signal-not-proof line, no em or en dashes;
- `--bug-report` (terminal and JSON), never a home path in the block;
- nothing read: exit 2 in terminal and JSON; a blocked Claude Code folder (EACCES) counted and warned; an unreadable file counted; too little data = "Not enough data";
- flags: `--agent codex|claude-code|cursor|unknown`, `--min-n` validation and effect;
- Codex: other-device rise left out, table math, different-model note.

### 10.3 Plugin validation test

`tests/plugin/codex-plugin.test.ts`: manifest schema fields and allowed keys, name format, version = package version, listing limits (30/30/4000/80 chars, <= 3 prompts of <= 128 chars, HTTPS URLs, hex color), logo and composer icon (path under `./assets/`, square PNG >= 48 px, < 5 MiB), overlay in sync, skills-only file list (no hooks / apps / MCP), marketplace entry, each skill folder name = frontmatter `name` and a description of 80..1024 chars, the shared rules present in every skill, copy rules, and every `sipcode ...` command in every skill (inline code and fenced blocks) checked against `sipcode --help` / `sipcode <command> --help` run from the TypeScript source (`node --import tsx src/cli.ts`), with valid `--agent`, `--since` and `--session` values. Also: `package.json` `files` never names `plugins` or `.agents`.

### 10.4 Independent check on real data

`scripts/verify-counts.mjs` (imports nothing from Sipcode) gains a regress section: its own Claude Code reader records each request's version, entrypoint, sidechain flag, after-tool-result flag and split flag; its own ownership pass keeps the first-started copy with the largest usage; it recomputes the coverage, all five Claude Code tables, the Codex table (its own windows, periods, plans and rise-by-rise attribution) and the findings, and compares them with `regress --json` (cold and warm cache). It runs on a frozen copy of the maintainer's logs (plan Task 15). On 2026-10-12, while writing this spec, the planned section was run in a throwaway copy of the repo against a frozen copy of those logs: all 50 regress checks matched in both cache passes (27,685 interactive requests, 710 automated, 42 sessions, 32 versions, tables of 29 / 23 / 29 / 57 / 19 rows, Codex 930 requests in 3 groups, zero findings), and the script's 264 existing checks still matched (314 in all, 0 mismatches).

### 10.5 Manual acceptance (maintainer)

After merge and npm publish: on a machine with `npm i -g sipcode@1.7.2`, add the marketplace from the public repo in the ChatGPT desktop app's Plugins screen, install Sipcode, and in a new chat ask the four questions (and once with `sipcode` uninstalled, and once with the sandbox blocking `~/.claude`). Pass = each answer comes from the matching skill and command, numbers equal the CLI's own output, the not-installed reply names `npm i -g sipcode`, the sandboxed run asks for access instead of reporting "no regressions", no answer says "nerfed".

## 11. Docs and version

- README: new "Use Sipcode inside Codex" section (install steps, the four questions, what each runs, privacy), a `sipcode regress` section, the commands table, the Codex "Commands that read Codex" list.
- CHANGELOG `[1.7.2]`, llms.txt / llms-full.txt, PRIVACY.md (read list, cache fields), site Hero/Footer version and test count, README badge, server.json, package.json and lock: 1.7.2.
- Release smoke test: `regress` in the `--help` list.

## 12. Risks

| Risk | Level | Mitigation |
|---|---|---|
| Codex's sandbox blocks `~/.claude` or `~/.codex` and the answer looks clean | medium | exit 2 + "NOT a clean result"; WARNING with counts; skills request escalation; acceptance step tests it |
| Codex desktop app's "add marketplace" path differs from the third-party description | medium | CLI path is documented by OpenAI; acceptance step confirms the app wording before the README is final |
| A false positive on someone's logs (thresholds validated on one real machine plus synthetic ground truth) | low | "signal worth reporting, not proof" wording; zero findings on the maintainer's 27,671 requests; independent check |
| Codex version per request = line 1 `cli_version`; a file resumed under a newer Codex would count under the old version | low | 0 of 15 real rollouts carry a second `session_meta`; documented |
| `uncached-input` flags a model seen in only one version (prototype rule) | low | kept for fidelity; evidence says "no data" for the baseline; maintainer may tighten later |
| Usage cache grows by the request tags | low | about +75 bytes per request; schema id bump starts a fresh cache |
| Directory review rejects the npm prerequisite or the "Claude Code" mention | low (later) | decided at submission time; GitHub marketplace unaffected |

## 13. Decisions the maintainer should confirm

1. Ship the `.codex-plugin/plugin.json` overlay alongside the root manifest (recommended: yes, for older Codex builds; a test keeps them identical).
2. Codex groups compare any model on the same plan and window (prototype rule) with a "different model" note, rather than requiring the same model like `limits` does.
3. "Not enough data to compare versions yet" as a distinct, not-clean state.
4. Logo: reuse the 180 px site icon now; a dedicated plugin logo before directory submission?
5. Terms-of-service and support URLs for the directory listing (none exist today).
