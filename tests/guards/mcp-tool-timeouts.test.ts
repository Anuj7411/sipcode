/**
 * Static guard: every MCP tool case in the dispatch switch MUST be
 * wrapped in `withTimeout`. This guard test reads the source of
 * src/mcp/server.ts and verifies every `case "..."` branch goes
 * through `withTimeout(...)`.
 *
 * Why this matters: when an MCP tool handler hangs, Claude Desktop's
 * client gives up after 4 minutes and shows the user a generic
 * "MCP sipcode: Server disconnected" message. That looks like the
 * server crashed when really one tool was just slow. By forcing
 * every tool through a timeout, we guarantee a structured diagnostic
 * is returned to Claude before the client gives up — and the user
 * sees what to actually fix.
 *
 * If a future PR adds a new MCP tool and forgets to wrap it, this
 * test fails before the PR can merge.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("guard — every MCP tool handler is wrapped in withTimeout", () => {
  const serverSource = readFileSync(
    path.resolve(__dirname, "../../src/mcp/server.ts"),
    "utf-8",
  );

  // Find every `case "name":` boundary, then slice the body up to the
  // NEXT case boundary (or `default:`). This handles cases whose
  // bodies contain inner `{ ... }` blocks (type annotations,
  // sub-object literals) correctly.
  const caseStartRe = /case "([a-z_]+)":/g;
  const matches: Array<{ toolName: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = caseStartRe.exec(serverSource)) !== null) {
    matches.push({ toolName: m[1] ?? "", start: m.index });
  }
  const defaultIdx = serverSource.indexOf("default:");
  const cases = matches.map((cur, i) => {
    const nextStart = matches[i + 1]?.start ?? defaultIdx ?? serverSource.length;
    return {
      toolName: cur.toolName,
      body: serverSource.slice(cur.start, nextStart),
    };
  });

  it("there is at least one tool case to check (the dispatch wasn't deleted)", () => {
    expect(cases.length).toBeGreaterThanOrEqual(6);
  });

  for (const c of cases) {
    it(`tool '${c.toolName}' goes through withTimeout`, () => {
      expect(c.body).toMatch(/withTimeout\(/);
    });
  }

  it("the dispatch imports withTimeout from the canonical location", () => {
    expect(serverSource).toMatch(
      /import\s+\{[^}]*withTimeout[^}]*\}\s+from\s+"\.\.\/lib\/timeout\.js"/,
    );
  });
});
