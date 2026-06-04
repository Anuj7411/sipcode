/**
 * Regression guard — no fabricated PostToolUse output-replacement field.
 *
 * The original Phase A plan was built against a fabricated
 * `replace_tool_response` field that does NOT exist in Claude Code's hook
 * contract. plan-eng-review caught it before any code was written, and the
 * architecture was corrected to PreToolUse + `updatedInput`.
 *
 * This guard fails the build if anyone reintroduces the fabricated field
 * anywhere in the proxy module, locking in the corrected architecture.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PROXY_DIR = join(__dirname, "..", "..", "src", "modules", "proxy");

const FORBIDDEN_STRINGS = [
  "replace_tool_response",
  "replaceToolResponse",
  "tool_response",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile() && full.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("proxy: no fabricated PostToolUse output-replacement field", () => {
  it("the proxy module never references a tool-response replacement field", () => {
    const violations: string[] = [];
    for (const file of walk(PROXY_DIR)) {
      const src = readFileSync(file, "utf-8");
      for (const bad of FORBIDDEN_STRINGS) {
        if (src.includes(bad)) {
          const rel = file.replace(/\\/g, "/").split("/proxy/")[1];
          violations.push(`  proxy/${rel}: contains "${bad}"`);
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Fabricated PostToolUse field reintroduced. Claude Code has no such field — ` +
          `use PreToolUse + updatedInput only:\n${violations.join("\n")}`,
      );
    }
    expect(violations).toHaveLength(0);
  });
});
