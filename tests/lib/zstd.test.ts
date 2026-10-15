/** zstd decoding for Codex's compressed logs: every frame, complete files only. */
import { afterEach, describe, expect, it } from "vitest";
import zlib from "node:zlib";
import {
  CorruptZstdError,
  decompressZstd,
  setZstdCodecForTests,
  zstdCodec,
  zstdFirstLine,
  zstdFrames,
  type ZstdCodec,
} from "../../src/lib/zstd.js";

const z = zlib as unknown as { zstdCompressSync: (b: Buffer) => Buffer };
const zst = (s: string): Buffer => z.zstdCompressSync(Buffer.from(s, "utf8"));

afterEach(() => setZstdCodecForTests(undefined));

function codec(): ZstdCodec {
  const c = zstdCodec();
  if (!c) throw new Error("this Node has no zstd: the suite needs Node 22.15+");
  return c;
}

describe("zstd", () => {
  it("this Node has zstd (Node 22.15+ / 23.8+)", () => {
    expect(zstdCodec()).not.toBeNull();
  });

  it("decodes a file back to its text", () => {
    const text = Array.from({ length: 500 }, (_, i) => JSON.stringify({ i, pad: "x".repeat(100) })).join("\n") + "\n";
    expect(decompressZstd(zst(text), codec()).toString("utf8")).toBe(text);
  });

  it("decodes every frame of a multi-frame file (Node alone decodes only the first)", () => {
    const two = Buffer.concat([zst("a\n"), zst("b\n")]);
    expect((zlib as unknown as { zstdDecompressSync: (b: Buffer) => Buffer }).zstdDecompressSync(two).toString()).toBe("a\n");
    expect(zstdFrames(two)).toHaveLength(2);
    expect(decompressZstd(two, codec()).toString()).toBe("a\nb\n");
  });

  it("ignores skippable frames", () => {
    const skip = Buffer.alloc(8 + 3);
    skip.writeUInt32LE(0x184d2a5e, 0);
    skip.writeUInt32LE(3, 4);
    expect(decompressZstd(Buffer.concat([skip, zst("x\n")]), codec()).toString()).toBe("x\n");
  });

  it("rejects a truncated file (Node alone returns partial text without an error)", () => {
    const text = Array.from({ length: 2000 }, (_, i) => `{"i":${i},"pad":"${"y".repeat(200)}"}`).join("\n");
    const full = zst(text);
    for (const cut of [full.length - 1, full.length - 10, full.length >> 1, 5, 3]) {
      expect(() => decompressZstd(full.subarray(0, cut), codec())).toThrow(CorruptZstdError);
    }
  });

  it("rejects an empty file and bytes that are not zstd", () => {
    expect(() => decompressZstd(Buffer.alloc(0), codec())).toThrow(CorruptZstdError);
    expect(() => decompressZstd(Buffer.from('{"type":"session_meta"}\n'), codec())).toThrow(CorruptZstdError);
  });

  it("rejects a frame whose decoded size differs from its header", () => {
    const short: ZstdCodec = { ...codec(), decompressFrame: (f) => codec().decompressFrame(f).subarray(1) };
    expect(() => decompressZstd(zst("abc\n"), short)).toThrow(/decoded size/);
  });

  it("turns a decoder error into CorruptZstdError", () => {
    const failing: ZstdCodec = {
      ...codec(),
      decompressFrame: () => {
        throw new Error("Data corruption detected");
      },
    };
    expect(() => decompressZstd(zst("abc\n"), failing)).toThrow(CorruptZstdError);
  });

  it("reads line 1 without decoding the rest", async () => {
    const line1 = JSON.stringify({ type: "session_meta", payload: { id: "a", text: "é".repeat(30_000) } });
    const rest = Array.from({ length: 3000 }, (_, i) => `{"n":${i}}`).join("\n");
    expect(await zstdFirstLine(zst(`${line1}\n${rest}\n`), codec())).toBe(line1);
    expect(await zstdFirstLine(zst("only line"), codec())).toBe("only line");
    // Line 1 split across frames.
    expect(await zstdFirstLine(Buffer.concat([zst("ab"), zst("c\nd\n")]), codec())).toBe("abc");
  });

  it("line 1 of a truncated or foreign file is an error, like a full read", async () => {
    const full = zst(`first\n${"z".repeat(100_000)}\n`);
    await expect(zstdFirstLine(full.subarray(0, full.length - 4), codec())).rejects.toThrow(CorruptZstdError);
    await expect(zstdFirstLine(Buffer.from("plain text\n"), codec())).rejects.toThrow(CorruptZstdError);
  });

  it("can be switched off for tests (a Node without zstd)", () => {
    setZstdCodecForTests(null);
    expect(zstdCodec()).toBeNull();
    setZstdCodecForTests(undefined);
    expect(zstdCodec()).not.toBeNull();
  });
});
