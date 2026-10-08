import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseTranscript,
  scanClaudeRequestKeys,
} from "../../../src/modules/transcript/parse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, "../../fixtures/transcripts");

function assistant(opts: {
  msg?: string;
  req?: string;
  ts?: string;
  blocks?: unknown[];
}): string {
  return JSON.stringify({
    parentUuid: null,
    type: "assistant",
    ...(opts.req !== undefined ? { requestId: opts.req } : {}),
    ...(opts.ts ? { timestamp: opts.ts } : {}),
    sessionId: "s",
    message: {
      ...(opts.msg ? { id: opts.msg } : {}),
      model: "claude-opus-5",
      role: "assistant",
      content: opts.blocks ?? [{ type: "text", text: "." }],
      usage: { input_tokens: 1, output_tokens: 2 },
    },
  });
}

const synthetic: Record<string, string> = {
  "no requestId": [
    assistant({ msg: "msg_a", ts: "2026-09-01T10:00:00Z" }),
    assistant({ msg: "msg_b", req: "req_b", ts: "2026-09-01T10:00:05Z" }),
  ].join("\n"),
  "no message.id": [
    assistant({ req: "req_x", ts: "2026-09-01T10:00:00Z" }),
    assistant({ req: "req_x", ts: "2026-09-01T10:00:01Z" }),
    assistant({ msg: "msg_k", req: "req_k", ts: "2026-09-01T10:00:02Z" }),
  ].join("\n"),
  "multi-line merged request": [
    assistant({ msg: "msg_m", req: "req_m", ts: "2026-09-01T10:00:00Z", blocks: [{ type: "thinking" }] }),
    assistant({ msg: "msg_m", req: "req_m", ts: "2026-09-01T10:00:01Z", blocks: [{ type: "text", text: "a" }] }),
    assistant({
      msg: "msg_m",
      req: "req_m",
      ts: "2026-09-01T10:00:02Z",
      blocks: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/a" } }],
    }),
  ].join("\n"),
  "user lines with tool_result": [
    JSON.stringify({ type: "user", timestamp: "2026-09-01T09:59:00Z", sessionId: "s", message: { role: "user", content: "hello" } }),
    assistant({
      msg: "msg_t",
      req: "req_t",
      ts: "2026-09-01T10:00:00Z",
      blocks: [{ type: "tool_use", id: "toolu_9", name: "Read", input: { file_path: "/a" } }],
    }),
    JSON.stringify({
      type: "user",
      timestamp: "2026-09-01T10:00:09Z",
      sessionId: "s",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_9", content: "msg text with \"type\":\"assistant\" inside" }] },
    }),
  ].join("\n"),
  "summary and system lines with timestamps": [
    JSON.stringify({ type: "summary", summary: "x", leafUuid: "u", timestamp: "2026-01-01T00:00:00Z" }),
    JSON.stringify({ type: "system", subtype: "info", timestamp: "2027-01-01T00:00:00Z", content: "z" }),
    assistant({ msg: "msg_s", req: "req_s", ts: "2026-09-01T10:00:00Z" }),
  ].join("\n"),
  "truncated final write is skipped": [
    assistant({ msg: "msg_ok", req: "req_ok", ts: "2026-09-01T10:00:00Z" }),
    assistant({ msg: "msg_cut", req: "req_cut", ts: "2026-09-01T10:00:09Z" }).slice(0, 120),
  ].join("\n"),
  "CRLF line endings and blank lines": [
    assistant({ msg: "msg_c", req: "req_c", ts: "2026-09-01T10:00:00Z" }),
    "",
    assistant({ msg: "msg_d", req: "req_d", ts: "2026-09-01T10:00:03Z" }),
  ].join("\r\n"),
  "assistant line without timestamp": [
    assistant({ msg: "msg_n", req: "req_n" }),
    assistant({ msg: "msg_o", req: "req_o", ts: "2026-09-01T10:00:03Z" }),
  ].join("\n"),
  "non msg_ ids (synthetic uuid message)": [
    assistant({ msg: "9bb66ef8-cb0c-46c7-8a16-75dd24b8e139", ts: "2026-09-01T10:00:00Z" }),
    assistant({ msg: "msg_z", req: "req_z", ts: "2026-09-01T10:00:01Z" }),
  ].join("\n"),
  "no message.id but tool_use id in content": [
    assistant({
      req: "req_q",
      ts: "2026-09-01T10:00:00Z",
      blocks: [{ type: "tool_use", id: "toolu_77", name: "Read", input: { file_path: "/a" } }],
    }),
  ].join("\n"),
  empty: "",
};

function expectEquivalent(content: string): void {
  const r = parseTranscript(content);
  if (!r.ok) throw new Error("parse failed");
  const scan = scanClaudeRequestKeys(content);
  const parsedKeys = r.value.assistantTurns
    .map((t) => t.requestKey)
    .filter((k): k is string => Boolean(k));
  expect(scan.keys).toEqual(parsedKeys);
  expect(scan.keylessTurns).toBe(r.value.assistantTurns.length - parsedKeys.length);
  expect(scan.startedAt).toBe(r.value.startedAt);
  expect(scan.endedAt).toBe(r.value.endedAt);
}

describe("scanClaudeRequestKeys equivalence with parseTranscript", () => {
  for (const f of readdirSync(fixtures).filter((n) => n.endsWith(".jsonl"))) {
    it(`fixture ${f}`, () => {
      expectEquivalent(readFileSync(path.join(fixtures, f), "utf-8"));
    });
  }
  for (const [name, content] of Object.entries(synthetic)) {
    it(`synthetic: ${name}`, () => {
      expectEquivalent(content);
    });
  }
});
