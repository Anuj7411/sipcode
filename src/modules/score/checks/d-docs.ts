/**
 * Category D — documentation density (20 pts).
 *
 * Can an agent learn purpose without reading every file?
 */
import { registerCheck } from "../registry.js";
import { checkId } from "../types.js";
import type { CodebaseSnapshot } from "../types.js";

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

registerCheck({
  id: checkId("SC030"),
  category: "D",
  label: "README exists at repo root (>200 chars)",
  maxPoints: 5,
  run: (snap) => {
    if (snap.readme && snap.readme.trim().length > 200) return { passed: true };
    if (snap.readme) {
      return {
        passed: false,
        details: `README is only ${snap.readme.trim().length} chars — needs >200`,
      };
    }
    return { passed: false, details: "no README at repo root" };
  },
});

registerCheck({
  id: checkId("SC031"),
  category: "D",
  label: "README has a Quick start / Usage / Getting started section",
  maxPoints: 4,
  run: (snap) => {
    if (!snap.readme) return { passed: false, details: "no README to inspect" };
    if (/^#{1,6}\s*(quick\s*start|usage|getting\s*started|install(ation)?)\b/im.test(snap.readme)) {
      return { passed: true };
    }
    return {
      passed: false,
      details: "README is missing a Quick start / Usage / Getting started section",
    };
  },
});

registerCheck({
  id: checkId("SC032"),
  category: "D",
  label: "source files declare purpose via top-of-file comments",
  maxPoints: 4,
  run: (snap) => {
    let total = 0;
    let missing = 0;
    const missingPaths: string[] = [];
    for (const [p, comment] of snap.firstLineComment.entries()) {
      // Only count files we actually classify as source.
      const ext = (p.split(".").pop() ?? "").toLowerCase();
      if (!SOURCE_EXTS.has(ext)) continue;
      total++;
      if (!comment) {
        missing++;
        missingPaths.push(p);
      }
    }
    if (total === 0) return { passed: true };
    // Pass if >= 60% of source files have a top comment.
    const ratio = (total - missing) / total;
    if (ratio >= 0.6) return { passed: true };
    return {
      passed: false,
      details: `${missing}/${total} source files have no top-of-file comment (${(ratio * 100).toFixed(0)}% commented; need 60%+)`,
    };
  },
});

registerCheck({
  id: checkId("SC033"),
  category: "D",
  label: "public API surface has docstrings / JSDoc",
  maxPoints: 4,
  run: (snap) => {
    // Heuristic: look at index files + files in publicly-exported dirs.
    // For each public file, the first-line comment requirement is stricter:
    // it must look like a JSDoc /** or python triple-quoted docstring.
    const candidates = pickPublicSurfaceFiles(snap);
    if (candidates.length === 0) return { passed: true };
    const bad: string[] = [];
    for (const p of candidates) {
      const c = snap.firstLineComment.get(p);
      if (!c) {
        bad.push(p);
        continue;
      }
      if (c.startsWith("/**") || c.startsWith('"""') || c.startsWith("'''")) {
        continue;
      }
      bad.push(p);
    }
    if (bad.length === 0) return { passed: true };
    return {
      passed: false,
      details: `public exports missing JSDoc/docstrings: ${bad.slice(0, 3).join(", ")}`,
    };
  },
});

registerCheck({
  id: checkId("SC034"),
  category: "D",
  label: "architecture docs exist (ARCHITECTURE.md or docs/)",
  maxPoints: 3,
  run: (snap) => {
    if (snap.hasFile("ARCHITECTURE.md")) return { passed: true };
    if (snap.hasFile("docs/ARCHITECTURE.md")) return { passed: true };
    // Any markdown in a docs/ dir counts.
    for (const f of snap.scanned) {
      if (f.path.startsWith("docs/") && f.ext === "md") return { passed: true };
    }
    return {
      passed: false,
      details: "no ARCHITECTURE.md and no docs/ directory with markdown",
    };
  },
});

function pickPublicSurfaceFiles(snap: CodebaseSnapshot): string[] {
  const out: string[] = [];
  for (const f of snap.scanned) {
    if (!SOURCE_EXTS.has(f.ext)) continue;
    const base = (f.path.split("/").pop() ?? "").toLowerCase();
    if (base === "index.ts" || base === "index.js" || base === "index.tsx" || base === "index.jsx") {
      out.push(f.path);
      continue;
    }
    if (base === "cli.ts" || base === "cli.js") out.push(f.path);
    if (base === "__init__.py" && f.path.split("/").length <= 3) out.push(f.path);
    if (base === "main.go" || base === "doc.go") out.push(f.path);
  }
  return out;
}
