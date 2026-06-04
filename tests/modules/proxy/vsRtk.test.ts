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
      { name: "Read", input: { file_path: "/a.ts" } }, // rewrite (3000)
      { name: "WebFetch", input: { url: "x" } }, // unknown tool
    ]);
    expect(est.toolCalls).toBe(4);
    expect(est.rewrites).toBe(2);
    expect(est.estSavedTokens).toBe(3800);
  });

  it("ignores non-object inputs safely", () => {
    const est = estimateProxyOverToolCalls([
      { name: "Bash", input: null },
      { name: "Bash", input: "not an object" },
    ]);
    expect(est.rewrites).toBe(0);
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
