/** The per-request fields `sipcode regress` reads from Claude Code transcripts. */
import { describe, expect, it } from "vitest";
import { parseTranscript } from "../../../src/modules/transcript/parse.js";

const user = (content: unknown, ts = "2026-10-01T10:00:00.000Z") =>
  JSON.stringify({ type: "user", sessionId: "s", timestamp: ts, message: { role: "user", content } });

const assistant = (o: {
  id: string;
  version?: string;
  entrypoint?: string;
  isSidechain?: boolean;
  usage?: Record<string, unknown>;
  ts?: string;
}) =>
  JSON.stringify({
    type: "assistant",
    sessionId: "s",
    timestamp: o.ts ?? "2026-10-01T10:00:01.000Z",
    requestId: `req_${o.id}`,
    ...(o.version ? { version: o.version } : {}),
    ...(o.entrypoint ? { entrypoint: o.entrypoint } : {}),
    ...(o.isSidechain !== undefined ? { isSidechain: o.isSidechain } : {}),
    message: { id: `msg_${o.id}`, model: "claude-opus-4-8", role: "assistant", content: [{ type: "text", text: "." }], usage: o.usage ?? { input_tokens: 3, output_tokens: 10 } },
  });

function turns(lines: string[]) {
  const r = parseTranscript(lines.join("\n"));
  if (!r.ok) throw new Error("parse");
  return r.value.assistantTurns;
}

describe("parseTranscript: regress fields", () => {
  it("keeps version and entrypoint from the request's line", () => {
    const [t] = turns([user("hi"), assistant({ id: "a", version: "2.1.257", entrypoint: "cli" })]);
    expect(t!.version).toBe("2.1.257");
    expect(t!.entrypoint).toBe("cli");
    expect(t!.sidechain).toBeUndefined();
  });

  it("leaves version and entrypoint unset when the line has none", () => {
    const [t] = turns([assistant({ id: "a" })]);
    expect(t!.version).toBeUndefined();
    expect(t!.entrypoint).toBeUndefined();
  });

  it("marks sidechain requests", () => {
    const [a, b] = turns([assistant({ id: "a", isSidechain: true }), assistant({ id: "b", isSidechain: false })]);
    expect(a!.sidechain).toBe(true);
    expect(b!.sidechain).toBeUndefined();
  });

  it("afterToolResult follows the last user line: tool_result yes, prompt no", () => {
    const [a, b, c] = turns([
      user([{ type: "tool_result", tool_use_id: "t1", content: "ok" }]),
      assistant({ id: "a" }),
      user("next prompt"),
      assistant({ id: "b" }),
      user([{ type: "text", text: "x" }, { type: "tool_result", tool_use_id: "t2", content: "ok" }]),
      assistant({ id: "c" }),
    ]);
    expect(a!.afterToolResult).toBe(true);
    expect(b!.afterToolResult).toBeUndefined();
    expect(c!.afterToolResult).toBe(true);
  });

  it("cacheSplitLogged: set when usage logs the nested 5m / 1h split; 5m = cache write - 1h", () => {
    const [split, flat] = turns([
      assistant({
        id: "a",
        usage: { input_tokens: 3, output_tokens: 10, cache_creation_input_tokens: 900, cache_creation: { ephemeral_5m_input_tokens: 600, ephemeral_1h_input_tokens: 300 } },
      }),
      assistant({ id: "b", usage: { input_tokens: 3, output_tokens: 10, cache_creation_input_tokens: 900 } }),
    ]);
    expect(split!.cacheSplitLogged).toBe(true);
    expect(split!.cacheCreationTokens - split!.cacheCreation1hTokens).toBe(600);
    expect(flat!.cacheSplitLogged).toBeUndefined();
  });

  it("one request logged on several lines keeps the first line's tags and one turn", () => {
    const t = turns([
      user([{ type: "tool_result", tool_use_id: "t1", content: "ok" }]),
      assistant({ id: "a", version: "2.1.90", entrypoint: "cli" }),
      assistant({ id: "a", version: "2.1.90", entrypoint: "cli", usage: { input_tokens: 3, output_tokens: 50 } }),
    ]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ version: "2.1.90", entrypoint: "cli", afterToolResult: true, outputTokens: 50 });
  });
});
