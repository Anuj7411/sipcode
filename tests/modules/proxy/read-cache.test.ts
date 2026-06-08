import { describe, it, expect } from "vitest";
import {
  loadReadCache,
  appendReadEntry,
  sessionCachePath,
  type ReadEntry,
  type StoreIO,
} from "../../../src/modules/proxy/read-cache.js";

function inMemoryIO(initial: Record<string, string> = {}): StoreIO & {
  files: Map<string, string>;
} {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    async read(p) {
      return files.has(p) ? files.get(p)! : null;
    },
    async append(p, content) {
      files.set(p, (files.get(p) ?? "") + content);
    },
  };
}

const sample = (over: Partial<ReadEntry> = {}): ReadEntry => ({
  filePath: "/tmp/auth.ts",
  sha256: "abc123",
  mtimeMs: 1_000_000,
  sizeBytes: 4_000,
  estimatedTokens: 1_000,
  firstReadAtTurn: 5,
  firstReadAt: "2026-06-09T00:00:00.000Z",
  ...over,
});

describe("loadReadCache", () => {
  it("returns empty map when cache file does not exist", async () => {
    const io = inMemoryIO();
    const result = await loadReadCache("/x/missing.jsonl", io);
    expect(result.size).toBe(0);
  });

  it("parses one JSON-per-line and keys by filePath", async () => {
    const io = inMemoryIO({
      "/c.jsonl":
        JSON.stringify(sample({ filePath: "/a.ts", sha256: "A" })) +
        "\n" +
        JSON.stringify(sample({ filePath: "/b.ts", sha256: "B" })) +
        "\n",
    });
    const map = await loadReadCache("/c.jsonl", io);
    expect(map.size).toBe(2);
    expect(map.get("/a.ts")?.sha256).toBe("A");
    expect(map.get("/b.ts")?.sha256).toBe("B");
  });

  it("last write wins on duplicate filePath", async () => {
    const io = inMemoryIO({
      "/c.jsonl":
        JSON.stringify(sample({ filePath: "/a.ts", sha256: "OLD" })) +
        "\n" +
        JSON.stringify(sample({ filePath: "/a.ts", sha256: "NEW", mtimeMs: 2 })) +
        "\n",
    });
    const map = await loadReadCache("/c.jsonl", io);
    expect(map.get("/a.ts")?.sha256).toBe("NEW");
    expect(map.get("/a.ts")?.mtimeMs).toBe(2);
  });

  it("skips malformed JSON lines without throwing", async () => {
    const io = inMemoryIO({
      "/c.jsonl":
        "{not json}\n" +
        JSON.stringify(sample({ filePath: "/ok.ts" })) +
        "\n" +
        "another bad line\n",
    });
    const map = await loadReadCache("/c.jsonl", io);
    expect(map.size).toBe(1);
    expect(map.has("/ok.ts")).toBe(true);
  });

  it("rejects entries missing required fields", async () => {
    const io = inMemoryIO({
      "/c.jsonl":
        JSON.stringify({ filePath: "/a.ts" }) +
        "\n" +
        JSON.stringify(sample({ filePath: "/good.ts" })) +
        "\n",
    });
    const map = await loadReadCache("/c.jsonl", io);
    expect(map.has("/a.ts")).toBe(false);
    expect(map.has("/good.ts")).toBe(true);
  });

  it("treats empty lines as no-op", async () => {
    const io = inMemoryIO({
      "/c.jsonl":
        "\n" +
        JSON.stringify(sample({ filePath: "/a.ts" })) +
        "\n\n\n",
    });
    const map = await loadReadCache("/c.jsonl", io);
    expect(map.size).toBe(1);
  });
});

describe("appendReadEntry", () => {
  it("writes JSONL terminated by newline", async () => {
    const io = inMemoryIO();
    await appendReadEntry("/c.jsonl", sample({ filePath: "/x.ts" }), io);
    const raw = io.files.get("/c.jsonl")!;
    expect(raw.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(raw.trim());
    expect(parsed.filePath).toBe("/x.ts");
  });

  it("multiple appends produce multi-line JSONL", async () => {
    const io = inMemoryIO();
    await appendReadEntry("/c.jsonl", sample({ filePath: "/a.ts" }), io);
    await appendReadEntry("/c.jsonl", sample({ filePath: "/b.ts" }), io);
    const lines = io.files
      .get("/c.jsonl")!
      .split("\n")
      .filter((l) => l.trim());
    expect(lines.length).toBe(2);
  });

  it("round-trip: append then load returns the same entry", async () => {
    const io = inMemoryIO();
    const entry = sample({ filePath: "/round.ts", sha256: "ROUND" });
    await appendReadEntry("/c.jsonl", entry, io);
    const map = await loadReadCache("/c.jsonl", io);
    expect(map.get("/round.ts")).toEqual(entry);
  });
});

describe("sessionCachePath", () => {
  it("composes a stable per-session path under ~/.sipcode/proxy-reads/", () => {
    const p = sessionCachePath("/home/u", "11111111-2222-3333-4444-555555555555");
    expect(p).toContain(".sipcode");
    expect(p).toContain("proxy-reads");
    expect(p.endsWith(".jsonl")).toBe(true);
    expect(p).toContain("11111111-2222-3333-4444-555555555555");
  });
});
