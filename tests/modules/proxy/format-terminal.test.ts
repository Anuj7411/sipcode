import { describe, it, expect } from "vitest";
import { renderProxyReport } from "../../../src/modules/proxy/format-terminal.js";
import type { ProxyReport } from "../../../src/modules/proxy/types.js";

const baseReport: ProxyReport = {
  schemaVersion: "sipcode-proxy/2",
  totalInvocations: 0,
  estimatedSavedTokens: 0,
  perRewriter: {},
  note: "test note",
};

describe("renderProxyReport — B4 integrity rendering", () => {
  it("shows the weighted signal-kept line when score is present", () => {
    const report: ProxyReport = {
      ...baseReport,
      totalInvocations: 4,
      estimatedSavedTokens: 11000,
      perRewriter: {
        "git-log": {
          invocations: 3,
          estimatedSavedTokens: 9000,
          avgIntegrityScore: 0.3,
        },
        "dedup-read": {
          invocations: 1,
          estimatedSavedTokens: 2000,
          avgIntegrityScore: 0.95,
        },
      },
      weightedAvgIntegrityScore: 0.4625,
    };
    const out = renderProxyReport(report);
    expect(out).toContain("signal kept:");
    expect(out).toContain("46%"); // 0.4625 → 46% rounded
    expect(out).toContain("med"); // band label
  });

  it("shows per-rewriter '%% kept' next to each row", () => {
    const report: ProxyReport = {
      ...baseReport,
      totalInvocations: 1,
      estimatedSavedTokens: 2000,
      perRewriter: {
        "dedup-read": {
          invocations: 1,
          estimatedSavedTokens: 2000,
          avgIntegrityScore: 0.95,
        },
      },
      weightedAvgIntegrityScore: 0.95,
    };
    const out = renderProxyReport(report);
    expect(out).toContain("95%");
    expect(out).toContain("kept");
  });

  it("uses 'high' band when score >= 0.7", () => {
    const out = renderProxyReport({
      ...baseReport,
      totalInvocations: 1,
      estimatedSavedTokens: 2000,
      perRewriter: {
        "dedup-read": {
          invocations: 1,
          estimatedSavedTokens: 2000,
          avgIntegrityScore: 0.95,
        },
      },
      weightedAvgIntegrityScore: 0.85,
    });
    expect(out).toContain("high");
  });

  it("uses 'low' band when score < 0.4", () => {
    const out = renderProxyReport({
      ...baseReport,
      totalInvocations: 1,
      estimatedSavedTokens: 3000,
      perRewriter: {
        "git-log": {
          invocations: 1,
          estimatedSavedTokens: 3000,
          avgIntegrityScore: 0.3,
        },
      },
      weightedAvgIntegrityScore: 0.3,
    });
    expect(out).toContain("low");
  });

  it("omits the integrity line entirely when no scores are present (v1.6.7 reports)", () => {
    const out = renderProxyReport({
      ...baseReport,
      totalInvocations: 1,
      estimatedSavedTokens: 100,
      perRewriter: {
        ls: { invocations: 1, estimatedSavedTokens: 100 },
      },
    });
    expect(out).not.toContain("signal kept");
    expect(out).not.toContain("kept");
  });

  it("renders the empty-report state without the integrity line", () => {
    const out = renderProxyReport(baseReport);
    expect(out).toContain("No rewrites recorded yet");
    expect(out).not.toContain("signal kept");
  });
});
