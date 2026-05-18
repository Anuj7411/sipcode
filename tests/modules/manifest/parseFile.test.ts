import { describe, expect, it } from "vitest";
import { extractImports, parseFile } from "../../../src/modules/manifest/parseFile.js";

describe("extractImports — TS/JS", () => {
  it("handles named, default, star, and dynamic imports", () => {
    const src = `
      import foo from "./a";
      import { b, c } from "./b";
      import * as ns from "./c";
      import "./side-effect";
      const x = await import("./dyn");
    `;
    const imports = extractImports(src, "typescript");
    const specs = imports.map((i) => i.specifier).sort();
    expect(specs).toEqual([
      "./a",
      "./b",
      "./c",
      "./dyn",
      "./side-effect",
    ]);
    const styles = imports.reduce<Record<string, number>>((acc, i) => {
      acc[i.style] = (acc[i.style] ?? 0) + 1;
      return acc;
    }, {});
    expect(styles["named"]).toBe(1);
    expect(styles["star"]).toBe(1);
    expect(styles["default"]).toBeGreaterThanOrEqual(2);
    expect(styles["side-effect"]).toBe(1);
  });

  it("ignores imports inside comments", () => {
    const src = `
      // import "./fake-line";
      /* import "./fake-block"; */
      import x from "./real";
    `;
    const imports = extractImports(src, "typescript");
    expect(imports.map((i) => i.specifier)).toEqual(["./real"]);
  });
});

describe("extractImports — Python", () => {
  it("captures from-imports and bare imports", () => {
    const src = `
      from .relative import a, b
      from os import path
      import json
      import sys as s
    `;
    const imports = extractImports(src, "python");
    const specs = imports.map((i) => i.specifier);
    expect(specs).toContain(".relative");
    expect(specs).toContain("os");
    expect(specs).toContain("json");
    expect(specs).toContain("sys");
  });
});

describe("extractImports — Go", () => {
  it("captures single and block imports", () => {
    const src = `
      package main
      import "fmt"
      import (
        "os"
        f "io/fs"
      )
    `;
    const imports = extractImports(src, "go");
    const specs = imports.map((i) => i.specifier).sort();
    expect(specs).toEqual(["fmt", "io/fs", "os"]);
  });
});

describe("parseFile — purpose extraction", () => {
  it("uses JSDoc summary first line", async () => {
    const r = await parseFile({
      relPath: "src/foo.ts",
      content: "/**\n * Does the thing well.\n * @returns nothing\n */\nexport function foo() {}",
      language: "typescript",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.purpose).toBe("Does the thing well.");
  });

  it("uses leading line comment when no JSDoc", async () => {
    const r = await parseFile({
      relPath: "src/bar.ts",
      content: "// quick utility for bar parsing\nexport const bar = 1;",
      language: "typescript",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.purpose).toBe("quick utility for bar parsing");
  });

  it("falls back to filename heuristic", async () => {
    const r = await parseFile({
      relPath: "src/cool-thing.ts",
      content: "export const x = 1;",
      language: "typescript",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.purpose).toContain("cool thing");
  });

  it("returns E007 for 'other' language", async () => {
    const r = await parseFile({
      relPath: "x.rs",
      content: "",
      language: "other",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]?.code).toBe("E007");
  });

  it("resolves TS relative imports to POSIX paths", async () => {
    const r = await parseFile({
      relPath: "src/a/b.ts",
      content: 'import { x } from "../c/d";',
      language: "typescript",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.imports).toEqual(["src/c/d"]);
  });

  it("drops external/stdlib imports from intra-project graph", async () => {
    const r = await parseFile({
      relPath: "src/x.py",
      content: 'import os\nfrom .local import thing',
      language: "python",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.imports.length).toBe(1);
      expect(r.value.imports[0]).toContain("local");
    }
  });
});
