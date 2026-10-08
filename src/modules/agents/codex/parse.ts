/**
 * Codex rollout (~/.codex/sessions/**\/rollout-*.jsonl) → ParsedSession. Pure.
 *
 * Token rules (openai/codex codex-api/src/sse/responses.rs, protocol.rs):
 *   cached_input_tokens and cache_write_input_tokens are SUBSETS of input_tokens;
 *   reasoning_output_tokens is a SUBSET of output_tokens; total = input + output.
 *   AssistantTurn.inputTokens is therefore input - cached - write, so cached
 *   tokens are never billed twice.
 *
 * Per-request source: token_usage_record (Codex >= 0.153), keyed by response_id.
 * Older files: event_msg token_count, one turn per change of the cumulative
 * total. The delta is last_token_usage when it accounts for the change exactly,
 * otherwise total - previous total (Codex sometimes logs an estimate with zero
 * input/output as last_token_usage after a real request; the cumulative total
 * still holds the real usage). A file resumed under a newer Codex keeps its
 * token_count turns from before the first record.
 *
 * Tools: shell reads become Read calls (absolute file_path, resolved against
 * the call's workdir), apply_patch becomes one Edit per file, everything else
 * keeps its own name (shell commands as Bash). A read whose output shows it
 * failed stays a Bash call, so a failed read and its retry are not duplicates.
 */
import path from "node:path";
import { ok, type Result } from "../../../lib/result.js";
import type { SipcodeIssue } from "../../../lib/errors.js";
import type { AssistantTurn, ParsedSession, ToolCall } from "../../transcript/parse.js";
import { detectShellRead, unwrapShellArgv } from "./readDetect.js";

interface Usage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

export interface CodexMeta {
  readonly id?: string | undefined;
  readonly rootSessionId?: string | undefined;
  readonly cwd?: string | undefined;
  readonly cliVersion?: string | undefined;
  readonly isSubagent: boolean;
}

type Line = { timestamp?: string; type?: string; payload?: Record<string, unknown> };

function parseLine(raw: string): Line | undefined {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Line) : undefined;
  } catch {
    return undefined;
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

function metaFrom(p: Record<string, unknown> | undefined): CodexMeta {
  const source = p?.source as { subagent?: unknown } | string | undefined;
  const isSubagent =
    (typeof source === "object" && source !== null && "subagent" in source) ||
    typeof p?.parent_thread_id === "string";
  return {
    id: str(p?.id),
    rootSessionId: str(p?.session_id) ?? str(p?.id),
    cwd: str(p?.cwd),
    cliVersion: str(p?.cli_version),
    isSubagent,
  };
}

/** Line 1 only (later session_meta lines are copies inherited by forks). */
export function parseCodexMeta(content: string): CodexMeta {
  const nl = content.indexOf("\n");
  const l = parseLine(nl >= 0 ? content.slice(0, nl) : content);
  return l?.type === "session_meta" ? metaFrom(l.payload) : { isSubagent: false };
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function split(u: Usage): Pick<AssistantTurn, "inputTokens" | "cacheReadTokens" | "cacheCreationTokens" | "outputTokens"> {
  const input = n(u.input_tokens);
  const cached = Math.min(n(u.cached_input_tokens), input);
  const write = Math.min(n(u.cache_write_input_tokens), input - cached);
  return { inputTokens: input - cached - write, cacheReadTokens: cached, cacheCreationTokens: write, outputTokens: n(u.output_tokens) };
}

const USAGE_KEYS = ["input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"] as const;

function minus(a: Usage, b: Usage): Usage {
  const out: Usage = {};
  for (const key of USAGE_KEYS) out[key] = Math.max(0, n(a[key]) - n(b[key]));
  return out;
}

function sameUsage(a: Usage, b: Usage): boolean {
  return n(a.input_tokens) === n(b.input_tokens) && n(a.cached_input_tokens) === n(b.cached_input_tokens) &&
    n(a.output_tokens) === n(b.output_tokens) && n(a.total_tokens) === n(b.total_tokens);
}

function outputText(o: unknown): string {
  if (typeof o === "string") return o;
  if (Array.isArray(o)) return o.map((x) => (x && typeof x === "object" && typeof (x as { text?: unknown }).text === "string" ? (x as { text: string }).text : "")).join("");
  return "";
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const WIN_ABS = /^(?:[A-Za-z]:[\\/]|\\\\)/; // C:\x, C:/x, \\server\share
const looksWindows = (s: string): boolean => /^[A-Za-z]:/.test(s) || s.includes("\\");

/**
 * Absolute form of `p`, resolved against `base` (the call's working directory).
 * Never consults the process cwd: a relative path with no absolute base is
 * returned unchanged.
 */
function resolveAgainst(p: string, base: string | undefined): string {
  const win = looksWindows(p) || (base !== undefined && looksWindows(base));
  if (win) {
    if (WIN_ABS.test(p)) return path.win32.normalize(p);
    if (p.startsWith("/")) return p; // POSIX-style path on a Windows base: leave it alone
    if (base && WIN_ABS.test(base)) return path.win32.resolve(base, p);
    return p;
  }
  if (p.startsWith("/")) return path.posix.normalize(p);
  if (base && base.startsWith("/")) return path.posix.resolve(base, p);
  return p;
}

// ---------------------------------------------------------------------------
// Tool calls
// ---------------------------------------------------------------------------

/** Read call candidate: becomes Read unless its output shows the command failed. */
interface PendingCall {
  name: string;
  input: unknown;
  callId: string | undefined;
  ts: string | undefined;
  /** Set for detected shell reads; `input` then holds the Bash fallback. */
  readPath?: string | undefined;
}

function patchFiles(patch: string): string[] {
  const files: string[] = [];
  for (const m of patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)) files.push(m[1]!.trim());
  return files;
}

/**
 * Object literals passed to `tools.exec_command(...)` inside a JavaScript `exec`
 * custom tool call (newer Codex desktop). The literal is JSON; unparsable ones
 * are skipped.
 */
export function execWrappedCommands(code: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const re = /\btools\.exec_command\s*\(\s*\{/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const start = m.index + m[0].length - 1;
    let depth = 0;
    let quote: string | null = null;
    let end = -1;
    for (let i = start; i < code.length; i++) {
      const ch = code[i]!;
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) { end = i; break; }
    }
    if (end < 0) continue; // unbalanced (e.g. a match inside a comment): try the next match
    try {
      const v = JSON.parse(code.slice(start, end + 1)) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) out.push(v as Record<string, unknown>);
    } catch {
      /* not plain JSON: skip */
    }
    re.lastIndex = end + 1;
  }
  return out;
}

interface CallContext {
  ts: string | undefined;
  /** Working directory used when the call gives none (turn cwd, else session cwd). */
  cwd: string | undefined;
}

function shellCall(command: string, workdir: string | undefined, callId: string | undefined, c: CallContext): PendingCall[] {
  const base = workdir ? resolveAgainst(workdir, c.cwd) : c.cwd;
  if (/^\s*(?:apply_patch|applypatch)\b/.test(command) && command.includes("*** Begin Patch")) {
    const files = patchFiles(command);
    if (files.length) return files.map((f) => ({ name: "Edit", input: { file_path: resolveAgainst(f, base) }, callId, ts: c.ts }));
  }
  const read = detectShellRead(command);
  if (read) {
    const abs = resolveAgainst(read.path, base);
    return [{ name: "Bash", input: { command }, callId, ts: c.ts, readPath: read.range ? `${abs}#${read.range}` : abs }];
  }
  return [{ name: "Bash", input: { command }, callId, ts: c.ts }];
}

function toCalls(p: Record<string, unknown>, c: CallContext): { calls: PendingCall[]; wrapped: number } {
  const type = p.type;
  const callId = str(p.call_id);
  const name = typeof p.name === "string" ? p.name : String(type);
  let args: Record<string, unknown> = {};
  if (type === "function_call" && typeof p.arguments === "string") {
    try {
      const v = JSON.parse(p.arguments) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) args = v as Record<string, unknown>;
    } catch { /* keep {} */ }
  }

  if (type === "local_shell_call") {
    const action = p.action as { command?: unknown; working_directory?: unknown } | undefined;
    const cmd = action?.command;
    if (Array.isArray(cmd)) {
      const argv = cmd.map(String);
      if (/^(?:apply_patch|applypatch)$/.test(argv[0] ?? "") && typeof argv[1] === "string") {
        return { calls: patchCalls(argv[1], undefined, callId, c), wrapped: 0 };
      }
      return { calls: shellCall(unwrapShellArgv(argv), str(action?.working_directory), callId, c), wrapped: 0 };
    }
    return { calls: [{ name: "shell", input: p.action, callId, ts: c.ts }], wrapped: 0 };
  }
  if (type === "function_call") {
    if (name === "exec_command" && typeof args.cmd === "string") return { calls: shellCall(args.cmd, str(args.workdir), callId, c), wrapped: 0 };
    if (name === "shell_command" && typeof args.command === "string") return { calls: shellCall(args.command, str(args.workdir), callId, c), wrapped: 0 };
    if ((name === "shell" || name === "container.exec") && Array.isArray(args.command)) {
      const argv = args.command.map(String);
      if (/^(?:apply_patch|applypatch)$/.test(argv[0] ?? "") && typeof argv[1] === "string") {
        return { calls: patchCalls(argv[1], str(args.workdir), callId, c), wrapped: 0 };
      }
      return { calls: shellCall(unwrapShellArgv(argv), str(args.workdir), callId, c), wrapped: 0 };
    }
  }
  if (type === "custom_tool_call" && name === "exec" && typeof p.input === "string") {
    const inner = execWrappedCommands(p.input).filter((a) => typeof a.cmd === "string");
    if (inner.length) {
      return { calls: inner.flatMap((a) => shellCall(a.cmd as string, str(a.workdir), callId, c)), wrapped: inner.length };
    }
  }
  if (name === "apply_patch") {
    const text = typeof p.input === "string" ? p.input : typeof args.input === "string" ? args.input : "";
    const calls = patchCalls(text, undefined, callId, c);
    if (calls.length) return { calls, wrapped: 0 };
  }
  return { calls: [{ name, input: type === "custom_tool_call" ? { input: p.input } : args, callId, ts: c.ts }], wrapped: 0 };
}

function patchCalls(patch: string, workdir: string | undefined, callId: string | undefined, c: CallContext): PendingCall[] {
  const base = workdir ? resolveAgainst(workdir, c.cwd) : c.cwd;
  return patchFiles(patch).map((f) => ({ name: "Edit", input: { file_path: resolveAgainst(f, base) }, callId, ts: c.ts }));
}

// ---------------------------------------------------------------------------
// Did a shell command fail?
// ---------------------------------------------------------------------------

const READ_CMD = "(?:get-content|gc|cat|head|tail|sed|type|more|less|bat)";
const ERR_PHRASE =
  "(?:cannot find path|no such file or directory|cannot open|can't read|does not exist|is a directory|permission denied|access is denied|access to the path .* is denied)";
const READ_ALIAS = "(?:cat|type|head|tail|sed|more|less|bat)";
// First line of a read command's error output. Anchored to each tool's own
// layout so a file whose first line merely mentions such a phrase stays a read:
// PowerShell "Get-Content : <msg>" / "cat : <msg>" (alias), coreutils
// "cat: <path>: <msg>", cmd.exe "The system cannot find the file specified."
const READ_ERROR = new RegExp(
  `^(?:(?:get-content|gc)\\s*:.*${ERR_PHRASE}|${READ_ALIAS} : .*${ERR_PHRASE}|${READ_ALIAS}: .*: ${ERR_PHRASE}|the system cannot find the (?:file|path) specified)`,
  "i",
);
// PowerShell 7: "Get-Content:" alone on line 1, the message in a "     | ..." line below.
const PWSH7_HEAD = new RegExp(`^${READ_CMD}\\s*:\\s*$`, "i");
const PWSH7_MSG = new RegExp(`^\\s*\\|\\s*.*${ERR_PHRASE}`, "i");
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

function exitCodeOfJson(text: string): number | undefined {
  const t = text.trimStart();
  if (!t.startsWith("{")) return undefined;
  try {
    const v = JSON.parse(t) as { exit_code?: unknown; metadata?: { exit_code?: unknown } };
    if (typeof v.metadata?.exit_code === "number") return v.metadata.exit_code;
    if (typeof v.exit_code === "number") return v.exit_code;
  } catch { /* not JSON */ }
  return undefined;
}

function readErrorAtStart(body: string): boolean {
  const b = body
    .replace(ANSI, "")
    .replace(/^(?:Warning: truncated output[^\n]*\n(?:Total output lines:[^\n]*\n)?\n?)+/, "")
    .trimStart();
  const lines = b.split(/\r?\n/, 8);
  const first = lines[0] ?? "";
  if (READ_ERROR.test(first)) return true;
  return PWSH7_HEAD.test(first) && lines.slice(1).some((l) => PWSH7_MSG.test(l));
}

/**
 * True when the logged output shows the command did not succeed. Formats seen
 * in real rollouts: "Exit code: N\nWall time: ...\nOutput:\n..." (shell_command),
 * "Wall time: ...\naborted by user", JSON {output, metadata: {exit_code}}
 * (legacy shell), and for the JavaScript exec wrapper
 * "Script completed|Script failed\nWall time ...\nOutput:\n<body>", where the
 * inner exit code is only visible when the script printed the raw result.
 * Unified exec (exec_command, from the Codex binary's format strings):
 * "[Chunk ID: ..\n]Wall time: ..\n[Process exited with code N\n]...Output:\n<body>".
 */
export function shellOutputFailed(text: string): boolean {
  const code = /^Exit code: (-?\d+)/.exec(text);
  if (code) return Number(code[1]) !== 0;
  const json = exitCodeOfJson(text);
  if (json !== undefined) return json !== 0;
  if (/^Script failed\b/.test(text)) return true;
  if (/^Wall time[^\n]*\naborted\b/.test(text)) return true;
  if (/^(?:Chunk ID|Wall time):/.test(text)) {
    const at = text.indexOf("\nOutput:\n");
    const exited = /^Process exited with code (-?\d+)/m.exec(at >= 0 ? text.slice(0, at) : text);
    if (exited) return Number(exited[1]) !== 0;
    return at >= 0 && readErrorAtStart(text.slice(at + "\nOutput:\n".length));
  }
  if (/^Script (?:completed|running)\b/.test(text)) {
    const at = text.indexOf("Output:\n");
    const body = at >= 0 ? text.slice(at + "Output:\n".length) : "";
    const inner = exitCodeOfJson(body);
    if (inner !== undefined) return inner !== 0;
    return readErrorAtStart(body);
  }
  return readErrorAtStart(text);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** Diagnostics for validation scripts; not part of ParsedSession. */
export interface CodexParseStats {
  readonly execWrappedCommands: number;
  readonly failedReads: number;
  readonly droppedCalls: number;
  readonly usedRecords: boolean;
}

type RawTurn = {
  usage: Usage;
  model: string | undefined;
  ts: string | undefined;
  key: string | undefined;
  calls: PendingCall[];
  /** token_count turns: cumulative total after this turn. */
  cumulative?: number;
};

export function parseCodexRollout(content: string): Result<ParsedSession, SipcodeIssue[]> {
  return ok(parseCodexRolloutWithStats(content).session);
}

export function parseCodexRolloutWithStats(content: string): { session: ParsedSession; stats: CodexParseStats } {
  const lines = content.split(/\r?\n/);
  let meta: CodexMeta = { isSubagent: false };
  let metaSeen = false;
  const turnModel = new Map<string, string>();
  const turnIds = new Set<string>();
  let anonymousTurns = 0;
  let currentModel: string | undefined;
  let turnCwd: string | undefined;
  let firstTs: string | undefined;
  let lastTs: string | undefined;
  let parsed = 0;
  let skipped = 0;
  const outputs = new Map<string, string>();
  const seenCallIds = new Set<string>();
  let wrapped = 0;

  const turns: RawTurn[] = [];
  let pending: PendingCall[] = [];
  const seenKeys = new Set<string>();
  let recordSeen = false;
  let prevTotal: Usage | undefined;

  const push = (t: Omit<RawTurn, "calls">) => {
    turns.push({ ...t, calls: pending });
    pending = [];
  };

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const l = parseLine(raw);
    if (!l || !l.payload || typeof l.payload !== "object") { skipped++; continue; }
    parsed++;
    const ts = typeof l.timestamp === "string" ? l.timestamp : undefined;
    if (ts) {
      if (!firstTs || ts < firstTs) firstTs = ts;
      if (!lastTs || ts > lastTs) lastTs = ts;
    }
    const p = l.payload;
    if (l.type === "session_meta") {
      if (!metaSeen) { meta = metaFrom(p); metaSeen = true; }
      continue;
    }
    if (l.type === "turn_context") {
      const turnId = str(p.turn_id);
      if (typeof p.model === "string") {
        currentModel = p.model;
        if (turnId) turnModel.set(turnId, p.model);
      }
      if (str(p.cwd)) turnCwd = p.cwd as string;
      if (turnId) turnIds.add(turnId);
      else anonymousTurns++;
      continue;
    }
    if (l.type === "response_item") {
      const t = p.type;
      if (t === "function_call" || t === "custom_tool_call" || t === "local_shell_call") {
        const id = str(p.call_id);
        if (id) {
          if (seenCallIds.has(id)) continue; // copied item (fork history)
          seenCallIds.add(id);
        }
        const r = toCalls(p, { ts, cwd: turnCwd ?? meta.cwd });
        wrapped += r.wrapped;
        pending.push(...r.calls);
      } else if ((t === "function_call_output" || t === "custom_tool_call_output") && typeof p.call_id === "string") {
        if (!outputs.has(p.call_id)) outputs.set(p.call_id, outputText(p.output));
      }
      continue;
    }
    if (l.type === "token_usage_record") {
      const usage = (p.usage && typeof p.usage === "object" ? p.usage : {}) as Usage;
      const thread = (p.thread_token_usage && typeof p.thread_token_usage === "object" ? p.thread_token_usage : undefined) as Usage | undefined;
      if (!recordSeen) {
        recordSeen = true;
        // token_count turns logged before the first record (a file resumed under a
        // newer Codex) stay only if the thread total says they precede this record.
        if (thread) {
          const before = n(thread.total_tokens) - n(usage.total_tokens);
          while (turns.length) {
            const last = turns[turns.length - 1]!;
            if (last.cumulative === undefined || last.cumulative <= before) break;
            turns.pop();
            pending = [...last.calls, ...pending];
          }
        }
      }
      const root = meta.rootSessionId ?? meta.id;
      const key = str(p.response_id) ??
        (thread && root
          ? `codex:${root}:rec:${n(thread.total_tokens)}:${n(thread.input_tokens)}:${n(thread.cached_input_tokens)}:${n(thread.output_tokens)}`
          : undefined);
      if (key) {
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
      }
      const turnId = str(p.turn_id);
      const model = (turnId ? turnModel.get(turnId) : undefined) ?? currentModel;
      push({ usage, model, ts, key });
      continue;
    }
    if (l.type === "event_msg" && p.type === "token_count" && !recordSeen) {
      const info = p.info as { total_token_usage?: Usage; last_token_usage?: Usage } | null | undefined;
      if (!info?.total_token_usage || typeof info.total_token_usage !== "object") continue;
      const T = info.total_token_usage;
      const last = info.last_token_usage ?? {};
      if (prevTotal && sameUsage(T, prevTotal)) continue;
      // Cumulative total went backwards: the counter was reset; start a new baseline.
      if (prevTotal && n(T.total_tokens) < n(prevTotal.total_tokens)) { prevTotal = T; continue; }
      let delta: Usage = last;
      if (prevTotal) {
        const sum = n(prevTotal.total_tokens) + n(last.total_tokens);
        delta = sum === n(T.total_tokens) ? last : minus(T, prevTotal);
      }
      prevTotal = T;
      if (n(delta.input_tokens) === 0 && n(delta.output_tokens) === 0 && n(delta.cached_input_tokens) === 0) continue;
      // Key = root session + the FULL cumulative vector: fork copies (same root, same totals)
      // dedupe, while a subagent's own counter (restarting at 0) cannot realistically collide.
      const root = meta.rootSessionId ?? meta.id;
      const key = root
        ? `codex:${root}:${n(T.total_tokens)}:${n(T.input_tokens)}:${n(T.cached_input_tokens)}:${n(T.output_tokens)}`
        : undefined;
      if (key) {
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
      }
      push({ usage: delta, model: currentModel, ts, key, cumulative: n(T.total_tokens) });
    }
  }
  let droppedCalls = 0;
  if (pending.length) {
    if (turns.length) turns[turns.length - 1]!.calls.push(...pending);
    else droppedCalls = pending.length; // no request to attach them to
  }

  const assistantTurns: AssistantTurn[] = [];
  const toolCalls: ToolCall[] = [];
  const counts = new Map<string, number>();
  let failedReads = 0;
  turns.forEach((t, index) => {
    const tok = split(t.usage);
    const calls: ToolCall[] = [];
    const sizedIds = new Set<string>();
    for (const c of t.calls) {
      const out = c.callId !== undefined ? outputs.get(c.callId) : undefined;
      const chars = c.callId && !sizedIds.has(c.callId) && out !== undefined ? out.length : 0;
      if (c.callId) sizedIds.add(c.callId);
      let name = c.name;
      let input = c.input;
      if (c.readPath !== undefined) {
        if (out !== undefined && shellOutputFailed(out)) failedReads++;
        else { name = "Read"; input = { file_path: c.readPath }; }
      }
      calls.push({
        name, input, assistantTurnIndex: index, timestamp: c.ts,
        inputTokens: tok.inputTokens, outputTokens: tok.outputTokens, cacheReadTokens: tok.cacheReadTokens,
        cacheCreationTokens: tok.cacheCreationTokens,
        totalTokens: tok.inputTokens + tok.outputTokens + tok.cacheReadTokens + tok.cacheCreationTokens,
        id: c.callId, resultTokens: chars ? Math.ceil(chars / 4) : 0,
      });
    }
    if (t.model) counts.set(t.model, (counts.get(t.model) ?? 0) + 1);
    assistantTurns.push({ index, model: t.model, timestamp: t.ts, ...tok, cacheCreation1hTokens: 0, toolCalls: calls, missingUsage: false, requestKey: t.key });
    toolCalls.push(...calls);
  });
  let primaryModel: string | undefined;
  let best = -1;
  for (const [m, c] of counts) if (c > best) { best = c; primaryModel = m; }
  const durationSec = firstTs && lastTs ? Math.max(0, Math.floor((Date.parse(lastTs) - Date.parse(firstTs)) / 1000)) || 0 : 0;

  const session: ParsedSession = {
    sessionId: meta.id, cwd: meta.cwd, primaryModel, models: new Set(counts.keys()),
    startedAt: firstTs, endedAt: lastTs, durationSec, assistantTurns, toolCalls,
    userTurnCount: turnIds.size + anonymousTurns, linesParsed: parsed, linesSkipped: skipped,
    agent: "codex", isSubagent: meta.isSubagent,
  };
  return { session, stats: { execWrappedCommands: wrapped, failedReads, droppedCalls, usedRecords: recordSeen } };
}
