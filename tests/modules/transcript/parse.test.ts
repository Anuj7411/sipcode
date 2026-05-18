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
