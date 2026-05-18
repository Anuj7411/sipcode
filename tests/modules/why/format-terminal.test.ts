import { describe, expect, it } from "vitest";
import { formatTerminal } from "../../../src/modules/why/format-terminal.js";
import type { RenderedReport } from "../../../src/modules/why/render.js";

function sample(): RenderedReport {
  return {
    schemaVersion: "sipcode-why/1",
    header: {
      sessionIdShort: "abcd1234",
      model: "claude-sonnet-4",
      durationHuman: "2m 14s",
      projectHash: "test-project",
    },
    punchline: {
      totalTokens: 1000,
      outputTokens: 60,
      nonOutputTokens: 940,
      outputRatioPct: 6,
      oneLiner: "you burned 1,000 tokens.",
    },
    estimatedSavings: {
      totalTokens: 200,
      totalUSD: 0.01,
      breakdown: {
        s001_manifest: 100,
        s030_readOnce: 80,
        s021_diffOutput: 20,
      },
    },
    topLeaks: [
      { rank: 1, title: "duplicate file reads", tokens: 80, detail: "1 file" },
    ],
    totals: {
      inputTokens: 100,
      outputTokens: 60,
      cacheReadTokens: 500,
      cacheCreationTokens: 340,
      estCostUSD: 0.0123,
      toolCallCount: 5,
      distinctFilesRead: 3,
    },
    topExpensive: [
      { toolName: "Read", reason: "duplicate-read", tokens: 80, label: "x.ts" },
    ],
    duplicates: [{ filePath: "x.ts", reads: 2, wastedTokens: 80 }],
    idle: [{ filePath: "y.ts", idleTurns: 7, wastedTokens: 50 }],
    warnings: [{ code: "E003", message: "one skipped line" }],
    metaPricing: { asOf: "2026-05-01", ageDays: 14 },
    nextStep: "run `npx sipcode init`",
  };
}

describe("formatTerminal", () => {
  it("renders a string with the lead savings line", () => {
    const out = formatTerminal(sample(), { useColor: false, verbose: false });
    expect(out).toContain("sipcode why");
    expect(out).toContain("if sipcode had been on");
    expect(out).toContain("top leaks");
    expect(out).toContain("duplicate reads");
    expect(out).toContain("idle context");
    expect(out).toContain("most expensive tool calls");
    expect(out).toContain("est. cost");
    expect(out).toContain("run `npx sipcode init`");
  });

  it("verbose=true includes the totals block", () => {
    const out = formatTerminal(sample(), { useColor: false, verbose: true });
    expect(out).toContain("totals:");
    expect(out).toContain("input tokens:");
    expect(out).toContain("output tokens:");
  });

  it("savings lead before totals", () => {
    const out = formatTerminal(sample(), { useColor: false, verbose: true });
    const savingsIdx = out.indexOf("if sipcode had been on");
    const totalsIdx = out.indexOf("totals:");
    expect(savingsIdx).toBeGreaterThan(-1);
    expect(totalsIdx).toBeGreaterThan(-1);
    expect(savingsIdx).toBeLessThan(totalsIdx);
  });

  it("color and plain produce the same content after stripping ANSI", () => {
    const plain = formatTerminal(sample(), {
      useColor: false,
      verbose: false,
    });
    const colored = formatTerminal(sample(), {
      useColor: true,
      verbose: false,
    });
    const ansiRe = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
    expect(colored.replace(ansiRe, "")).toBe(plain);
  });
});
