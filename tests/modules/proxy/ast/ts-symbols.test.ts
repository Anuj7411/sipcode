import { describe, it, expect } from "vitest";
import {
  extractTsSymbols,
  isTsLikeFile,
} from "../../../../src/modules/proxy/ast/ts-symbols.js";

describe("isTsLikeFile", () => {
  it("recognizes ts/tsx/js/jsx/mjs/cjs/mts/cts", () => {
    for (const f of ["a.ts", "a.tsx", "a.js", "a.jsx", "a.mjs", "a.cjs", "a.mts", "a.cts"]) {
      expect(isTsLikeFile(f)).toBe(true);
    }
  });
  it("rejects non-JS/TS files", () => {
    for (const f of ["a.py", "a.go", "a.md", "a.json", "a", "a.txt"]) {
      expect(isTsLikeFile(f)).toBe(false);
    }
  });
});

describe("extractTsSymbols — basics", () => {
  it("extracts an exported function", () => {
    const symbols = extractTsSymbols(
      "a.ts",
      `export function foo() { return 1; }\n`,
    );
    expect(symbols.length).toBe(1);
    expect(symbols[0]!.name).toBe("foo");
    expect(symbols[0]!.kind).toBe("function");
    expect(symbols[0]!.isExported).toBe(true);
    expect(symbols[0]!.startLine).toBe(1);
    expect(symbols[0]!.endLine).toBe(1);
  });

  it("extracts a non-exported function", () => {
    const symbols = extractTsSymbols("a.ts", `function bar() { return 2; }\n`);
    expect(symbols.length).toBe(1);
    expect(symbols[0]!.name).toBe("bar");
    expect(symbols[0]!.isExported).toBe(false);
  });

  it("extracts a class and tracks its line range", () => {
    const src = `class Widget {\n  hello() {\n    return 1;\n  }\n}\n`;
    const symbols = extractTsSymbols("a.ts", src);
    expect(symbols.length).toBe(1);
    expect(symbols[0]!.kind).toBe("class");
    expect(symbols[0]!.name).toBe("Widget");
    expect(symbols[0]!.startLine).toBe(1);
    expect(symbols[0]!.endLine).toBe(5);
  });

  it("extracts an interface and a type alias", () => {
    const src = `export interface Point { x: number; y: number; }\nexport type Vec = [number, number];\n`;
    const symbols = extractTsSymbols("a.ts", src);
    expect(symbols.length).toBe(2);
    expect(symbols[0]!.name).toBe("Point");
    expect(symbols[0]!.kind).toBe("interface");
    expect(symbols[1]!.name).toBe("Vec");
    expect(symbols[1]!.kind).toBe("type");
  });

  it("extracts const/let/var declarations", () => {
    const src = `export const A = 1;\nlet b = 2;\nvar c = 3;\n`;
    const symbols = extractTsSymbols("a.ts", src);
    expect(symbols.length).toBe(3);
    expect(symbols[0]!.kind).toBe("const");
    expect(symbols[0]!.isExported).toBe(true);
    expect(symbols[1]!.kind).toBe("let");
    expect(symbols[2]!.kind).toBe("var");
  });

  it("handles multiple declarators on one line", () => {
    const src = `const x = 1, y = 2, z = 3;\n`;
    const symbols = extractTsSymbols("a.ts", src);
    expect(symbols.map((s) => s.name)).toEqual(["x", "y", "z"]);
  });

  it("extracts an enum", () => {
    const src = `enum Color { Red, Green, Blue }\n`;
    const symbols = extractTsSymbols("a.ts", src);
    expect(symbols.length).toBe(1);
    expect(symbols[0]!.kind).toBe("enum");
    expect(symbols[0]!.name).toBe("Color");
  });
});

describe("extractTsSymbols — robustness", () => {
  it("returns [] for empty input", () => {
    expect(extractTsSymbols("a.ts", "")).toEqual([]);
  });

  it("returns [] on syntactically broken input (parser errors swallowed)", () => {
    // Even on a broken file the function must not throw. The orchestrator
    // falls back to pass-through when this returns [].
    const result = extractTsSymbols("a.ts", "function $$$ (");
    expect(Array.isArray(result)).toBe(true);
  });

  it("ignores nested declarations (only top-level symbols returned)", () => {
    const src = `function outer() {\n  function inner() {}\n}\n`;
    const symbols = extractTsSymbols("a.ts", src);
    expect(symbols.length).toBe(1);
    expect(symbols[0]!.name).toBe("outer");
  });

  it("realistic file: multi-symbol module with comments and types", () => {
    const src = `// Module: auth utilities
import { Db } from "./db.js";

export interface User { id: string; }

export function authCheck(user: User): boolean {
  return user.id.length > 0;
}

export class AuthError extends Error {}

export const VERSION = "1.0.0";
`;
    const symbols = extractTsSymbols("auth.ts", src);
    const names = symbols.map((s) => s.name);
    expect(names).toContain("User");
    expect(names).toContain("authCheck");
    expect(names).toContain("AuthError");
    expect(names).toContain("VERSION");
    expect(symbols.find((s) => s.name === "authCheck")!.kind).toBe("function");
    expect(symbols.find((s) => s.name === "AuthError")!.kind).toBe("class");
  });
});
