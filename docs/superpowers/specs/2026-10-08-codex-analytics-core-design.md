# Codex analytics core (piece 1 of Codex support): design

Date: 2026-10-08. Status: approved in conversation, awaiting written-spec review.
Ships as **v1.7.0** (minor bump: second supported coding agent is a milestone).

## Goal

Make Sipcode's analytics as accurate for OpenAI Codex (CLI and Codex in the ChatGPT desktop
app) as they are for Claude Code: `stats`, `today`, `why`, `forecast`, `trend`, `impact`,
`receipt`, `drift`, and the MCP tools, reading Codex's local rollout logs with correct token
accounting and OpenAI prices. Zero network calls, as for Claude.

Fix, in the same shared layer, the Claude over-count found while designing this: requests
repeated across log files (resumed sessions, subagent logs) are summed once per file.
Measured on one real machine, on exactly the files Sipcode reads: 13.37B tokens summed vs 12.00B unique (11.4% over; 3,163 repeated requests in 8 resumed-session files).

## Non-goals (later pieces)

- Codex rate-limit tracking (piece 2).
- `sipcode init` for Codex: AGENTS.md block, MCP registration, hook install (piece 3).
- Proxy command rewriting inside Codex (piece 4, only if evidence shows it lowers cost).
- `hygiene` and `benchmark` stay Claude-only.

## What users see

| Situation | Behaviour |
|---|---|
| Only Claude Code installed | Unchanged. |
| Only Codex installed | Every command runs on Codex automatically. |
| Both installed, period commands (`stats`, `today`, `forecast`, `trend`, `impact`) | A Claude Code section and a Codex section. `stats`, `today` and `forecast` end with one combined line, e.g. `Both tools: 13.1B tokens · ~$10,888 + ~$412`; `trend` (a ratio) and `impact` (before/after) have no combined line because a sum would be meaningless. |
| Both installed, single-session commands (`why`, `drift`, `receipt`) | The most recent session across both tools, labelled with its tool, plus a one-line hint naming the other tool's latest session and the flag to see it. |
| `--json` (scripts, MCP) | One tool per call, existing schema unchanged (no new fields). With both installed and no flag, the JSON is the Claude Code result (as today) and a one-line note on stderr names the `--agent codex` flag; `--agent codex` selects Codex. MCP tools gain an optional `agent` input. |
| `--agent codex` / `--agent claude-code` | Always restricts any command to that tool. |
| `--here` | Claude: project-hash match (unchanged). Codex: session `cwd` from `session_meta` equals or is inside the current folder (normalised path compare). |

"Installed" for Codex = `$CODEX_HOME/sessions` (default `~/.codex/sessions`) exists and holds at
least one rollout file.

## Architecture

New and changed units. Each has one job and is testable alone.

1. **`src/modules/agents/codex/discover.ts`**: lists rollout files in `$CODEX_HOME/sessions`
   and `$CODEX_HOME/archived_sessions` (`rollout-*.jsonl`; `rollout-*.jsonl.zst`, an optional
   Codex feature that is off by default, is counted as skipped and reported, not read). If the same
   file name exists in both folders, keep `sessions/`. Returns `SessionMeta` records; reads
   line 1 (`session_meta`) for `cwd`, `cli_version`, `source`, `forked_from_id`,
   `parent_thread_id`.
2. **`src/modules/agents/codex/parse.ts`**: pure `parseCodexRollout(content) → ParsedSession`
   (same type the Claude parser returns, so analyzers and renderers are reused). Rules below.
3. **`src/modules/agents/codex/readDetect.ts`**: pure function: shell command string → read
   target or `undefined`. Recognises whole-file reads only: `cat F`, `type F`, `Get-Content
   [-Raw] [-Path|-LiteralPath] F`, `head|tail -n N F` (recorded as a partial read with the
   range in the key), `sed -n 'a,bp' F` (partial, range in key). Pipelines, globs, multiple
   files and redirections return `undefined` (no guess).
4. **`src/modules/agents/codex/adapter.ts`**: the `Agent` implementation for `codex`
   (registered in `registry.ts`; `AgentId` gains `"codex"`). Rules file: `AGENTS.md`
   (read only in this piece; writing it is piece 3).
5. **`src/lib/pricing/openai-2026-10-08.json`**: OpenAI table from
   developers.openai.com/api/docs/pricing: input, cached input, cache write, output, and a
   `long_prompt` tier over 272,000 input tokens (reuses the schema added in v1.6.21). The
   loader merges the newest OpenAI table into the model map it returns; Claude (`claude-*`) and
   OpenAI (`gpt-*`) model ids never collide, so the cost code is unchanged.
6. **`src/modules/transcript/dedupe.ts`** (shared): `dedupeAcrossSessions(sessions)` removes
   requests already counted in another session, keyed by a per-request id. Used by every
   command that aggregates several sessions, for both agents.
7. **`ParsedSession` additions**: `agent: AgentId`; `AssistantTurn.requestKey` (Claude:
   `message.id|requestId`; Codex: `response_id`, or `file:ordinal` for legacy events);
   `ParsedSession.isSubagent` (Codex subagent and auto-review threads; their spend is included
   in totals, and they are never picked as "your latest session").
8. **Shared session loading**: `src/modules/agents/loadSessions.ts` runs discovery, the
   `--here` filter (via a new `Agent.matchesCwd`), reading, parsing and `dedupeAcrossSessions`
   once, for every period command and both agents.
9. **Command and MCP changes**: `why`, `drift`, `receipt` and the MCP server move from direct
   Claude calls (`listAllSessions`, `parseTranscriptVerbose`) to the agent interface.
   A small `src/modules/agents/multi.ts` resolves "both installed" and renders the combined
   line and hint, so commands do not each reimplement it.

## Codex parsing rules (from openai/codex source, verified on real logs)

- **Token fields** (`TokenUsage`): `cached_input_tokens` and `cache_write_input_tokens` are
  subsets of `input_tokens`; `reasoning_output_tokens` is a subset of `output_tokens`;
  `total_tokens = input + output`. Mapping to `AssistantTurn`:
  `inputTokens = input − cached − cacheWrite` (clamped ≥ 0), `cacheReadTokens = cached`,
  `cacheCreationTokens = cacheWrite`, `outputTokens = output`. Reasoning is kept for display
  only and never added.
- **Per-request source, preferred**: `token_usage_record` lines (Codex ≥ 0.153). One record =
  one API response; key `response_id`; usage = `payload.usage`; model from the matching
  `turn_context.turn_id`. When a file has any record, `token_count` is ignored for summing.
- **Fallback for older files**: `event_msg` `token_count`. Skip `info: null`. Track the
  previous cumulative `total_token_usage` P. If the new total T equals P: duplicate, skip. If T
  advanced: the delta is `last_token_usage` when `P + last == T`, otherwise `T − P`. If T went
  backwards (context-window fill, reset): reset the baseline to T, count nothing. Skip deltas
  whose input, output and cached are all 0 (post-compaction estimates).
- **Model per turn**: `turn_context` (`turn_id → model, effort`); latest one as fallback.
  Unknown models (for example `codex-auto-review`, whose real model is not logged) are priced
  as "unknown" and shown as such, never as $0.
- **Long context**: requests with `input_tokens > 272,000` use the model's `long_prompt` rates.
- **Forks and subagents**: identified from line 1 `session_meta` (`forked_from_id`,
  `source.subagent…parent_thread_id`). Requests carry ids, so copies inherited from a parent are
  removed by `dedupeAcrossSessions`. Legacy files without records use the parent's cumulative
  totals as the child's starting baseline, so inherited events produce no delta. Subagent
  sessions (including Codex's auto-review helper) are reported as subagent spend.
- **Resume** appends to the same file: nothing extra. Later `session_meta` lines are ignored.
- **Tool calls**: `function_call` (`exec_command.cmd`, legacy `shell.command[]`,
  `shell_command.command`), `custom_tool_call` (`apply_patch`, patch text in `input`),
  `local_shell_call` (`action.command[]`); MCP calls have `mcp__` names. Paired to
  `function_call_output` / `custom_tool_call_output` by `call_id` for `resultTokens`
  (output text length / 4). Shell reads become `Read`-equivalent calls via `readDetect`, so the
  existing duplicate-read and idle-file analyzers work unchanged.

## Error handling

- Unreadable or missing files and folders are counted and reported, never silently skipped
  (same rule as the regression detector).
- A malformed line is skipped and counted (existing `E003` behaviour).
- A rollout with no usable token data yields an empty session and is excluded like today's
  empty Claude sessions.
- `.jsonl.zst` rollouts: counted as skipped and reported (not read in this piece).

## Testing and proof (release gate)

1. **Ground truth from Codex's own tests**: records `120, 200, 30 → thread total 230`; the
   Responses fixture `input 100, cached 40, cache_write 60, output 10, reasoning 5, total 110`.
   Plus one test per trap: duplicate `token_count`, `info: null`, post-compaction zero
   estimate, context-window reset, fork copy, subagent copy, resumed file.
2. **Anonymised slices of real logs**: structure and token numbers only (no messages, paths or
   commands).
3. **Independent cross-check**: a from-scratch counter (no shared code) run on the
   maintainer's real Codex logs must match Sipcode exactly on request count and tokens, and
   each session's total must match Codex's own final `total_token_usage` where the file has
   no resets. The same check is applied to Claude for the cross-file dedupe fix.
4. **Every command on real data** in three set-ups: Claude only, Codex only, both.
5. Each fix has a regression test proven to fail on the old code; CI on Ubuntu and Windows;
   publish only with the maintainer's approval.

## Risks and open points

- **Fork boundaries in legacy files**: whether `forked_from_ordinal_exclusive` /
  `subagent_history_start_ordinal` mark the inherited prefix exactly is not yet verified; the
  baseline-from-parent rule above does not depend on it. Verify against Codex's tests during
  implementation and use it only if confirmed.
- **Codex log format is "not a stable interface"** per OpenAI. Mitigation: tolerant parsing,
  per-version fixtures, the cross-check in CI.
- **Price table drift**: OpenAI renames models often. Unknown models show "price unknown"
  rather than a wrong number.
- **Output length** with both tools: period commands roughly double. Accepted (option B).
