import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryFs, RealFileSystem, type FileSystem } from "../../src/lib/fs.js";

// "é" is 2 bytes and "€" is 3 bytes in UTF-8: "aé€b" = 1 + 2 + 3 + 1 = 7 bytes.
const MIXED = "aé€b";

function readHeadCases(name: string, make: (content: string) => Promise<{ fs: FileSystem; p: string; done: () => void }>) {
  describe(`${name}.readHead`, () => {
    it("returns at most maxBytes, dropping a trailing partial multi-byte character", async () => {
      const { fs, p, done } = await make(MIXED);
      try {
        expect(await fs.readHead(p, 1)).toBe("a");
        expect(await fs.readHead(p, 2)).toBe("a"); // half of "é"
        expect(await fs.readHead(p, 3)).toBe("aé");
        expect(await fs.readHead(p, 4)).toBe("aé"); // 1/3 of "€"
        expect(await fs.readHead(p, 5)).toBe("aé"); // 2/3 of "€"
        expect(await fs.readHead(p, 6)).toBe("aé€");
        expect(await fs.readHead(p, 100)).toBe(MIXED);
      } finally {
        done();
      }
    });

    it("rejects for a missing file", async () => {
      const { fs, p, done } = await make("x");
      try {
        await expect(fs.readHead(p + ".missing", 10)).rejects.toBeTruthy();
      } finally {
        done();
      }
    });
  });
}

readHeadCases("InMemoryFs", async (content) => {
  const fs = new InMemoryFs();
  fs.writeFile("/f.txt", content);
  return { fs, p: "/f.txt", done: () => {} };
});

readHeadCases("RealFileSystem", async (content) => {
  const dir = mkdtempSync(path.join(tmpdir(), "sipcode-readhead-"));
  const p = path.join(dir, "f.txt");
  writeFileSync(p, content, "utf-8");
  return { fs: new RealFileSystem(), p, done: () => rmSync(dir, { recursive: true, force: true }) };
});

describe("InMemoryFs", () => {
  it("write/read roundtrip", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/a/b/c.txt", "hello", 1000);
    expect(await fs.exists("/a/b/c.txt")).toBe(true);
    expect(await fs.readFile("/a/b/c.txt")).toBe("hello");
  });

  it("ENOENT for missing files", async () => {
    const fs = new InMemoryFs();
    await expect(fs.readFile("/missing")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("readDir lists direct children only", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/root/a.txt", "a");
    fs.writeFile("/root/sub/b.txt", "b");
    const entries = await fs.readDir("/root");
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["a.txt", "sub"]);
    const sub = entries.find((e) => e.name === "sub");
    expect(sub?.isDirectory).toBe(true);
  });

  it("stat reports mtime + size", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/x", "abc", 42);
    const s = await fs.stat("/x");
    expect(s.size).toBe(3);
    expect(s.mtimeMs).toBe(42);
  });
});
