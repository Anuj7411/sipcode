import { describe, it, expect } from "vitest";
import {
  extractPySymbols,
  isPyFile,
} from "../../../../src/modules/proxy/ast/py-symbols.js";

describe("isPyFile", () => {
  it("recognizes .py and .pyi", () => {
    expect(isPyFile("a.py")).toBe(true);
    expect(isPyFile("a.pyi")).toBe(true);
  });
  it("rejects non-Python files", () => {
    for (const f of ["a.ts", "a.js", "a.md", "a", "a.txt"]) {
      expect(isPyFile(f)).toBe(false);
    }
  });
});

describe("extractPySymbols", () => {
  it("extracts a top-level function", () => {
    const s = extractPySymbols("a.py", `def hello():\n    return 1\n`);
    expect(s.length).toBe(1);
    expect(s[0]!.name).toBe("hello");
    expect(s[0]!.kind).toBe("function");
    expect(s[0]!.startLine).toBe(1);
    expect(s[0]!.endLine).toBe(2);
  });

  it("extracts an async function", () => {
    const s = extractPySymbols("a.py", `async def fetch():\n    pass\n`);
    expect(s.length).toBe(1);
    expect(s[0]!.name).toBe("fetch");
    expect(s[0]!.kind).toBe("function");
  });

  it("extracts a class with its line range", () => {
    const src = `class Widget:\n    def __init__(self):\n        self.x = 1\n    def get(self):\n        return self.x\n`;
    const s = extractPySymbols("a.py", src);
    expect(s.length).toBe(1);
    expect(s[0]!.name).toBe("Widget");
    expect(s[0]!.kind).toBe("class");
    expect(s[0]!.endLine).toBe(5);
  });

  it("extracts decorated functions (kind = function, name from inner def)", () => {
    const src = `@cache\ndef compute():\n    return 42\n`;
    const s = extractPySymbols("a.py", src);
    expect(s.length).toBe(1);
    expect(s[0]!.name).toBe("compute");
    expect(s[0]!.kind).toBe("function");
    expect(s[0]!.startLine).toBe(1); // decorator line counted
  });

  it("extracts decorated classes (kind = class)", () => {
    const src = `@dataclass\nclass Point:\n    x: int\n`;
    const s = extractPySymbols("a.py", src);
    expect(s.length).toBe(1);
    expect(s[0]!.name).toBe("Point");
    expect(s[0]!.kind).toBe("class");
  });

  it("extracts module-level constants", () => {
    const src = `VERSION = "1.0.0"\nDEBUG = True\n`;
    const s = extractPySymbols("a.py", src);
    expect(s.map((x) => x.name)).toEqual(["VERSION", "DEBUG"]);
    expect(s[0]!.kind).toBe("const");
  });

  it("marks underscore-prefixed names as non-exported (PEP 8 convention)", () => {
    const src = `def public():\n    pass\n\ndef _private():\n    pass\n`;
    const s = extractPySymbols("a.py", src);
    expect(s.find((x) => x.name === "public")!.isExported).toBe(true);
    expect(s.find((x) => x.name === "_private")!.isExported).toBe(false);
  });

  it("ignores nested functions (only top-level)", () => {
    const src = `def outer():\n    def inner():\n        pass\n    return inner\n`;
    const s = extractPySymbols("a.py", src);
    expect(s.length).toBe(1);
    expect(s[0]!.name).toBe("outer");
  });

  it("returns [] on empty input", () => {
    expect(extractPySymbols("a.py", "")).toEqual([]);
  });

  it("returns [] on broken input without throwing", () => {
    const result = extractPySymbols("a.py", "def $$$:");
    expect(Array.isArray(result)).toBe(true);
  });

  it("realistic module with mixed symbols", () => {
    const src = `# Module: auth utilities
from db import Db

VERSION = "1.0.0"

def auth_check(user_id: str) -> bool:
    return len(user_id) > 0

class AuthError(Exception):
    pass

@cache
def memo_check(user_id: str):
    return auth_check(user_id)
`;
    const s = extractPySymbols("auth.py", src);
    const names = s.map((x) => x.name);
    expect(names).toContain("VERSION");
    expect(names).toContain("auth_check");
    expect(names).toContain("AuthError");
    expect(names).toContain("memo_check");
  });
});
