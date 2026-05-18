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
}

export interface AssistantTurn {
  readonly index: number;
  readonly model: string | undefined;
  readonly timestamp: string | undefined;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
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
}

function usageNumbers(u: Usage | undefined): {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
} {
  return {
    input: u?.input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
    cacheRead: u?.cache_read_input_tokens ?? 0,
    cacheCreation: u?.cache_creation_input_tokens ?? 0,
  };
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
      if (model) {
        modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
      }
      const ts = a.timestamp;
      if (ts) {
        if (!firstTs || ts < firstTs) firstTs = ts;
        if (!lastTs || ts > lastTs) lastTs = ts;
      }
      const usage = msg.usage;
      const u = usageNumbers(usage);
      const turn: AssistantTurn = {
        index: assistantTurns.length,
        model,
        timestamp: ts,
        inputTokens: u.input,
        outputTokens: u.output,
        cacheReadTokens: u.cacheRead,
        cacheCreationTokens: u.cacheCreation,
        toolCalls: [],
        missingUsage: !usage,
      };
      // Find tool_use contents.
      const contents = Array.isArray(msg.content) ? msg.content : [];
      const turnTotal =
        u.input + u.output + u.cacheRead + u.cacheCreation;
      for (const c of contents) {
        if (c && typeof c === "object" && (c as { type?: string }).type === "tool_use") {
          const tu = c as { name?: string; input?: unknown };
          const call: ToolCall = {
            name: tu.name ?? "(unknown)",
            input: tu.input,
            assistantTurnIndex: turn.index,
            timestamp: ts,
            inputTokens: u.input,
            outputTokens: u.output,
            cacheReadTokens: u.cacheRead,
            cacheCreationTokens: u.cacheCreation,
            totalTokens: turnTotal,
          };
          turn.toolCalls.push(call);
          toolCalls.push(call);
        }
      }
      assistantTurns.push(turn);
    } else if (entry.type === "user") {
      const u = entry as UserEntry;
      const ts = u.timestamp;
      if (ts) {
        if (!firstTs || ts < firstTs) firstTs = ts;
        if (!lastTs || ts > lastTs) lastTs = ts;
      }
      // Skip tool_result-only wrappers when counting user turns.
      const content = u.message?.content;
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
