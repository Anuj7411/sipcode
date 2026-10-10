/**
 * Anonymised slices of real Codex rollouts (scripts/anonymise-rollout.mjs):
 * structure and token numbers are real, every message, path and command is
 * not. Expected numbers come from the independent counter
 * (scripts/verify-counts.mjs, readCodexFile) run on each fixture, and from
 * Codex's own final cumulative total in the file (none of these has a reset).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCodexRollout } from "../../../../src/modules/agents/codex/parse.js";
import { analyzeDuplicateReads } from "../../../../src/modules/transcript/analyzers/duplicateReads.js";
import type { ParsedSession } from "../../../../src/modules/transcript/parse.js";

const dir = path.resolve(__dirname, "../../../fixtures/codex");
const text = (name: string) => readFileSync(path.join(dir, name), "utf-8");
const parse = (name: string): ParsedSession => {
  const r = parseCodexRollout(text(name));
  if (!r.ok) throw new Error("parse failed");
  return r.value;
};
const sum = (s: ParsedSession, k: "inputTokens" | "cacheReadTokens" | "cacheCreationTokens" | "outputTokens") =>
  s.assistantTurns.reduce((n, t) => n + t[k], 0);

/** Codex's own last cumulative total: the last record's thread total, else the last token_count total. */
function codexFinalTotal(content: string): number {
  let fromCounts = 0;
  let fromRecords: number | undefined;
  for (const raw of content.split("\n")) {
    if (!raw.trim()) continue;
    const l = JSON.parse(raw) as {
      type?: string;
      payload?: {
        type?: string;
        thread_token_usage?: { total_tokens: number };
        info?: { total_token_usage: { total_tokens: number } } | null;
      };
    };
    if (l.type === "token_usage_record" && l.payload?.thread_token_usage) fromRecords = l.payload.thread_token_usage.total_tokens;
    if (l.type === "event_msg" && l.payload?.type === "token_count" && l.payload.info) fromCounts = l.payload.info.total_token_usage.total_tokens;
  }
  return fromRecords ?? fromCounts;
}

const FIXTURES = [
  {
    name: "legacy-token-count.jsonl",
    what: "token_count only, with repeated events, info:null and two zero-estimate events",
    expected: { requests: 65, total: 3_713_134, input: 417_751, cached: 3_271_296, write: 0, output: 24_087 },
    reads: { calls: 80, reads: 7, edits: 8, distinctFilesRead: 5, reReads: 2, duplicateReadTokenCost: 1402 },
    subagent: false,
  },
  {
    name: "token-usage-record.jsonl",
    what: "token_usage_record (Codex >= 0.153) next to token_count",
    expected: { requests: 47, total: 3_846_066, input: 131_845, cached: 3_705_344, write: 0, output: 8877 },
    reads: { calls: 45, reads: 5, edits: 0, distinctFilesRead: 5, reReads: 0, duplicateReadTokenCost: 0 },
    subagent: false,
  },
  {
    name: "subagent-records.jsonl",
    what: "a subagent thread with token_usage_record",
    expected: { requests: 9, total: 180_503, input: 36_391, cached: 143_104, write: 0, output: 1008 },
    reads: { calls: 0, reads: 0, edits: 0, distinctFilesRead: 0, reReads: 0, duplicateReadTokenCost: 0 },
    subagent: true,
  },
  {
    name: "compacted.jsonl",
    what: "token_count with a compacted line",
    expected: { requests: 145, total: 18_227_953, input: 2_088_070, cached: 16_040_832, write: 0, output: 99_051 },
    reads: { calls: 354, reads: 36, edits: 181, distinctFilesRead: 23, reReads: 13, duplicateReadTokenCost: 19_911 },
    subagent: false,
  },
] as const;

describe("parseCodexRollout on anonymised real rollouts", () => {
  for (const f of FIXTURES) {
    describe(`${f.name} (${f.what})`, () => {
      it("has the independent counter's request count and per-field sums", () => {
        const s = parse(f.name);
        const e = f.expected;
        expect(s.assistantTurns).toHaveLength(e.requests);
        expect(sum(s, "inputTokens")).toBe(e.input);
        expect(sum(s, "cacheReadTokens")).toBe(e.cached);
        expect(sum(s, "cacheCreationTokens")).toBe(e.write);
        expect(sum(s, "outputTokens")).toBe(e.output);
        expect(e.input + e.cached + e.write + e.output).toBe(e.total);
      });

      it("equals Codex's own final cumulative total", () => {
        const s = parse(f.name);
        const counted = s.assistantTurns.reduce(
          (n, t) => n + t.inputTokens + t.cacheReadTokens + t.cacheCreationTokens + t.outputTokens,
          0,
        );
        expect(counted).toBe(codexFinalTotal(text(f.name)));
      });

      it("keeps read, re-read and edit detection stable", () => {
        const s = parse(f.name);
        const d = analyzeDuplicateReads(s);
        expect(s.isSubagent).toBe(f.subagent);
        expect({
          calls: s.toolCalls.length,
          reads: s.toolCalls.filter((c) => c.name === "Read").length,
          edits: s.toolCalls.filter((c) => c.name === "Edit").length,
          distinctFilesRead: d.distinctFilesRead,
          reReads: d.topOffenders.reduce((n, o) => n + o.readCount - 1, 0),
          duplicateReadTokenCost: d.duplicateReadTokenCost,
        }).toEqual(f.reads);
      });
    });
  }
});
