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

// Issue #22: a Python virtual environment's Lib/ and include/ were scanned.
describe("scanFiles skips Python environments (issue #22)", () => {
  it("skips a venv nested under any name, by its pyvenv.cfg", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/p/app/main.py", "print(1)");
    fs.writeFile("/p/myenv/pyvenv.cfg", "home = /usr/bin");
    fs.writeFile("/p/myenv/Lib/site-packages/requests/__init__.py", "x");
    fs.writeFile("/p/myenv/include/python3.12/Python.h", "x");
    const paths = (await scanFiles(fs, "/p")).map((f) => f.path);
    expect(paths).toEqual(["app/main.py"]);
  });

  it("skips only the venv folders when the project root is itself a venv", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/p/pyvenv.cfg", "home = C:\Python312");
    fs.writeFile("/p/Lib/site-packages/flask/app.py", "x");
    fs.writeFile("/p/include/site/python3.12/greenlet.h", "x");
    fs.writeFile("/p/Scripts/activate.bat", "x");
    fs.writeFile("/p/app.py", "print(1)");
    fs.writeFile("/p/src/models.py", "x");
    const paths = (await scanFiles(fs, "/p")).map((f) => f.path);
    expect(paths).toEqual(["app.py", "pyvenv.cfg", "src/models.py"]);
  });

  it("skips a conda environment by its conda-meta folder", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/p/src/a.py", "x");
    fs.writeFile("/p/envs/dev/conda-meta/history", "x");
    fs.writeFile("/p/envs/dev/lib/python3.12/os.py", "x");
    const paths = (await scanFiles(fs, "/p")).map((f) => f.path);
    expect(paths).toEqual(["src/a.py"]);
  });
});
