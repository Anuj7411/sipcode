/**
 * Category C — naming clarity (20 pts).
 *
 * Descriptive, consistent filenames; no god-modules named utils.ts.
 */
import { registerCheck } from "../registry.js";
import { checkId } from "../types.js";

const SOURCE_EXTS = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "py",
  "go",
]);

const GENERIC_NAMES = new Set([
  "utils",
  "util",
  "helpers",
  "helper",
  "common",
  "misc",
  "stuff",
  "shared",
]);

const GENERIC_FILE_LOC_CAP = 200;

registerCheck({
  id: checkId("SC020"),
  category: "C",
  label: "filenames are descriptive",
  maxPoints: 5,
  run: (snap) => {
    const bad: string[] = [];
    for (const f of snap.scanned) {
      if (!SOURCE_EXTS.has(f.ext)) continue;
      const base = (f.path.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
      if (isBadName(base)) bad.push(f.path);
    }
    if (bad.length === 0) return { passed: true };
    return {
      passed: false,
      details: `${bad.length} undescriptive filename(s): ${bad.slice(0, 3).join(", ")}`,
    };
  },
});

registerCheck({
  id: checkId("SC021"),
  category: "C",
  label: "consistent naming convention within directories",
  maxPoints: 5,
  run: (snap) => {
    // Group source files by their immediate parent directory.
    const byDir = new Map<string, string[]>();
    for (const f of snap.scanned) {
      if (!SOURCE_EXTS.has(f.ext)) continue;
      const segs = f.path.split("/");
      const dir = segs.slice(0, -1).join("/") || ".";
      const base = (segs.pop() ?? "").replace(/\.[^.]+$/, "");
      const list = byDir.get(dir) ?? [];
      list.push(base);
      byDir.set(dir, list);
    }
    const mixed: string[] = [];
    for (const [dir, names] of byDir.entries()) {
      if (names.length < 3) continue;
      const counts = { kebab: 0, snake: 0, camel: 0, pascal: 0, other: 0 };
      for (const n of names) {
        const k = classify(n);
        counts[k]++;
      }
      const total = counts.kebab + counts.snake + counts.camel + counts.pascal;
      if (total < 3) continue;
      const top = Math.max(counts.kebab, counts.snake, counts.camel, counts.pascal);
      if (top / total < 0.6) mixed.push(dir);
    }
    if (mixed.length === 0) return { passed: true };
    return {
      passed: false,
      details: `${mixed.length} dir(s) mix naming conventions: ${mixed.slice(0, 3).join(", ")}`,
    };
  },
});

registerCheck({
  id: checkId("SC022"),
  category: "C",
  label: `no generic utils/helpers/common file over ${GENERIC_FILE_LOC_CAP} LOC`,
  maxPoints: 5,
  run: (snap) => {
    const overs: string[] = [];
    for (const [p, loc] of snap.lineCounts.entries()) {
      const base = (p.split("/").pop() ?? "").replace(/\.[^.]+$/, "").toLowerCase();
      if (!GENERIC_NAMES.has(base)) continue;
      if (loc > GENERIC_FILE_LOC_CAP) overs.push(`${p} (${loc} LOC)`);
    }
    if (overs.length === 0) return { passed: true };
    return {
      passed: false,
      details: `god-module(s): ${overs.slice(0, 3).join(", ")} — split by domain`,
    };
  },
});

registerCheck({
  id: checkId("SC023"),
  category: "C",
  label: "no test files outside test dirs lacking '.test' / '_test' suffix",
  maxPoints: 5,
  run: (snap) => {
    // Heuristic: if files in test directories don't follow a test naming
    // pattern, agents looking for tests will miss them.
    const offenders: string[] = [];
    for (const f of snap.scanned) {
      if (!SOURCE_EXTS.has(f.ext)) continue;
      const inTestDir = /(^|\/)(tests?|__tests__)\//.test(f.path);
      if (!inTestDir) continue;
      // Skip anything under a fixtures/ or fixture/ directory — by definition
      // not a test file.
      if (/(^|\/)(fixtures?)\//.test(f.path)) continue;
      const base = f.path.split("/").pop() ?? "";
      if (/\.(test|spec)\.[jt]sx?$/.test(base)) continue;
      if (/_test\.go$/.test(base)) continue;
      if (/^test_/.test(base) || /_test\.py$/.test(base)) continue;
      if (base === "conftest.py") continue;
      if (base.startsWith("setup") || base.startsWith("fixture") || base.startsWith("helpers")) continue;
      // Anything else in a test dir without a test suffix is sus.
      offenders.push(f.path);
    }
    if (offenders.length === 0) return { passed: true };
    return {
      passed: false,
      details: `${offenders.length} file(s) in test dir without test suffix: ${offenders.slice(0, 3).join(", ")}`,
    };
  },
});

function isBadName(base: string): boolean {
  if (base.length < 2) return true;
  if (/^[a-z]$/.test(base)) return true;
  if (/^(temp|tmp|untitled|new|copy|asdf|foo|bar|baz)(\d+|copy)?$/i.test(base)) return true;
  if (/^(file|page|component|module)\d+$/i.test(base)) return true;
  if (/^[a-z]+\d+$/.test(base) && base.length <= 6) return true;
  return false;
}

function classify(name: string): "kebab" | "snake" | "camel" | "pascal" | "other" {
  if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(name)) return "kebab";
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(name)) return "snake";
  if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) return "pascal";
  if (/^[a-z][a-zA-Z0-9]*$/.test(name)) return "camel";
  return "other";
}
