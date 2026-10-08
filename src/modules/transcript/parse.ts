/**
 * Pure transcript parser. String in → ParsedSession out (via Result).
 *
 * Malformed lines emit E003 issues; the parser never throws.
 */
import { ok, type Result } from "../../lib/result.js";
import { issue, type SipcodeIssue } from "../../lib/errors.js";
import {
  TranscriptEntrySchema,
  type AssistantEntry,
  type UserEntry,
  type Usage,
} from "./schema.js";

export interface ToolCall {
  /** Tool name (e.g. "Read", "Bash"). */
  readonly name: string;
  /** Free-form tool input as parsed JSON. */
  readonly input: unknown;
  /** Assistant message index this call belongs to. */
  readonly assistantTurnIndex: number;
  /** ISO timestamp of the assistant message. */
  readonly timestamp: string | undefined;
  /** Sum of input_tokens + cache_creation_input_tokens for the parent assistant message. */
  readonly inputTokens: number;
  /** output_tokens for the parent assistant message. */
  readonly outputTokens: number;
  /** cache_read_input_tokens for the parent assistant message. */
  readonly cacheReadTokens: number;
  /** cache_creation_input_tokens for the parent assistant message. */
  readonly cacheCreationTokens: number;
  /** Total cost-weighted token count (input + output + cache_creation + cache_read, equal weights). */
  readonly totalTokens: number;
  /** tool_use id, used to pair the call with its tool_result. */
  readonly id?: string | undefined;
  /**
   * Estimated tokens of the tool_result this call returned (chars / 4). This is
   * what the call actually added to the context; 0 when no result was logged.
   */
  readonly resultTokens: number;
}

export interface AssistantTurn {
  readonly index: number;
  readonly model: string | undefined;
  readonly timestamp: string | undefined;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  /** Part of cacheCreationTokens written with the 1-hour TTL (billed at 2x input). */
  readonly cacheCreation1hTokens: number;
  /** Stable id of the API request (Claude: `message.id|requestId`; Codex: `response_id`).
   *  Used to drop the same request when it is logged again in another file. */
  readonly requestKey?: string | undefined;
  /** Tool calls emitted in this turn. */
  readonly toolCalls: ToolCall[];
  /** True if this turn had no usage block at all (older Claude Code). */
  readonly missingUsage: boolean;
}

export interface ParsedSession {
  readonly sessionId: string | undefined;
  readonly cwd: string | undefined;
  /** Primary model (most-frequent across turns). */
  readonly primaryModel: string | undefined;
  /** Distinct models used in the session. */
  readonly models: ReadonlySet<string>;
  /** Earliest assistant timestamp seen. */
  readonly startedAt: string | undefined;
  /** Latest assistant timestamp seen. */
  readonly endedAt: string | undefined;
  /** Wall-clock duration in seconds. */
  readonly durationSec: number;
  /** All assistant turns, in order. */
  readonly assistantTurns: ReadonlyArray<AssistantTurn>;
  /** Flat list of tool calls across the session. */
  readonly toolCalls: ReadonlyArray<ToolCall>;
  /** Number of user turns (prompt or tool_result wrapper). */
  readonly userTurnCount: number;
  /** Number of lines successfully parsed. */
  readonly linesParsed: number;
  /** Number of lines skipped due to malformed JSON or schema. */
  readonly linesSkipped: number;
  /** Which agent produced the transcript. Absent means claude-code (older callers). */
  readonly agent?: "claude-code" | "codex" | "cursor" | undefined;
  /** True for subagent / helper threads (Codex subagent rollouts). */
  readonly isSubagent?: boolean | undefined;
}

function usageNumbers(u: Usage | undefined): {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  cacheCreation1h: number;
} {
  // Claude Code before 2.1.152 could log the top-level cache_creation field as 0
  // while the nested 5m/1h breakdown held the real value.
  const nested = (u as { cache_creation?: Record<string, unknown> } | undefined)
    ?.cache_creation;
  const nested1h =
    nested && typeof nested === "object" ? Number(nested.ephemeral_1h_input_tokens ?? 0) || 0 : 0;
  const nestedSum =
    nested && typeof nested === "object"
      ? Number(nested.ephemeral_5m_input_tokens ?? 0) + nested1h
      : 0;
  return {
    input: u?.input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
    cacheRead: u?.cache_read_input_tokens ?? 0,
    cacheCreation: Math.max(u?.cache_creation_input_tokens ?? 0, nestedSum || 0),
    cacheCreation1h: nested1h,
  };
}

/** Rough token estimate for tool_result content (text blocks only). */
function resultChars(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const b of content) {
    if (b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string") {
      n += (b as { text: string }).text.length;
    }
  }
  return n;
}

/**
 * Parse a Claude Code .jsonl transcript.
 *
 * Returns `Result<ParsedSession, SipcodeIssue[]>`. Even with malformed lines,
 * a partial session is returned along with `E003` issues — the caller decides
 * whether to surface them.
 */
export function parseTranscript(
  contents: string,
): Result<ParsedSession, SipcodeIssue[]> {
  const issues: SipcodeIssue[] = [];
  const lines = contents.split(/\r?\n/);
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let firstTs: string | undefined;
  let lastTs: string | undefined;
  const modelCounts = new Map<string, number>();
  const assistantTurns: AssistantTurn[] = [];
  const toolCalls: ToolCall[] = [];
  // Claude Code writes one line per content block of a response, and every
  // line repeats the request's usage. One API request = one turn, so lines are
  // merged by message.id + requestId; summing them would count the request 2-3x.
  const turnByRequest = new Map<string, AssistantTurn>();
  const resultCharsById = new Map<string, number>();
  let userTurnCount = 0;
  let linesParsed = 0;
  let linesSkipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || raw.trim().length === 0) continue;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      linesSkipped++;
      issues.push(
        issue(
          "E003",
          `line ${i + 1}: not valid json (skipped). transcripts sometimes carry partial writes — sipcode keeps going.`,
        ),
      );
      continue;
    }

    const decoded = TranscriptEntrySchema.safeParse(parsedJson);
    if (!decoded.success) {
      linesSkipped++;
      issues.push(
        issue(
          "E003",
          `line ${i + 1}: schema mismatch (skipped). the transcript looks like a shape sipcode doesn't know.`,
        ),
      );
      continue;
    }

    linesParsed++;
    const entry = decoded.data;
    if (entry.sessionId && !sessionId) sessionId = entry.sessionId;
    const e = entry as unknown as { cwd?: string };
    if (e.cwd && !cwd) cwd = e.cwd;

    if (entry.type === "assistant") {
      const a = entry as AssistantEntry;
      const msg = a.message ?? {};
      const model = msg.model;
      const ts = a.timestamp;
      if (ts) {
        if (!firstTs || ts < firstTs) firstTs = ts;
        if (!lastTs || ts > lastTs) lastTs = ts;
      }
      const usage = msg.usage;
      const u = usageNumbers(usage);
      const msgId = (msg as { id?: unknown }).id;
      const reqId = (a as { requestId?: unknown }).requestId;
      const requestKey =
        typeof msgId === "string" && msgId.length > 0
          ? `${msgId}|${typeof reqId === "string" ? reqId : ""}`
          : undefined;

      let turn = requestKey ? turnByRequest.get(requestKey) : undefined;
      if (turn) {
        // Another content block of a request we already counted. Keep the
        // largest value per field (streamed lines can carry partial output).
        const t = turn as {
          -readonly [K in keyof AssistantTurn]: AssistantTurn[K];
        };
        t.inputTokens = Math.max(t.inputTokens, u.input);
        t.outputTokens = Math.max(t.outputTokens, u.output);
        t.cacheReadTokens = Math.max(t.cacheReadTokens, u.cacheRead);
        t.cacheCreationTokens = Math.max(t.cacheCreationTokens, u.cacheCreation);
        t.cacheCreation1hTokens = Math.max(t.cacheCreation1hTokens, u.cacheCreation1h);
        if (usage) t.missingUsage = false;
      } else {
        if (model) {
          modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
        }
        turn = {
          index: assistantTurns.length,
          model,
          timestamp: ts,
          inputTokens: u.input,
          outputTokens: u.output,
          cacheReadTokens: u.cacheRead,
          cacheCreationTokens: u.cacheCreation,
          cacheCreation1hTokens: u.cacheCreation1h,
          toolCalls: [],
          missingUsage: !usage,
          requestKey,
        };
        assistantTurns.push(turn);
        if (requestKey) turnByRequest.set(requestKey, turn);
      }
      // Find tool_use contents. Per-call usage fields are filled in after the
      // loop, once every line of the request has been merged.
      const contents = Array.isArray(msg.content) ? msg.content : [];
      for (const c of contents) {
        if (c && typeof c === "object" && (c as { type?: string }).type === "tool_use") {
          const tu = c as { id?: string; name?: string; input?: unknown };
          const call: ToolCall = {
            name: tu.name ?? "(unknown)",
            input: tu.input,
            assistantTurnIndex: turn.index,
            timestamp: ts,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            totalTokens: 0,
            id: typeof tu.id === "string" ? tu.id : undefined,
            resultTokens: 0,
          };
          turn.toolCalls.push(call);
          toolCalls.push(call);
        }
      }
    } else if (entry.type === "user") {
      const u = entry as UserEntry;
      const ts = u.timestamp;
      if (ts) {
        if (!firstTs || ts < firstTs) firstTs = ts;
        if (!lastTs || ts > lastTs) lastTs = ts;
      }
      // Skip tool_result-only wrappers when counting user turns.
      const content = u.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          const tr = c as { type?: string; tool_use_id?: unknown; content?: unknown };
          if (tr && tr.type === "tool_result" && typeof tr.tool_use_id === "string") {
            resultCharsById.set(tr.tool_use_id, resultChars(tr.content));
          }
        }
      }
      const isToolResultOnly =
        Array.isArray(content) &&
        content.every(
          (c) =>
            c != null &&
            typeof c === "object" &&
            (c as { type?: string }).type === "tool_result",
        );
      if (!isToolResultOnly) userTurnCount++;
    }
  }

  // Stamp each call with its (now fully merged) request usage and result size.
  for (const call of toolCalls) {
    const turn = assistantTurns[call.assistantTurnIndex];
    const c = call as { -readonly [K in keyof ToolCall]: ToolCall[K] };
    if (turn) {
      c.inputTokens = turn.inputTokens;
      c.outputTokens = turn.outputTokens;
      c.cacheReadTokens = turn.cacheReadTokens;
      c.cacheCreationTokens = turn.cacheCreationTokens;
      c.totalTokens =
        turn.inputTokens + turn.outputTokens + turn.cacheReadTokens + turn.cacheCreationTokens;
    }
    const chars = call.id ? resultCharsById.get(call.id) : undefined;
    c.resultTokens = chars ? Math.ceil(chars / 4) : 0;
  }

  // Pick primary model = most messages.
  let primaryModel: string | undefined;
  let bestCount = -1;
  for (const [m, c] of modelCounts) {
    if (c > bestCount) {
      bestCount = c;
      primaryModel = m;
    }
  }

  const durationSec =
    firstTs && lastTs
      ? Math.max(
          0,
          Math.floor(
            (new Date(lastTs).getTime() - new Date(firstTs).getTime()) / 1000,
          ),
        )
      : 0;

  const session: ParsedSession = {
    sessionId,
    cwd,
    primaryModel,
    models: new Set(modelCounts.keys()),
    startedAt: firstTs,
    endedAt: lastTs,
    durationSec,
    assistantTurns,
    toolCalls,
    userTurnCount,
    linesParsed,
    linesSkipped,
    agent: "claude-code",
  };

  // Issues are non-fatal in this milestone — they ride along with a partial
  // session. Callers that want issues use parseTranscriptVerbose.
  void issues;
  return ok(session);
}

/**
 * Same as parseTranscript but also surfaces the per-line E003 issues. The
 * scan re-walks lines (a no-op when there are no malformed lines), which is
 * trivial compared to JSON.parse cost on the main pass.
 */
export function parseTranscriptVerbose(
  contents: string,
): { session: ParsedSession; issues: SipcodeIssue[] } {
  const issues: SipcodeIssue[] = [];
  const r = parseTranscript(contents);
  // parseTranscript is pure-runner contract: never errs. r.ok is always true.
  const session = r.ok ? r.value : ({} as ParsedSession);
  const lines = contents.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || raw.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(raw);
      const decoded = TranscriptEntrySchema.safeParse(parsed);
      if (!decoded.success) {
        issues.push(
          issue("E003", `line ${i + 1}: schema mismatch (skipped).`),
        );
      }
    } catch {
      issues.push(issue("E003", `line ${i + 1}: not valid json (skipped).`));
    }
  }
  return { session, issues };
}
