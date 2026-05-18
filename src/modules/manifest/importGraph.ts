/**
 * importGraph — build a deterministic import graph from parsed files.
 *
 * For each file, we surface the 3-5 most "important" intra-project imports.
 * Importance heuristic: in-degree in the project (files that many others
 * import are more important to mention).
 *
 * Pure module.
 */
import type { ImportGraph, ParsedFile } from "./types.js";

const MAX_IMPORTS_PER_FILE = 5;

export function buildImportGraph(
  parsed: ReadonlyArray<ParsedFile>,
): ImportGraph {
  // 1. Compute in-degree across all imports (intra-project resolution).
  const inDegree = new Map<string, number>();
  for (const f of parsed) {
    for (const imp of f.imports) {
      inDegree.set(imp, (inDegree.get(imp) ?? 0) + 1);
    }
  }

  // 2. For each file, sort its imports by in-degree DESC, then alphabetically.
  const edges = new Map<string, ReadonlyArray<string>>();
  const sortedFiles = [...parsed].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of sortedFiles) {
    if (f.imports.length === 0) continue;
    const ranked = [...f.imports]
      .map((imp) => ({ imp, deg: inDegree.get(imp) ?? 0 }))
      .sort((a, b) => {
        if (b.deg !== a.deg) return b.deg - a.deg;
        return a.imp.localeCompare(b.imp);
      })
      .slice(0, MAX_IMPORTS_PER_FILE)
      .map((x) => x.imp);
    edges.set(f.path, ranked);
  }

  return { edges };
}
