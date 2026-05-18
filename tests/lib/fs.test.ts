import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../src/lib/fs.js";

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
