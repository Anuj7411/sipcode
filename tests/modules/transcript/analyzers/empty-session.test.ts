import { describe, expect, it } from "vitest";
import {
  isEmptySession,
  type TokenTotals,
} from "../../../../src/modules/transcript/analyzers/tokens.js";

function totals(p: Partial<TokenTotals>): TokenTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    durationSec: 0,
    toolCallCount: 0,
    outputRatio: 0,
    estCostUSD: 0,
    costByModel: [],
    missingAllUsage: false,
    ...p,
  };
}

describe("isEmptySession", () => {
  it("is true when usage data is entirely missing", () => {
    expect(isEmptySession(totals({ missingAllUsage: true }))).toBe(true);
  });

  it("is true when every billable token field is zero", () => {
    expect(isEmptySession(totals({}))).toBe(true);
  });

  it("is false when any billable tokens are present", () => {
    expect(isEmptySession(totals({ inputTokens: 5 }))).toBe(false);
    expect(isEmptySession(totals({ outputTokens: 1 }))).toBe(false);
    expect(isEmptySession(totals({ cacheReadTokens: 10 }))).toBe(false);
    expect(isEmptySession(totals({ cacheCreationTokens: 3 }))).toBe(false);
  });
});
