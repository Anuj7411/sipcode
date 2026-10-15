import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  InMemoryFs,
  isCompressedLog,
  readCompressedLogFirstLine,
  readLogText,
  RealFileSystem,
  type FileSystem,
} from "../../src/lib/fs.js";
import { CorruptZstdError, setZstdCodecForTests, ZstdUnavailableError } from "../../src/lib/zstd.js";

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

describe("RealFileSystem.readFile", () => {
  it("decodes UTF-8 exactly as readFile(p, 'utf-8') does (multi-byte, BOM, invalid bytes)", async () => {
    const { readFileSync } = await import("node:fs");
    const dir = mkdtempSync(path.join(tmpdir(), "sipcode-fs-"));
    try {
      const p = path.join(dir, "t.jsonl");
      const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${MIXED}\n{"x":"\u{1F600}"}\n`, "utf8"), Buffer.from([0xff, 0xfe, 0x41])]);
      writeFileSync(p, bytes);
      expect(await new RealFileSystem().readFile(p)).toBe(readFileSync(p, "utf-8"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
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

describe("compressed session logs (readLogText)", () => {
  const zstdCompress = (s: string): Buffer =>
    (zlib as unknown as { zstdCompressSync: (b: Buffer) => Buffer }).zstdCompressSync(Buffer.from(s, "utf8"));
  const TEXT = `{"type":"session_meta","payload":{"id":"a"}}\n{"n":"${MIXED}"}\n`;

  afterEach(() => setZstdCodecForTests(undefined));

  it("InMemoryFs stores raw bytes: readBytes returns them, stat counts them", async () => {
    const fs = new InMemoryFs();
    const bytes = zstdCompress(TEXT);
    fs.writeBytes("/c/rollout-a.jsonl.zst", bytes, 7);
    expect((await fs.readBytes("/c/rollout-a.jsonl.zst")).equals(bytes)).toBe(true);
    expect(await fs.stat("/c/rollout-a.jsonl.zst")).toEqual({ mtimeMs: 7, size: bytes.length });
    expect((await fs.readDir("/c")).map((e) => e.name)).toEqual(["rollout-a.jsonl.zst"]);
    fs.writeFile("/c/plain.jsonl", TEXT);
    expect((await fs.readBytes("/c/plain.jsonl")).toString("utf8")).toBe(TEXT);
  });

  it("reads a plain log as text and a .zst log decompressed, on both file systems", async () => {
    const mem = new InMemoryFs();
    mem.writeFile("/c/a.jsonl", TEXT);
    mem.writeBytes("/c/a.jsonl.zst", zstdCompress(TEXT));
    expect(isCompressedLog("/c/a.jsonl")).toBe(false);
    expect(isCompressedLog("/c/a.jsonl.zst")).toBe(true);
    expect(await readLogText(mem, "/c/a.jsonl")).toBe(TEXT);
    expect(await readLogText(mem, "/c/a.jsonl.zst")).toBe(TEXT);
    expect(await readCompressedLogFirstLine(mem, "/c/a.jsonl.zst")).toBe(TEXT.split("\n")[0]);

    const dir = mkdtempSync(path.join(tmpdir(), "sipcode-zst-"));
    try {
      const p = path.join(dir, "rollout-a.jsonl.zst");
      writeFileSync(p, zstdCompress(TEXT));
      const real = new RealFileSystem();
      expect(await readLogText(real, p)).toBe(TEXT);
      expect(await readCompressedLogFirstLine(real, p)).toBe(TEXT.split("\n")[0]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a damaged .zst log throws (callers count it as unreadable)", async () => {
    const mem = new InMemoryFs();
    const full = zstdCompress(TEXT.repeat(50));
    mem.writeBytes("/c/cut.jsonl.zst", full.subarray(0, full.length - 3));
    mem.writeBytes("/c/junk.jsonl.zst", Buffer.from("not zstd"));
    await expect(readLogText(mem, "/c/cut.jsonl.zst")).rejects.toThrow(CorruptZstdError);
    await expect(readLogText(mem, "/c/junk.jsonl.zst")).rejects.toThrow(CorruptZstdError);
  });

  it("on a Node.js without zstd, a .zst log throws ZstdUnavailableError naming the version needed", async () => {
    setZstdCodecForTests(null);
    const mem = new InMemoryFs();
    mem.writeBytes("/c/a.jsonl.zst", zstdCompress(TEXT));
    mem.writeFile("/c/b.jsonl", TEXT);
    await expect(readLogText(mem, "/c/a.jsonl.zst")).rejects.toThrow(ZstdUnavailableError);
    await expect(readLogText(mem, "/c/a.jsonl.zst")).rejects.toThrow(/Node\.js 22\.15 or newer/);
    expect(await readLogText(mem, "/c/b.jsonl")).toBe(TEXT);
  });
});
