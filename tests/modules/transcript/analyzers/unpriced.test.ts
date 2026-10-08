import { describe, expect, it } from "vitest";
import { parseCodexRollout } from "../../../../src/modules/agents/codex/parse.js";
import {
  analyzeTokens,
  analyzeUnpriced,
  addUnpriced,
  NO_UNPRICED,
} from "../../../../src/modules/transcript/analyzers/tokens.js";
import { loadPricingForDate } from "../../../../src/lib/pricing/load.js";
import { MESSAGES } from "../../../../src/lib/messages.js";

const pricing = loadPricingForDate(new Date("2026-10-08"));

const line = (o: unknown) => JSON.stringify(o);
function turn(turnId: string, model: string, responseId: string, input: number, output: number): string[] {
  return [
    line({ timestamp: "2026-10-01T10:00:01Z", type: "turn_context", payload: { turn_id: turnId, model } }),
    line({
      timestamp: "2026-10-01T10:00:05Z",
      type: "token_usage_record",
      payload: {
        turn_id: turnId,
        response_id: responseId,
        usage: { input_tokens: input, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output },
      },
    }),
  ];
}

function session() {
  const content = [
    line({ timestamp: "2026-10-01T10:00:00Z", type: "session_meta", payload: { id: "cx1", session_id: "cx1", cwd: "/p" } }),
    ...turn("u1", "gpt-6.1-sol", "r1", 1000, 100),
    ...turn("u2", "codex-auto-review", "r2", 20_000, 503),
    ...turn("u3", "codex-auto-review", "r3", 160_000, 0),
  ].join("\n");
  const r = parseCodexRollout(content);
  if (!r.ok) throw new Error("parse failed");
  return r.value;
}

describe("analyzeUnpriced", () => {
  it("counts tokens and requests on models with no price row", () => {
    const u = analyzeUnpriced(session(), pricing);
    expect(u).toEqual({ tokens: 180_503, requests: 2, models: ["codex-auto-review"] });
  });

  it("the cost total leaves unpriced tokens out (no guessing)", () => {
    const s = session();
    const t = analyzeTokens(s, pricing);
    const sol = (1000 * 2 + 100 * 10) / 1_000_000;
    expect(t.estCostUSD).toBeCloseTo(sol, 10);
  });

  it("is empty when every model has a price", () => {
    const s = session();
    const priced = { ...s, assistantTurns: s.assistantTurns.filter((t) => t.model === "gpt-6.1-sol") };
    expect(analyzeUnpriced(priced, pricing)).toEqual(NO_UNPRICED);
  });

  it("adds across sessions, keeping model ids unique and sorted", () => {
    const a = { tokens: 10, requests: 1, models: ["z-model"] };
    const b = { tokens: 5, requests: 2, models: ["a-model", "z-model"] };
    expect(addUnpriced(a, b)).toEqual({ tokens: 15, requests: 3, models: ["a-model", "z-model"] });
  });

  it("renders the one-line note under a cost", () => {
    expect(MESSAGES.unpricedTokens({ tokens: 180_503, requests: 9, models: ["codex-auto-review"] })).toBe(
      "180,503 tokens on models without a known price (codex-auto-review): not included in the cost above.",
    );
  });
});
