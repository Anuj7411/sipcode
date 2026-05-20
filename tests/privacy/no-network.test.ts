/**
 * Privacy guard test (S090).
 *
 * Sipcode's README, PRIVACY.md, and the `ASSERT_NO_NETWORK` marker all
 * promise that no v1.0 core path makes network calls. This test is the
 * assertion behind that promise: it statically scans every TypeScript
 * source file under `src/` and fails the build if any runtime-imports a
 * forbidden network module.
 *
 * Why a static scan instead of a runtime sandbox:
 *   - the goal is to make "no network" a *property* of the codebase, not
 *     a property of a single execution. snapshotting outbound sockets at
 *     test time would only catch the paths the test happens to walk.
 *   - the scan is deterministic, fast, and easy for a future contributor
 *     to read when CI fails on their PR.
 *
 * What this test does NOT cover:
 *   - third-party dependencies (`chalk`, `commander`, `prompts`, etc.).
 *     the privacy guarantee is about sipcode's own code paths. see
 *     PRIVACY.md for the honest framing.
 *   - type-only imports. `import type { Server } from "node:http"` is
 *     erased at compile time and is allowed.
 *
 * If this test fails: do NOT weaken the assertion. either the import is
 * a real privacy violation (fix it) or the rule needs a documented
 * allowlist entry (add to ALLOWLIST below with a comment explaining
 * why).
 */

import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SRC_DIR = path.join(REPO_ROOT, "src");
const HOOK_SCRIPT = path.join(REPO_ROOT, "src", "modules", "hygiene", "hookScript.ts");

/**
 * Files allowed to import network modules. Empty for v1.0 — no core
 * path should reach the network. Add an entry here ONLY with a comment
 * explaining why and a corresponding update to PRIVACY.md.
 */
const ALLOWLIST: ReadonlySet<string> = new Set<string>([
  // (intentionally empty — sipcode v1.0 has no network paths)
]);

const FORBIDDEN_MODULES: readonly string[] = [
  "node:http",
  "node:https",
  "node:net",
  "node:dgram",
  "node:tls",
  "node:dns",
  // legacy bare specifiers
  "http",
  "https",
  "net",
  "dgram",
  "tls",
  "dns",
];

/** Recursively walk a directory and return absolute paths to .ts files. */
async function walkTsFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === "dist") continue;
        await recurse(full);
      } else if (ent.isFile()) {
        if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) {
          out.push(full);
        }
      }
    }
  }
  await recurse(root);
  return out;
}

interface Match {
  file: string;
  line: number;
  text: string;
  pattern: string;
}

/**
 * Strip comments so a comment like
 *   // example: fetch("https://example.com")
 * doesn't trip the regex. Naive but sufficient — we're only suppressing
 * obvious false positives, not parsing TS for real.
 *
 * NB: we deliberately do NOT strip string literals. Real `from "node:fs"`
 * imports embed the module specifier as a string; stripping strings would
 * erase the signal we want to detect. The trade-off is that a docstring
 * mentioning `node:http` will trigger a false positive — handled by the
 * separate `stripStrings` pass used only for the runtime-call regexes
 * (fetch(, new WebSocket(, etc.).
 */
function stripComments(src: string): string {
  // Remove /* ... */ block comments.
  let out = src.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove // line comments — but not protocol-relative `://`.
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1) => p1);
  return out;
}

/**
 * Strip strings AND comments. Used only for matching runtime calls
 * (fetch(, new WebSocket(, new XMLHttpRequest) that should not appear
 * inside a string literal.
 */
function stripStringsAndComments(src: string): string {
  let out = stripComments(src);
  out = out.replace(/`[\s\S]*?`/g, "``");
  out = out.replace(/'(?:\\.|[^'\\])*'/g, "''");
  out = out.replace(/"(?:\\.|[^"\\])*"/g, '""');
  return out;
}

/** True if `line` is a type-only import (erased at compile time). */
function isTypeOnlyImport(line: string): boolean {
  // `import type { X } from "..."` or `import { type X } from "..."` —
  // the first form is always erased. The second form may carry runtime
  // bindings; we treat ONLY the leading `import type` form as type-only.
  return /^\s*import\s+type\b/.test(line);
}

/**
 * Scan a source file for forbidden patterns. Returns one match per
 * offending line. Comments and string literals are stripped before
 * matching, EXCEPT we still inspect the original line for the
 * specifier text in the error message.
 */
function scanSource(file: string, src: string): Match[] {
  const matches: Match[] = [];
  const commentsStripped = stripComments(src).split("\n");
  const fullyStripped = stripStringsAndComments(src).split("\n");
  const origLines = src.split("\n");

  for (let i = 0; i < origLines.length; i++) {
    const noCommentLine = commentsStripped[i] ?? "";
    const noStringLine = fullyStripped[i] ?? "";
    const origLine = origLines[i] ?? "";

    // Skip type-only imports (these get erased; no runtime network).
    if (isTypeOnlyImport(origLine)) continue;

    for (const mod of FORBIDDEN_MODULES) {
      // Match `from "mod"`, `from 'mod'`, `require("mod")`, `import("mod")`.
      // Operate on the comments-stripped line so we ignore commented-out
      // imports but still see the string-literal specifier.
      const escaped = mod.replace(/[/.]/g, "\\$&");
      const re = new RegExp(
        `(?:from\\s+["']${escaped}["']|require\\(\\s*["']${escaped}["']\\s*\\)|import\\(\\s*["']${escaped}["']\\s*\\))`,
      );
      if (re.test(noCommentLine)) {
        matches.push({ file, line: i + 1, text: origLine.trim(), pattern: mod });
      }
    }

    // Other forbidden runtime calls — match against fully-stripped line
    // so neither comments nor docstrings trigger false positives.
    const callPatterns: Array<{ name: string; re: RegExp }> = [
      { name: "fetch(", re: /(^|[^.\w])fetch\s*\(/ },
      { name: "XMLHttpRequest", re: /\bnew\s+XMLHttpRequest\b/ },
      { name: "WebSocket(", re: /\bnew\s+WebSocket\s*\(/ },
    ];
    for (const cp of callPatterns) {
      if (cp.re.test(noStringLine)) {
        matches.push({ file, line: i + 1, text: origLine.trim(), pattern: cp.name });
      }
    }
  }
  return matches;
}

function relFromRepo(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
}

function brandVoiceError(matches: Match[]): string {
  const lines = matches.map((m) => `  · ${relFromRepo(m.file)}:${m.line} — ${m.pattern}\n    ${m.text}`);
  return (
    "sipcode privacy guard tripped — a core path imported a network module.\n" +
    "this breaks the zero-telemetry promise in README.md + PRIVACY.md.\n\n" +
    lines.join("\n") +
    "\n\nfix the import, OR add the file to ALLOWLIST in tests/privacy/no-network.test.ts\n" +
    "AND document the exception in PRIVACY.md. do not weaken the test.\n"
  );
}

describe("S090 — privacy guard: no network calls in core paths", () => {
  it("src/ tree contains zero forbidden network imports", async () => {
    const files = await walkTsFiles(SRC_DIR);
    const allMatches: Match[] = [];
    for (const file of files) {
      const rel = relFromRepo(file);
      if (ALLOWLIST.has(rel)) continue;
      const src = await fs.readFile(file, "utf-8");
      allMatches.push(...scanSource(file, src));
    }
    if (allMatches.length > 0) {
      throw new Error(brandVoiceError(allMatches));
    }
    expect(allMatches).toEqual([]);
  });

  it("hook scripts under src/modules/hygiene/hookScript.ts emit zero network calls", async () => {
    // These scripts run as separate node processes via ~/.claude/hooks/.
    // The privacy guarantee extends to them. We scan the GENERATED source
    // (the string returned by pressureHookScript / breakpointHookScript)
    // by re-reading hookScript.ts itself — the forbidden tokens would
    // appear there verbatim.
    const src = await fs.readFile(HOOK_SCRIPT, "utf-8");
    const matches = scanSource(HOOK_SCRIPT, src);
    if (matches.length > 0) {
      throw new Error(brandVoiceError(matches));
    }
    expect(matches).toEqual([]);
  });

  it("every src/commands/*.ts imports ASSERT_NO_NETWORK (privacy contract marker)", async () => {
    const cmdDir = path.join(SRC_DIR, "commands");
    const entries = await fs.readdir(cmdDir);
    const missing: string[] = [];
    for (const name of entries) {
      if (!name.endsWith(".ts") || name.endsWith(".d.ts")) continue;
      const full = path.join(cmdDir, name);
      const src = await fs.readFile(full, "utf-8");
      if (!/ASSERT_NO_NETWORK/.test(src)) {
        missing.push(relFromRepo(full));
      }
    }
    if (missing.length > 0) {
      throw new Error(
        "sipcode privacy contract — these command files do NOT import ASSERT_NO_NETWORK:\n" +
          missing.map((m) => `  · ${m}`).join("\n") +
          "\n\nadd `import { ASSERT_NO_NETWORK } from \"../lib/privacy.js\";` at the top.\n",
      );
    }
    expect(missing).toEqual([]);
  });

  it("scanSource flags a forbidden runtime import (self-test, positive)", () => {
    const fake = `import { request } from "node:http";\nconst x = 1;\n`;
    const matches = scanSource("/fake/path.ts", fake);
    expect(matches.length).toBe(1);
    expect(matches[0]?.pattern).toBe("node:http");
  });

  it("scanSource ignores a type-only import (self-test, negative)", () => {
    const fake = `import type { Server } from "node:http";\nconst x = 1;\n`;
    const matches = scanSource("/fake/path.ts", fake);
    expect(matches).toEqual([]);
  });

  it("scanSource ignores forbidden tokens inside comments / string literals (self-test, negative)", () => {
    const fake = [
      `// example: const r = await fetch("https://example.com");`,
      `/* import { request } from "node:http"; */`,
      `const docstring = "to talk to node:http you would write fetch(...)";`,
      `const x = 1;`,
    ].join("\n");
    const matches = scanSource("/fake/path.ts", fake);
    expect(matches).toEqual([]);
  });

  it("scanSource flags top-level fetch() call (self-test, positive)", () => {
    const fake = `const r = await fetch("/api");\n`;
    const matches = scanSource("/fake/path.ts", fake);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]?.pattern).toBe("fetch(");
  });
});
