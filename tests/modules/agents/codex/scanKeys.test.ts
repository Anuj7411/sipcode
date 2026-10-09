/**
 * scanCodexRequestKeys must give cross-file dedupe exactly what the parser
 * gives it: request keys (first-seen order), keyless turn count, first and
 * last timestamp.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCodexRollout, scanCodexRequestKeys } from "../../../../src/modules/agents/codex/parse.js";
import { codexAgent } from "../../../../src/modules/agents/codex/adapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, "../../../fixtures/codex");

const L = (type: string, payload: object, ts = "2026-10-01T10:00:00.000Z") => JSON.stringify({ timestamp: ts, type, payload });
const meta = (extra: object = {}) => L("session_meta", { id: "t1", session_id: "t1", cwd: "C:\\p", cli_version: "0.160.0", source: "cli", ...extra }, "2026-10-01T09:59:00.000Z");
const ctx = (turnId: string, ts?: string) => L("turn_context", { turn_id: turnId, model: "gpt-5.5", cwd: "C:\\p" }, ts);
const usage = (input: number, output: number) => ({ input_tokens: input, cached_input_tokens: 0, output_tokens: output, total_tokens: input + output });
const rec = (rid: string | undefined, u: object, thread?: object, ts?: string) =>
  L("token_usage_record", { turn_id: "u1", ...(rid ? { response_id: rid } : {}), usage: u, ...(thread ? { thread_token_usage: thread } : {}) }, ts);
const tc = (total: object, last: object, ts?: string) => L("event_msg", { type: "token_count", info: { total_token_usage: total, last_token_usage: last } }, ts);
const item = (ts: string, text = "x") => L("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text }] }, ts);

function expected(content: string) {
  const p = parseCodexRollout(content);
  if (!p.ok) throw new Error("parse failed");
  const turns = p.value.assistantTurns;
  return {
    keys: turns.filter((t) => t.requestKey !== undefined).map((t) => t.requestKey),
    keylessTurns: turns.filter((t) => t.requestKey === undefined).length,
    startedAt: p.value.startedAt,
    endedAt: p.value.endedAt,
  };
}

const synthetic: Record<string, string[]> = {
  "records with response ids": [meta(), ctx("u1"), rec("r1", usage(10, 1), undefined, "2026-10-01T10:01:00.000Z"), item("2026-10-01T10:02:00.000Z"), rec("r2", usage(20, 2), undefined, "2026-10-01T10:03:00.000Z")],
  "record without response id (thread key) and a repeat": [meta(), rec(undefined, usage(10, 1), usage(10, 1)), rec("r1", usage(5, 1)), rec("r1", usage(5, 1))],
  "record without response id and without thread (keyless)": [meta(), rec(undefined, usage(10, 1)), rec(undefined, usage(10, 1))],
  "legacy token_count with repeat and reset": [
    meta(),
    tc(usage(10, 1), usage(10, 1), "2026-10-01T10:01:00.000Z"),
    tc(usage(10, 1), usage(10, 1), "2026-10-01T10:01:30.000Z"),
    tc(usage(30, 2), usage(20, 1), "2026-10-01T10:02:00.000Z"),
    tc(usage(5, 1), usage(5, 1), "2026-10-01T10:03:00.000Z"),
    tc(usage(9, 2), usage(4, 1), "2026-10-01T10:04:00.000Z"),
  ],
  "token_count turns popped by the first record": [
    meta(),
    tc(usage(10, 1), usage(10, 1)),
    tc(usage(30, 2), usage(20, 1)),
    tc(usage(60, 3), usage(30, 1)),
    // thread total 63 - this request 33 = 30: the 63-total turn came after.
    rec("r9", usage(30, 3), usage(60, 3)),
    rec("r10", usage(1, 1), usage(62, 4)),
  ],
  "no session_meta: legacy turns are keyless": [tc(usage(10, 1), usage(10, 1)), tc(usage(30, 2), usage(20, 1))],
  "agent message mentioning token_count is not a token line": [
    meta(),
    L("event_msg", { type: "agent_message", message: 'the "token_count" event' }, "2026-10-01T11:00:00.000Z"),
    rec("r1", usage(1, 1)),
  ],
  "lines in another layout are parsed exactly": [
    meta(),
    JSON.stringify({ type: "response_item", timestamp: "2026-09-30T08:00:00.000Z", payload: { type: "message" } }),
    JSON.stringify({ type: "token_usage_record", payload: { response_id: "late", usage: usage(1, 1) }, timestamp: "2026-10-02T08:00:00.000Z" }),
    '{"timestamp":"2026-10-03T00:00:00.000Z","type":"response_item","payload":"not an object"}',
  ],
  "ordinal field, CRLF and blank lines": [
    '{"timestamp":"2026-10-01T10:00:00.000Z","ordinal":0,"type":"session_meta","payload":{"id":"o1","session_id":"o1"}}\r',
    "",
    '{"timestamp":"2026-10-01T10:00:05.000Z","ordinal":1,"type":"response_item","payload":{"type":"message"}}\r',
    '{"timestamp":"2026-10-01T10:00:06.000Z","ordinal":2,"type":"token_usage_record","payload":{"response_id":"o-r1","usage":{"input_tokens":3,"output_tokens":1,"total_tokens":4}}}',
    "   ",
  ],
  "timestamps out of order and empty": [meta(), item("2026-10-05T00:00:00.000Z"), item(""), item("2026-09-01T00:00:00.000Z"), rec("r1", usage(1, 1))],
  "a cut-short last line is skipped": [meta(), rec("r1", usage(1, 1)), item("2026-12-01T00:00:00.000Z").slice(0, 60) + "}"],
};

describe("scanCodexRequestKeys", () => {
  for (const [name, lines] of Object.entries(synthetic)) {
    it(`matches the parser: ${name}`, () => {
      const content = lines.join("\n");
      expect(scanCodexRequestKeys(content)).toEqual(expected(content));
    });
  }

  it("a line broken in the middle that still ends with a brace: same requests, its timestamp is read (as the Claude Code scan does)", () => {
    const content = [meta(), '{"timestamp":"2026-12-01T00:00:00.000Z","type":"response_item","payload":{"a":}', rec("r1", usage(1, 1))].join("\n");
    const s = scanCodexRequestKeys(content);
    const e = expected(content);
    expect({ keys: s.keys, keylessTurns: s.keylessTurns, startedAt: s.startedAt }).toEqual({ keys: e.keys, keylessTurns: e.keylessTurns, startedAt: e.startedAt });
    expect(s.endedAt).toBe("2026-12-01T00:00:00.000Z");
  });

  it("matches the parser on every Codex fixture", () => {
    const names = readdirSync(fixtures).filter((n) => n.endsWith(".jsonl"));
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      const content = readFileSync(path.join(fixtures, n), "utf-8");
      expect(scanCodexRequestKeys(content), n).toEqual(expected(content));
    }
  });

  it("is the Codex adapter's scanRequestKeys", () => {
    const content = synthetic["records with response ids"]!.join("\n");
    expect(codexAgent.scanRequestKeys?.(content)).toEqual(expected(content));
  });
});
