import { describe, expect, it } from "vitest";
import { buildImportGraph } from "../../../src/modules/manifest/importGraph.js";
import type { ParsedFile } from "../../../src/modules/manifest/types.js";

const file = (path: string, imports: string[]): ParsedFile => ({
  path,
  language: "typescript",
  purpose: path,
  imports,
  importStyles: imports.map(() => "named"),
});

describe("buildImportGraph", () => {
  it("ranks imports by in-degree, then alphabetically", () => {
    const parsed = [
      file("src/a.ts", ["src/popular.ts", "src/rare.ts"]),
      file("src/b.ts", ["src/popular.ts"]),
      file("src/c.ts", ["src/popular.ts"]),
    ];
    const g = buildImportGraph(parsed);
    expect(g.edges.get("src/a.ts")).toEqual(["src/popular.ts", "src/rare.ts"]);
  });

  it("caps at 5 imports per file", () => {
    const imports = Array.from({ length: 10 }, (_, i) => `src/i${i}.ts`);
    const g = buildImportGraph([file("src/big.ts", imports)]);
    expect(g.edges.get("src/big.ts")?.length).toBe(5);
  });

  it("skips files with no imports", () => {
    const g = buildImportGraph([file("src/empty.ts", [])]);
    expect(g.edges.has("src/empty.ts")).toBe(false);
  });

  it("is deterministic across runs", () => {
    const parsed = [
      file("src/z.ts", ["src/x.ts", "src/y.ts"]),
      file("src/y.ts", ["src/x.ts"]),
    ];
    const g1 = buildImportGraph(parsed);
    const g2 = buildImportGraph(parsed);
    expect([...g1.edges.entries()]).toEqual([...g2.edges.entries()]);
  });
});
