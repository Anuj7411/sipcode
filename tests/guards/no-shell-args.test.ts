/**
 * Regression guard — DEP0190.
 *
 * Node 22 deprecated `child_process.spawn(cmd, [argsArray], { shell: true })`
 * because args under shell:true are concatenated without escaping —
 * an argv-injection footgun. It will become a hard error in a future Node major.
 *
 * Sipcode hit this in `tests/e2e/release-smoke.test.ts` via the
 * `shell: IS_WINDOWS` pattern (needed because `npm` and the installed bin
 * shims are `.cmd` files on Windows). The fix: resolve the `.cmd`
 * extension explicitly and drop `shell:` entirely.
 *
 * This guard scans the repo (src/ + tests/) and fails if anyone re-adds
 * the deprecated pattern. The published tarball never contains tests/,
 * so production users are unaffected — but CI must stay green on Node 22+,
 * and the security shape of the test gate itself matters.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const SCAN_ROOTS = ["src", "tests"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage"]);
const SKIP_FILES = new Set(["no-shell-args.test.ts"]); // this file itself

// Patterns that MUST NOT appear in any scanned file.
// Each pattern is a regex; matches print the file + matched snippet.
const FORBIDDEN: { name: string; re: RegExp; why: string }[] = [
  {
    name: "shell: true",
    re: /shell\s*:\s*true/,
    why: "DEP0190 — argv injection risk; resolve .cmd explicitly instead",
  },
  {
    name: "shell: IS_WINDOWS",
    re: /shell\s*:\s*IS_WINDOWS/,
    why: "DEP0190 — use NPM_BIN-style explicit .cmd resolution",
  },
  {
    name: "shell: process.platform",
    re: /shell\s*:\s*process\.platform\s*===?\s*['"]win32['"]/,
    why: "DEP0190 — use explicit .cmd resolution",
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (
      st.isFile() &&
      /\.(ts|mts|cts|js|mjs|cjs)$/.test(entry) &&
      !SKIP_FILES.has(entry)
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("DEP0190 — no shell:true with args arrays in spawn callsites", () => {
  it("src/ + tests/ contain zero forbidden shell:true patterns", () => {
    const files: string[] = [];
    for (const root of SCAN_ROOTS) {
      walk(join(REPO_ROOT, root), files);
    }
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      // Strip line comments + block comments before matching — the guard
      // itself documents the forbidden patterns in prose.
      const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      for (const { name, re, why } of FORBIDDEN) {
        if (re.test(stripped)) {
          const rel = file.replace(REPO_ROOT, "").replace(/\\/g, "/");
          violations.push(`  ${rel}: matches \`${name}\` — ${why}`);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `DEP0190 regression guard tripped — Node 22+ will emit a deprecation warning, future majors will hard-error. Fix or whitelist:\n${violations.join("\n")}`,
      );
    }
  });
});
