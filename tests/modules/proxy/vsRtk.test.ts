import { describe, it, expect } from "vitest";
import {
  estimateProxyOverToolCalls,
  renderVsRtkTable,
} from "../../../src/modules/proxy/vsRtk.js";

describe("estimateProxyOverToolCalls", () => {
  it("counts rewrites and sums heuristic saved tokens", () => {
    const est = estimateProxyOverToolCalls([
      { name: "Bash", input: { command: "git status" } }, // rewrite (800)
      { name: "Bash", input: { command: "echo hi" } }, // no match
      { name: "Grep", input: { pattern: "foo" } }, // rewrite (2000)
      { name: "Read", input: { file_path: "/a.ts" } }, // no rewrite (capped by platform)
      { name: "WebFetch", input: { url: "x" } }, // unknown tool
    ]);
    expect(est.toolCalls).toBe(5);
    expect(est.rewrites).toBe(2);
    expect(est.estSavedTokens).toBe(2800);
  });

  it("ignores non-object inputs safely", () => {
    const est = estimateProxyOverToolCalls([
      { name: "Bash", input: null },
      { name: "Bash", input: "not an object" },
    ]);
    expect(est.rewrites).toBe(0);
  });

  it("credits B5 dedup: each Read of a file already seen in the same transcript counts +2000", () => {
    const est = estimateProxyOverToolCalls([
      { name: "Read", input: { file_path: "/a.ts" } }, // first read, no credit
      { name: "Read", input: { file_path: "/b.ts" } }, // first read, no credit
      { name: "Read", input: { file_path: "/a.ts" } }, // re-read → +2000
      { name: "Read", input: { file_path: "/a.ts" } }, // re-read again → +2000
    ]);
    expect(est.rewrites).toBe(2);
    expect(est.estSavedTokens).toBe(4000);
  });

  it("combines registry rewrites and B5 dedup credit in one walk", () => {
    const est = estimateProxyOverToolCalls([
      { name: "Read", input: { file_path: "/a.ts" } }, // first read
      { name: "Bash", input: { command: "git status" } }, // git-status rewrite
      { name: "Read", input: { file_path: "/a.ts" } }, // re-read → +2000
    ]);
    expect(est.rewrites).toBe(2);
    // sum is one registry rewrite + one dedup
    expect(est.estSavedTokens).toBeGreaterThanOrEqual(2000);
  });

  it("skips dedup credit when Read input has no file_path", () => {
    const est = estimateProxyOverToolCalls([
      { name: "Read", input: {} },
      { name: "Read", input: {} },
    ]);
    expect(est.rewrites).toBe(0);
    expect(est.estSavedTokens).toBe(0);
  });

  it("renders a table with totals and a heuristic disclaimer", () => {
    const table = renderVsRtkTable([
      {
        taskId: "BT001",
        title: "refactor auth",
        estimate: { toolCalls: 5, rewrites: 3, estSavedTokens: 4200 },
      },
    ]);
    expect(table).toContain("BT001");
    expect(table).toContain("TOTAL");
    expect(table).toContain("4,200");
    expect(table).toContain("Heuristic");
  });
});
