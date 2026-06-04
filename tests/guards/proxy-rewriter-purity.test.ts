/**
 * Regression guard — proxy rewriter purity.
 *
 * Rewriters are pure functions `(toolInput) → RewriterResult`. They must never
 * touch the filesystem, network, or spawn processes — that purity is a
 * brand-pillar contract (Sipcode never exfiltrates) and is what lets us inline
 * / import them into the hook with confidence. All I/O lives in the hook script
 * (`proxyHookScript.ts`), the install command, and the stats store.
 *
 * This guard scans every file under `src/modules/proxy/rewriters/` and fails if
 * any of them import a Node I/O module.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REWRITERS_DIR = join(
  __dirname,
  "..",
  "..",
  "src",
  "modules",
  "proxy",
  "rewriters",
);

const FORBIDDEN_MODULES = [
  "node:fs",
  "node:fs/promises",
  "node:http",
  "node:https",
  "node:net",
  "node:dns",
  "node:tls",
  "node:child_process",
];

function listFiles(dir: string): string[] {
  return readdirSync(dir)
    .map((e) => join(dir, e))
    .filter((p) => statSync(p).isFile() && p.endsWith(".ts"));
}

describe("proxy rewriter purity", () => {
  it("scans more than one rewriter file", () => {
    expect(listFiles(REWRITERS_DIR).length).toBeGreaterThan(1);
  });

  it("no rewriter imports an I/O module", () => {
    const violations: string[] = [];
    for (const file of listFiles(REWRITERS_DIR)) {
      const src = readFileSync(file, "utf-8");
      for (const mod of FORBIDDEN_MODULES) {
        // Match an actual import/require of the module, not prose mentions.
        const re = new RegExp(
          `(from\\s+|require\\()\\s*["']${mod.replace("/", "\\/")}["']`,
        );
        if (re.test(src)) {
          const rel = file.replace(/\\/g, "/").split("/rewriters/")[1];
          violations.push(`  rewriters/${rel}: imports ${mod}`);
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Proxy rewriter purity violated — rewriters must be pure:\n${violations.join("\n")}`,
      );
    }
  });
});
