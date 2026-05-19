import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../../src/lib/fs.js";
import { FakeProcessEnv } from "../../../src/lib/process.js";
import {
  loadAnchors,
  median,
  confidenceFor,
  tierMatchesShape,
  _internal,
} from "../../../src/modules/estimate/anchors.js";

/** Build a synthetic transcript whose shape we control. */
function makeTranscript(opts: {
  toolCalls: number;
  distinctReads: number;
  /** Tokens-per-turn (will be split across input/output/cache). */
  perTurnInput: number;
  perTurnOutput: number;
  perTurnCacheRead: number;
}): string {
  const lines: string[] = [];
  let uuid = 1;
  const session = "sess-anchor";
  // We collapse one tool_use per assistant turn; if distinctReads < toolCalls
  // we pad with Bash calls (which don't count as reads).
  for (let i = 0; i < opts.toolCalls; i++) {
    const useRead = i < opts.distinctReads;
    const tool = useRead
      ? {
          type: "tool_use",
          id: `t${uuid}`,
          name: "Read",
          input: { file_path: `/p/file${i}.ts` },
        }
      : {
          type: "tool_use",
          id: `t${uuid}`,
          name: "Bash",
          input: { command: "ls" },
        };
    const ts = `2026-05-01T10:${String(i % 60).padStart(2, "0")}:00.000Z`;
    lines.push(
      JSON.stringify({
        type: "user",
        uuid: `u${uuid++}`,
        sessionId: session,
        timestamp: ts,
        cwd: "/p",
        message: { role: "user", content: "next" },
      }),
    );
    lines.push(
      JSON.stringify({
        type: "assistant",
        uuid: `a${uuid++}`,
        sessionId: session,
        timestamp: ts,
        cwd: "/p",
        message: {
          model: "claude-opus-4",
          role: "assistant",
          content: [tool],
          usage: {
            input_tokens: opts.perTurnInput,
            output_tokens: opts.perTurnOutput,
            cache_read_input_tokens: opts.perTurnCacheRead,
            cache_creation_input_tokens: 0,
          },
        },
      }),
    );
  }
  return lines.join("\n");
}

describe("median", () => {
  it("returns 0 for empty array", () => {
    expect(median([])).toBe(0);
  });
  it("returns the single value", () => {
    expect(median([42])).toBe(42);
  });
  it("returns the middle for odd-length sorted", () => {
    expect(median([1, 2, 3])).toBe(2);
  });
  it("averages the two middle values for even-length", () => {
    expect(median([1, 2, 3, 4])).toBe(3);
  });
  it("sorts before picking", () => {
    expect(median([10, 1, 5])).toBe(5);
  });
});

describe("confidenceFor", () => {
  it("returns high for ≥3", () => {
    expect(confidenceFor(3)).toBe("high");
    expect(confidenceFor(10)).toBe("high");
  });
  it("returns medium for 1-2", () => {
    expect(confidenceFor(1)).toBe("medium");
    expect(confidenceFor(2)).toBe("medium");
  });
  it("returns low for 0", () => {
    expect(confidenceFor(0)).toBe("low");
  });
});

describe("tierMatchesShape", () => {
  it("matches high tier: ≥30 tool calls AND ≥20 reads", () => {
    expect(
      tierMatchesShape("high", {
        toolCalls: 35,
        distinctReads: 25,
        totalTokens: 1000,
      }),
    ).toBe(true);
    expect(
      tierMatchesShape("high", {
        toolCalls: 50,
        distinctReads: 10,
        totalTokens: 1000,
      }),
    ).toBe(false);
  });

  it("matches medium tier window", () => {
    expect(
      tierMatchesShape("medium", {
        toolCalls: 15,
        distinctReads: 10,
        totalTokens: 1000,
      }),
    ).toBe(true);
    expect(
      tierMatchesShape("medium", {
        toolCalls: 5,
        distinctReads: 10,
        totalTokens: 1000,
      }),
    ).toBe(false);
    expect(
      tierMatchesShape("medium", {
        toolCalls: 40,
        distinctReads: 10,
        totalTokens: 1000,
      }),
    ).toBe(false);
  });

  it("matches low tier: <10 calls AND <5 reads", () => {
    expect(
      tierMatchesShape("low", {
        toolCalls: 5,
        distinctReads: 2,
        totalTokens: 1000,
      }),
    ).toBe(true);
    expect(
      tierMatchesShape("low", {
        toolCalls: 20,
        distinctReads: 1,
        totalTokens: 1000,
      }),
    ).toBe(false);
  });
});

describe("shapeFor (via _internal)", () => {
  it("applies cache_read weighting (10%) and output weighting (5×)", () => {
    const t = makeTranscript({
      toolCalls: 1,
      distinctReads: 1,
      perTurnInput: 100,
      perTurnOutput: 50,
      perTurnCacheRead: 1000,
    });
    const shape = _internal.shapeFor(t);
    // 100 input + 50*5 output + 1000*0.1 cache = 450
    expect(shape.totalTokens).toBe(450);
    expect(shape.toolCalls).toBe(1);
    expect(shape.distinctReads).toBe(1);
  });

  it("returns zeros for empty content", () => {
    const shape = _internal.shapeFor("");
    expect(shape.toolCalls).toBe(0);
    expect(shape.distinctReads).toBe(0);
    expect(shape.totalTokens).toBe(0);
  });
});

describe("loadAnchors", () => {
  function setup() {
    const fs = new InMemoryFs();
    const env = new FakeProcessEnv({
      vars: { SIPCODE_PROJECTS_DIR: "/p" },
    });
    return { fs, env };
  }

  it("returns skipped when --no-anchors passed", async () => {
    const { fs, env } = setup();
    const result = await loadAnchors(fs, env, "high", { skip: true });
    expect(result.skipped).toBe(true);
    expect(result.matchedCount).toBe(0);
    expect(result.confidence).toBe("low");
  });

  it("returns zero-confidence when projects dir does not exist", async () => {
    const { fs, env } = setup();
    const result = await loadAnchors(fs, env, "high");
    expect(result.matchedCount).toBe(0);
    expect(result.skipped).toBe(false);
  });

  it("matches a high-tier session correctly", async () => {
    const { fs, env } = setup();
    fs.mkdir("/p/proj1");
    const t = makeTranscript({
      toolCalls: 40,
      distinctReads: 30,
      perTurnInput: 1000,
      perTurnOutput: 100,
      perTurnCacheRead: 0,
    });
    fs.writeFile("/p/proj1/s1.jsonl", t, 1000);
    const result = await loadAnchors(fs, env, "high");
    expect(result.matchedCount).toBe(1);
    expect(result.confidence).toBe("medium");
    expect(result.medianHistoricalTokens).toBeGreaterThan(0);
  });

  it("returns 'high' confidence when ≥3 sessions match", async () => {
    const { fs, env } = setup();
    fs.mkdir("/p/proj1");
    for (let i = 0; i < 4; i++) {
      const t = makeTranscript({
        toolCalls: 35 + i,
        distinctReads: 25 + i,
        perTurnInput: 1000,
        perTurnOutput: 100,
        perTurnCacheRead: 0,
      });
      fs.writeFile(`/p/proj1/s${i}.jsonl`, t, 1000 + i);
    }
    const result = await loadAnchors(fs, env, "high");
    expect(result.matchedCount).toBe(4);
    expect(result.confidence).toBe("high");
  });

  it("does not match a low session under high tier", async () => {
    const { fs, env } = setup();
    fs.mkdir("/p/proj1");
    const t = makeTranscript({
      toolCalls: 5,
      distinctReads: 2,
      perTurnInput: 1000,
      perTurnOutput: 100,
      perTurnCacheRead: 0,
    });
    fs.writeFile("/p/proj1/s1.jsonl", t, 1000);
    const result = await loadAnchors(fs, env, "high");
    expect(result.matchedCount).toBe(0);
    expect(result.confidence).toBe("low");
  });

  it("respects maxSessions cap", async () => {
    const { fs, env } = setup();
    fs.mkdir("/p/proj1");
    for (let i = 0; i < 10; i++) {
      const t = makeTranscript({
        toolCalls: 5,
        distinctReads: 2,
        perTurnInput: 1000,
        perTurnOutput: 100,
        perTurnCacheRead: 0,
      });
      fs.writeFile(`/p/proj1/s${i}.jsonl`, t, 1000 + i);
    }
    const result = await loadAnchors(fs, env, "low", { maxSessions: 3 });
    // Only first 3 scanned; all of them match low → matchedCount ≤ 3
    expect(result.matchedCount).toBeLessThanOrEqual(3);
  });
});
