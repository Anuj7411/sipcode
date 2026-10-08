import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseTranscript,
  parseTranscriptVerbose,
} from "../../../src/modules/transcript/parse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, "../../fixtures/transcripts");

const load = (name: string) =>
  readFileSync(path.join(fixtures, name), "utf-8");

describe("parseTranscript", () => {
  it("parses the minimal 2-turn fixture", () => {
    const r = parseTranscript(load("minimal-2turn.jsonl"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sessionId).toBe("minimal01");
    expect(r.value.assistantTurns.length).toBe(2);
    expect(r.value.toolCalls.length).toBe(1);
    expect(r.value.toolCalls[0]?.name).toBe("Write");
    expect(r.value.primaryModel).toBe("claude-sonnet-4");
  });

  it("parses read-heavy with 6 assistant turns and 5 reads", () => {
    const r = parseTranscript(load("read-heavy.jsonl"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.assistantTurns.length).toBe(6);
    const reads = r.value.toolCalls.filter((c) => c.name === "Read");
    expect(reads.length).toBe(5);
  });

  it("detects missingUsage on older-schema fixture", () => {
    const r = parseTranscript(load("older-schema-no-usage.jsonl"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.assistantTurns.every((t) => t.missingUsage)).toBe(true);
  });

  it("returns issues for malformed lines via verbose", () => {
    const { session, issues } = parseTranscriptVerbose(
      load("malformed-mid-stream.jsonl"),
    );
    expect(session.assistantTurns.length).toBeGreaterThanOrEqual(2);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0]?.code).toBe("E003");
  });

  it("handles empty file gracefully", () => {
    const r = parseTranscript(load("empty.jsonl"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.assistantTurns.length).toBe(0);
    expect(r.value.toolCalls.length).toBe(0);
  });

  it("captures multiple models distinctly", () => {
    const r = parseTranscript(load("multi-model.jsonl"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.models.size).toBe(2);
    expect(r.value.models.has("claude-haiku-4")).toBe(true);
    expect(r.value.models.has("claude-opus-4")).toBe(true);
  });

  it("computes duration in seconds", () => {
    const r = parseTranscript(load("minimal-2turn.jsonl"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.durationSec).toBe(46);
  });

  it("verbose returns empty issues on clean input", () => {
    const { issues } = parseTranscriptVerbose(load("minimal-2turn.jsonl"));
    expect(issues.length).toBe(0);
  });
});

// Regression (v1.6.21): Claude Code writes one line per content block of a
// response, and every line repeats the request's usage. Summing lines counted
// each request 2-3x on real sessions (measured 2.06x and 2.35x).
describe("parseTranscript: one API request split across lines", () => {
  const usage = {
    input_tokens: 3,
    output_tokens: 400,
    cache_read_input_tokens: 100_000,
    cache_creation_input_tokens: 2_000,
  };
  const line = (content: unknown[], u: Record<string, unknown> = usage) =>
    JSON.stringify({
      type: "assistant",
      requestId: "req_1",
      timestamp: "2026-09-01T10:00:00.000Z",
      message: { id: "msg_1", model: "claude-opus-5", role: "assistant", content, usage: u },
    });
  const jsonl = [
    line([{ type: "thinking", thinking: "" }]),
    line([{ type: "text", text: "Reading both files." }]),
    line([{ type: "tool_use", id: "tu_a", name: "Read", input: { file_path: "/p/a.ts" } }]),
    line([{ type: "tool_use", id: "tu_b", name: "Read", input: { file_path: "/p/b.ts" } }]),
    JSON.stringify({
      type: "user",
      timestamp: "2026-09-01T10:00:01.000Z",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tu_a", content: "x".repeat(4000) },
          { type: "tool_result", tool_use_id: "tu_b", content: [{ type: "text", text: "y".repeat(800) }] },
        ],
      },
    }),
  ].join("\n");

  it("counts the request once, not once per line", () => {
    const r = parseTranscript(jsonl);
    if (!r.ok) throw new Error("parse failed");
    expect(r.value.assistantTurns).toHaveLength(1);
    const t = r.value.assistantTurns[0]!;
    expect(t.cacheReadTokens).toBe(100_000);
    expect(t.outputTokens).toBe(400);
  });

  it("still collects tool calls from every line of the request", () => {
    const r = parseTranscript(jsonl);
    if (!r.ok) throw new Error("parse failed");
    expect(r.value.toolCalls.map((c) => c.id)).toEqual(["tu_a", "tu_b"]);
    expect(r.value.toolCalls.every((c) => c.assistantTurnIndex === 0)).toBe(true);
  });

  it("sizes each call by the tool_result it returned", () => {
    const r = parseTranscript(jsonl);
    if (!r.ok) throw new Error("parse failed");
    const [a, b] = r.value.toolCalls;
    expect(a!.resultTokens).toBe(1000); // 4000 chars / 4
    expect(b!.resultTokens).toBe(200); // text block, 800 chars / 4
  });

  it("uses the nested 5m/1h cache split when the top-level field is 0", () => {
    const r = parseTranscript(
      line([{ type: "text", text: "." }], {
        input_tokens: 1,
        output_tokens: 10,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_creation: { ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 4_700 },
      }),
    );
    if (!r.ok) throw new Error("parse failed");
    expect(r.value.assistantTurns[0]!.cacheCreationTokens).toBe(5_000);
  });
});
