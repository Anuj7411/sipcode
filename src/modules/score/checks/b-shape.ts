/**
 * Category B — directory shape (20 pts).
 *
 * Can an agent navigate the tree without getting lost? Sane depth, idiomatic
 * source dirs, no monster files, consistent test layout, no dead top-level
 * directories.
 */
import { registerCheck } from "../registry.js";
import { checkId } from "../types.js";
import type { CodebaseSnapshot } from "../types.js";

const DEPTH_CAP = 6;
const FILE_LOC_CAP = 1000;

registerCheck({
  id: checkId("SC010"),
  category: "B",
  label: `max directory depth <= ${DEPTH_CAP} from repo root`,
  maxPoints: 5,
  run: (snap) => {
    let worst = "";
    let worstDepth = 0;
    for (const f of snap.scanned) {
      // depth = number of slashes = # dirs above the file.
      const d = (f.path.match(/\//g) ?? []).length;
      if (d > worstDepth) {
        worstDepth = d;
        worst = f.path;
      }
    }
    if (worstDepth <= DEPTH_CAP) return { passed: true };
    const dir = worst.split("/").slice(0, -1).join("/");
    return {
      passed: false,
      details: `${dir}/ depth = ${worstDepth} (cap is ${DEPTH_CAP})`,
    };
  },
});

const CONVENTIONAL_DIRS = [
  "src",
  "lib",
  "packages",
  "apps",
  "app",
  "pages",
  "cmd",
  "internal",
  "pkg",
  "components",
  "modules",
];

registerCheck({
  id: checkId("SC011"),
  category: "B",
  label: "source directories named conventionally",
  maxPoints: 4,
  run: (snap) => {
    const top = new Set<string>();
    for (const f of snap.scanned) {
      const seg = f.path.split("/")[0];
      if (seg && f.language !== "other") top.add(seg);
    }
    if (top.size === 0) return { passed: true };
    // Pass if at least one top-level source directory is conventional OR if
    // source files live at the root (small projects).
    if (top.has(".") || hasAnyFlat(snap)) return { passed: true };
    for (const dir of CONVENTIONAL_DIRS) {
      if (top.has(dir)) return { passed: true };
    }
    // Pass if framework dictates structure (next, astro, etc).
    if (
      snap.framework.framework === "next-app" ||
      snap.framework.framework === "next-pages" ||
      snap.framework.framework === "astro" ||
      snap.framework.framework === "remix" ||
      snap.framework.framework === "sveltekit"
    ) {
      return { passed: true };
    }
    return {
      passed: false,
      details: `top-level source dirs are ${[...top].sort().join(", ")} — expected one of src/lib/packages/apps`,
    };
  },
});

registerCheck({
  id: checkId("SC012"),
  category: "B",
  label: `no source file over ${FILE_LOC_CAP} LOC`,
  maxPoints: 4,
  run: (snap) => {
    const overs: Array<{ path: string; loc: number }> = [];
    for (const [p, loc] of snap.lineCounts.entries()) {
      if (loc > FILE_LOC_CAP) overs.push({ path: p, loc });
    }
    if (overs.length === 0) return { passed: true };
    overs.sort((a, b) => b.loc - a.loc);
    const top = overs.slice(0, 3).map((o) => `${o.path} (${o.loc} LOC)`).join(", ");
    return {
      passed: false,
      details: `${overs.length} file(s) over ${FILE_LOC_CAP} LOC: ${top}`,
    };
  },
});

registerCheck({
  id: checkId("SC013"),
  category: "B",
  label: "test layout consistent (co-located OR centralized, not both)",
  maxPoints: 3,
  run: (snap) => {
    let colocated = 0;
    let centralized = 0;
    for (const f of snap.scanned) {
      const isTest =
        /\.(test|spec)\.[jt]sx?$/.test(f.path) ||
        /(^|\/)tests?\//.test(f.path) ||
        /(^|\/)__tests__\//.test(f.path) ||
        /_test\.go$/.test(f.path) ||
        /(^|\/)test_[^/]+\.py$/.test(f.path);
      if (!isTest) continue;
      if (/(^|\/)(tests?|__tests__)\//.test(f.path)) centralized++;
      else colocated++;
    }
    const total = colocated + centralized;
    if (total === 0) return { passed: true }; // no tests is a doc issue, not a layout one
    // Pass if one dominates (>= 75%).
    const dominantRatio = Math.max(colocated, centralized) / total;
    if (dominantRatio >= 0.75) return { passed: true };
    return {
      passed: false,
      details: `${colocated} colocated tests vs ${centralized} centralized — pick one layout`,
    };
  },
});

registerCheck({
  id: checkId("SC014"),
  category: "B",
  label: "no dead top-level directories",
  maxPoints: 4,
  run: (snap) => {
    const topCounts = new Map<string, number>();
    for (const f of snap.scanned) {
      const seg = f.path.split("/")[0];
      // Only consider files inside a directory (path contains "/")
      if (!f.path.includes("/") || !seg) continue;
      topCounts.set(seg, (topCounts.get(seg) ?? 0) + 1);
    }
    const dead: string[] = [];
    for (const [dir, count] of topCounts.entries()) {
      if (count <= 1 && !isExpectedSingleton(dir)) dead.push(dir);
    }
    if (dead.length === 0) return { passed: true };
    return {
      passed: false,
      details: `top-level dir(s) with <=1 file confuse navigation: ${dead.sort().join(", ")}`,
    };
  },
});

function hasAnyFlat(snap: CodebaseSnapshot): boolean {
  for (const f of snap.scanned) {
    if (!f.path.includes("/") && f.language !== "other") return true;
  }
  return false;
}

function isExpectedSingleton(dir: string): boolean {
  // Dirs that legitimately hold one file or are config-only.
  return new Set([
    "public",
    "static",
    "assets",
    "docs",
    "scripts",
    "bin",
    "config",
    ".github",
    ".vscode",
    ".husky",
    ".changeset",
  ]).has(dir);
}
