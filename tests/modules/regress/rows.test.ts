import { describe, expect, it } from "vitest";
import { codexAgent } from "../../../src/modules/agents/codex/adapter.js";
import type { SessionMeta } from "../../../src/modules/agents/shared.js";
import { parseTranscript } from "../../../src/modules/transcript/parse.js";
import { claudeRows, codexRequests, isAutomated } from "../../../src/modules/regress/rows.js";
import { claudeSessionText, codexRolloutText, healthy } from "../../integration/regress-fixtures.js";

const meta = (sessionId: string, extra: Partial<SessionMeta> = {}): SessionMeta => ({
  sessionId,
  filePath: `/x/${sessionId}.jsonl`,
  projectHash: "p",
  mtimeMs: 0,
  size: 0,
  ...extra,
});

function parsed(text: string) {
  const r = parseTranscript(text);
  if (!r.ok) throw new Error("parse");
  return r.value;
}

describe("claudeRows", () => {
  it("one row per request with the regress fields; 5m write = write - 1h", () => {
    const text = claudeSessionText("abcdef12-0000", "2.1.100", "claude-opus-4-6", healthy(3, { ttl: "5m" }), { entrypoint: "cli" });
    const rows = claudeRows({ meta: meta("abcdef12-0000"), parsed: parsed(text) });
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual({
      session: "abcdef12",
      version: "2.1.100",
      model: "claude-opus-4-6",
      entry: "cli",
      side: false,
      ts: Date.parse("2026-03-01T09:02:00.000Z"),
      inp: 3,
      cr: 40_000,
      cw: 3_000,
      c5: 3_000,
      c1: 0,
      out: 400,
      ctx: 43_003,
      afterTool: true,
    });
  });

  it("skips requests without a version, without usage, and <synthetic> ones", () => {
    const text = [
      JSON.stringify({ type: "assistant", timestamp: "2026-03-01T09:00:00Z", requestId: "r1", message: { id: "m1", model: "claude-opus-4-8", usage: { input_tokens: 1 } } }),
      JSON.stringify({ type: "assistant", version: "2.1.1", timestamp: "2026-03-01T09:01:00Z", requestId: "r2", message: { id: "m2", model: "claude-opus-4-8" } }),
      JSON.stringify({ type: "assistant", version: "2.1.1", timestamp: "2026-03-01T09:02:00Z", requestId: "r3", message: { id: "m3", model: "<synthetic>", usage: { input_tokens: 0 } } }),
      JSON.stringify({ type: "assistant", version: "2.1.1", timestamp: "2026-03-01T09:03:00Z", requestId: "r4", message: { id: "m4", model: "claude-opus-4-8", usage: { input_tokens: 5 } } }),
    ].join("\n");
    const rows = claudeRows({ meta: meta("s"), parsed: parsed(text) });
    expect(rows.map((r) => r.inp)).toEqual([5]);
  });

  it("isAutomated: sidechain and sdk-* entrypoints", () => {
    const side = claudeRows({ meta: meta("s"), parsed: parsed(claudeSessionText("s", "2.1.1", "m", healthy(1), { side: true })) });
    const sdk = claudeRows({ meta: meta("s"), parsed: parsed(claudeSessionText("s", "2.1.1", "m", healthy(1), { entrypoint: "sdk-py" })) });
    const cli = claudeRows({ meta: meta("s"), parsed: parsed(claudeSessionText("s", "2.1.1", "m", healthy(1), { entrypoint: "cli" })) });
    expect([isAutomated(side[0]!), isAutomated(sdk[0]!), isAutomated(cli[0]!)]).toEqual([true, true, false]);
  });

  it("rows come back in time order", () => {
    const text = claudeSessionText("s", "2.1.1", "m", [{ gap: 5, cr: 1 }, { gap: -3, cr: 2 }]);
    expect(claudeRows({ meta: meta("s"), parsed: parsed(text) }).map((r) => r.cr)).toEqual([2, 1]);
  });
});

describe("codexRequests", () => {
  it("tags each request with the file's Codex version and its uncached + output tokens", () => {
    const p = codexAgent.parseTranscript(codexRolloutText("cx1", "0.142.0-alpha.3", 0, 2, { turns: 2 }));
    if (!p.ok) throw new Error("parse");
    const reqs = codexRequests({ meta: meta("cx1", { cliVersion: "0.142.0-alpha.3", cwd: "/home/u/proj" }), parsed: p.value });
    expect(reqs).toHaveLength(2);
    expect(reqs[0]).toMatchObject({ sessionId: "cx1", version: "0.142.0", model: "gpt-5.5", tokens: 125_000, work: 20_000, cwd: "/home/u/proj" });
  });

  it("an unknown version is '?'", () => {
    const p = codexAgent.parseTranscript(codexRolloutText("cx2", "0.1.0", 0, 2, { turns: 1 }));
    if (!p.ok) throw new Error("parse");
    expect(codexRequests({ meta: meta("cx2"), parsed: p.value })[0]!.version).toBe("?");
  });
});
