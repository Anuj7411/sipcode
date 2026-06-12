import { describe, it, expect } from "vitest";
import {
  estimateProxyOverToolCalls,
  renderVsRtkTable,
} from "../../../src/modules/proxy/vsRtk.js";

describe("estimateProxyOverToolCalls", () => {
  it("counts rewrites and sums heuristic saved tokens", () => {
    const est = estimateProxyOverToolCalls([
      { name: "Bash", input: { command: "git status" } }, // git-status rewrite
      { name: "Bash", input: { command: "echo hi" } }, // no match
      { name: "Grep", input: { pattern: "foo" } }, // native-grep rewrite (2000) + flips anyGrepSeen
      { name: "Read", input: { file_path: "/a.ts" } }, // AST credit post-grep (3000)
      { name: "WebFetch", input: { url: "x" } }, // unknown tool
    ]);
    expect(est.toolCalls).toBe(5);
    expect(est.rewrites).toBe(3); // git + grep + AST
    expect(est.estSavedTokens).toBeGreaterThanOrEqual(2800);
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

  it("credits B3 AST trim: first Read of a .ts file after a Grep counts +3000", () => {
    const est = estimateProxyOverToolCalls([
      { name: "Grep", input: { pattern: "authCheck" } }, // grep first (2000) + makes anyGrepSeen
      { name: "Read", input: { file_path: "/proj/auth.ts" } }, // first read post-grep → +3000
    ]);
    // 2000 (native-grep) + 3000 (AST trim) = 5000, 2 rewrites.
    expect(est.rewrites).toBe(2);
    expect(est.estSavedTokens).toBe(5000);
  });

  it("does NOT credit AST trim when there was no prior Grep", () => {
    const est = estimateProxyOverToolCalls([
      { name: "Read", input: { file_path: "/proj/auth.ts" } },
    ]);
    expect(est.rewrites).toBe(0);
    expect(est.estSavedTokens).toBe(0);
  });

  it("does NOT credit AST trim on non-eligible file types (.md, .json)", () => {
    const est = estimateProxyOverToolCalls([
      { name: "Grep", input: { pattern: "x" } },
      { name: "Read", input: { file_path: "/proj/notes.md" } },
      { name: "Read", input: { file_path: "/proj/config.json" } },
    ]);
    // Only the Grep rewrite (2000), no AST credit on .md or .json.
    expect(est.rewrites).toBe(1);
    expect(est.estSavedTokens).toBe(2000);
  });

  it("does NOT double-count B3 AST + B5 dedup on re-read", () => {
    const est = estimateProxyOverToolCalls([
      { name: "Grep", input: { pattern: "x" } }, // 2000
      { name: "Read", input: { file_path: "/proj/a.ts" } }, // first read → AST +3000
      { name: "Read", input: { file_path: "/proj/a.ts" } }, // re-read → DEDUP +2000 (not AST)
    ]);
    // 2000 (grep) + 3000 (AST first read) + 2000 (dedup re-read) = 7000, 3 rewrites
    expect(est.rewrites).toBe(3);
    expect(est.estSavedTokens).toBe(7000);
  });

  it("counts AST trim for Python (.py) and JSX files too", () => {
    const est = estimateProxyOverToolCalls([
      { name: "Grep", input: { pattern: "x" } },
      { name: "Read", input: { file_path: "/proj/handler.py" } },
      { name: "Read", input: { file_path: "/proj/App.tsx" } },
    ]);
    // 2000 (grep) + 3000 (.py) + 3000 (.tsx) = 8000
    expect(est.estSavedTokens).toBe(8000);
  });

  it("AST credit is gated on Bash grep too (rg, ag, plain grep)", () => {
    const est = estimateProxyOverToolCalls([
      { name: "Bash", input: { command: "rg --files-with-matches userId src/" } },
      { name: "Read", input: { file_path: "/proj/user.ts" } },
    ]);
    // The Bash rg call may or may not match a registry rewriter (depends on
    // grep coverage). Either way, anyGrepSeen flips → AST credit fires for
    // the Read. We assert the AST hit minimum and at least one rewrite.
    expect(est.rewrites).toBeGreaterThanOrEqual(1);
    expect(est.estSavedTokens).toBeGreaterThanOrEqual(3000);
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
