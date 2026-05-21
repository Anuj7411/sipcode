/**
 * Regression guard — MCP server top-level safety nets.
 *
 * The Sipcode MCP server runs as a long-lived stdio child of Claude
 * Desktop. A single uncaught error or missing signal handler surfaces
 * to the user as the dreaded "MCP sipcode: Server disconnected" toast.
 * This was the failure shape behind the v1.1.3–v1.1.5 bug streak.
 *
 * This guard asserts that src/mcp/server.ts STILL has the four
 * process-level safety nets. If anyone refactors them out, CI fails
 * before publish.
 *
 * (We assert by source-scan, not by execution, to keep the test fast
 *  and deterministic — actually triggering uncaughtException in a
 *  subprocess is flaky on Windows.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVER_SRC = join(__dirname, "..", "..", "src", "mcp", "server.ts");

describe("MCP server has top-level safety nets [v1.1.x bug regression guards]", () => {
  const src = readFileSync(SERVER_SRC, "utf-8");

  it("handles uncaughtException at the process level", () => {
    expect(src).toMatch(/process\.on\(\s*["']uncaughtException["']/);
  });

  it("handles unhandledRejection at the process level", () => {
    expect(src).toMatch(/process\.on\(\s*["']unhandledRejection["']/);
  });

  it("handles SIGINT / SIGTERM for graceful shutdown", () => {
    expect(src).toMatch(/SIGINT/);
    expect(src).toMatch(/SIGTERM/);
  });

  it("handles stdin 'end' (parent disconnected the pipe)", () => {
    expect(src).toMatch(/process\.stdin\.on\(\s*["']end["']/);
  });

  it("logs ONLY to stderr (stdout is the MCP JSON-RPC channel)", () => {
    // Catch any accidental console.log/process.stdout.write outside
    // the JSON-RPC plumbing. Allow comments mentioning stdout.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    expect(stripped).not.toMatch(/console\.log\(/);
    expect(stripped).not.toMatch(/process\.stdout\.write\(/);
  });
});
