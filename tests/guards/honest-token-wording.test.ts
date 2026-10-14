/**
 * User-facing copy must not repeat two claims that were false:
 *
 * - "most expensive tool calls": `why` credits each tool call with the tokens of
 *   the whole request that made it (the context sent with it plus its output,
 *   split evenly across calls made in one request), not with the call's own cost.
 *   The list ranks the largest requests and names the tool call each one made.
 * - "the other N were exploration, re-reads, and idle context": most non-output
 *   tokens are the conversation context sent with each request, mostly read
 *   from cache at a fraction of the price.
 *
 * CHANGELOG history and captured sample output under docs/screenshots are left
 * as they were.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function walk(dir: string, exts: readonly string[]): string[] {
  const abs = path.join(root, dir);
  return readdirSync(abs).flatMap((n) => {
    if (n === "node_modules" || n === "dist") return [];
    const p = path.join(abs, n);
    const rel = path.relative(root, p).replace(/\\/g, "/");
    if (statSync(p).isDirectory()) return walk(rel, exts);
    return exts.some((e) => n.endsWith(e)) ? [rel] : [];
  });
}

const FILES = [
  ...walk("src", [".ts"]),
  ...walk("skills", [".md"]),
  ...walk("plugins", [".md", ".json"]),
  ...walk("docs/site/src", [".astro", ".ts", ".md"]),
  "docs/site/public/llms.txt",
  "docs/site/public/llms-full.txt",
  "docs/MCP.md",
  "README.md",
  "PRIVACY.md",
];

const FALSE_CLAIMS: ReadonlyArray<[string, RegExp]> = [
  ["a tool call is credited with its whole request's tokens", /expensive tool calls?|costliest tool calls?/i],
  [
    "non-output tokens are exploration, re-reads and idle context",
    /exploration, re-reads|code vs\.? exploration|were code output|actual code output/i,
  ],
];

describe("honest token wording", () => {
  it("scans the user-facing files", () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  for (const [why, re] of FALSE_CLAIMS) {
    it(`no user-facing text claims it: ${why}`, () => {
      const hits: string[] = [];
      for (const f of FILES) {
        readFileSync(path.join(root, f), "utf-8")
          .split(/\r?\n/)
          .forEach((line, i) => {
            // A prohibition ("never call them exploration, ...") names the claim to forbid it.
            if (re.test(line) && !/\b(never|do not)\b/i.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
          });
      }
      expect(hits).toEqual([]);
    });
  }
});
