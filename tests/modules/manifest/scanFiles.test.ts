import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../../src/lib/fs.js";
import {
  classifyLanguage,
  scanFiles,
} from "../../../src/modules/manifest/scanFiles.js";

describe("classifyLanguage", () => {
  it.each([
    ["ts", "typescript"],
    ["tsx", "typescript"],
    ["js", "javascript"],
    ["mjs", "javascript"],
    ["py", "python"],
    ["go", "go"],
    ["rs", "other"],
    ["", "other"],
  ])("classifies %s as %s", (ext, lang) => {
    expect(classifyLanguage(ext)).toBe(lang);
  });
});

describe("scanFiles", () => {
  it("skips hard-skip directories", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/p/src/a.ts", "a");
    fs.writeFile("/p/node_modules/lodash/index.js", "x");
    fs.writeFile("/p/.git/HEAD", "ref");
    fs.writeFile("/p/dist/bundle.js", "x");
    fs.mkdir("/p");
    const out = await scanFiles(fs, "/p");
    expect(out.map((f) => f.path).sort()).toEqual(["src/a.ts"]);
  });

  it("returns POSIX-style paths and language tags", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/p/src/x.ts", "x");
    fs.writeFile("/p/src/y.py", "y");
    fs.writeFile("/p/README.md", "z");
    fs.mkdir("/p");
    const out = await scanFiles(fs, "/p");
    const ts = out.find((f) => f.path === "src/x.ts");
    expect(ts?.language).toBe("typescript");
    const py = out.find((f) => f.path === "src/y.py");
    expect(py?.language).toBe("python");
    const md = out.find((f) => f.path === "README.md");
    expect(md?.language).toBe("other");
  });

  it("output is deterministically sorted", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/p/b.ts", "b");
    fs.writeFile("/p/a.ts", "a");
    fs.writeFile("/p/c.ts", "c");
    fs.mkdir("/p");
    const out = await scanFiles(fs, "/p");
    expect(out.map((f) => f.path)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });
});
