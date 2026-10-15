/**
 * Zstandard (`.zst`) decoding for the session logs Codex compresses
 * (`rollout-*.jsonl.zst`). node:zlib only: no dependency, no network.
 *
 * Node.js ships zstd in node:zlib from 22.15 (and 23.8). On an older Node the
 * codec is null and callers report the compressed logs as skipped, with the
 * Node version they need (never silently).
 *
 * Node's decoder has two traps this module closes:
 *  - it decodes only the FIRST frame of a multi-frame input;
 *  - it returns partial output, with no error, for a truncated frame.
 * So the frames are walked first (frame headers and block headers only, no
 * decoding): a file is decoded only when every frame is complete, frame by
 * frame, and each frame's output is checked against the content size its
 * header declares. Anything else is CorruptZstdError (an unreadable log).
 */
import zlib from "node:zlib";
import type { Transform } from "node:stream";

export interface ZstdCodec {
  /** Decode one complete zstd frame. */
  decompressFrame(frame: Uint8Array): Buffer;
  /** A streaming decoder for one frame (used to read only the first line). */
  createDecompressStream(): Transform;
}

/** The Node.js release line that first ships zstd in node:zlib (said in notes). */
export const ZSTD_MIN_NODE = "22.15";

export class ZstdUnavailableError extends Error {
  constructor() {
    super(`reading compressed logs (.zst) needs Node.js ${ZSTD_MIN_NODE} or newer (you have ${process.version}).`);
    this.name = "ZstdUnavailableError";
  }
}

export class CorruptZstdError extends Error {
  constructor(why: string) {
    super(`not a complete zstd file: ${why}`);
    this.name = "CorruptZstdError";
  }
}

interface NodeZstd {
  zstdDecompressSync?: (buf: Uint8Array) => Buffer;
  createZstdDecompress?: () => Transform;
}

function nodeCodec(): ZstdCodec | null {
  const z = zlib as unknown as NodeZstd;
  const sync = z.zstdDecompressSync;
  const stream = z.createZstdDecompress;
  if (typeof sync !== "function" || typeof stream !== "function") return null;
  return {
    decompressFrame: (frame) => sync(frame),
    createDecompressStream: () => stream(),
  };
}

let detected: ZstdCodec | null | undefined;
let override: ZstdCodec | null | undefined;

/** This Node's zstd decoder, or null when it has none. */
export function zstdCodec(): ZstdCodec | null {
  if (override !== undefined) return override;
  if (detected === undefined) detected = nodeCodec();
  return detected;
}

/**
 * Tests: pretend this Node has no zstd (null), or use another codec.
 * undefined restores detection.
 */
export function setZstdCodecForTests(codec: ZstdCodec | null | undefined): void {
  override = codec;
}

const ZSTD_MAGIC = 0xfd2fb528;
const SKIPPABLE_MASK = 0xfffffff0;
const SKIPPABLE_MAGIC = 0x184d2a50;

interface Frame {
  readonly start: number;
  readonly end: number;
  /** Decoded size the header declares, when it declares one. */
  readonly contentSize: number | undefined;
}

/**
 * The data frames of a zstd file, or CorruptZstdError when the bytes are not
 * a sequence of complete frames (truncated, foreign, or empty). Skippable
 * frames are allowed and ignored. Reads headers only (RFC 8878 section 3.1).
 */
export function zstdFrames(buf: Uint8Array): Frame[] {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  const frames: Frame[] = [];
  let p = 0;
  if (b.length === 0) throw new CorruptZstdError("empty file");
  while (p < b.length) {
    if (p + 4 > b.length) throw new CorruptZstdError("truncated frame header");
    const magic = b.readUInt32LE(p);
    if ((magic & SKIPPABLE_MASK) >>> 0 === SKIPPABLE_MAGIC) {
      if (p + 8 > b.length) throw new CorruptZstdError("truncated skippable frame");
      p += 8 + b.readUInt32LE(p + 4);
      if (p > b.length) throw new CorruptZstdError("truncated skippable frame");
      continue;
    }
    if (magic !== ZSTD_MAGIC) throw new CorruptZstdError("unknown frame");
    const start = p;
    p += 4;
    if (p >= b.length) throw new CorruptZstdError("truncated frame header");
    const fhd = b[p++]!;
    const fcsFlag = fhd >> 6;
    const singleSegment = (fhd >> 5) & 1;
    const hasChecksum = (fhd >> 2) & 1;
    const dictIdSize = [0, 1, 2, 4][fhd & 3]!;
    const fcsSize = fcsFlag === 0 ? singleSegment : [1, 2, 4, 8][fcsFlag]!;
    p += (singleSegment ? 0 : 1) + dictIdSize;
    if (p + fcsSize > b.length) throw new CorruptZstdError("truncated frame header");
    let contentSize: number | undefined;
    if (fcsSize === 1) contentSize = b[p]!;
    else if (fcsSize === 2) contentSize = b.readUInt16LE(p) + 256;
    else if (fcsSize === 4) contentSize = b.readUInt32LE(p);
    else if (fcsSize === 8) contentSize = Number(b.readBigUInt64LE(p));
    p += fcsSize;
    for (;;) {
      if (p + 3 > b.length) throw new CorruptZstdError("truncated block");
      const h = b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16);
      p += 3;
      const type = (h >> 1) & 3;
      if (type === 3) throw new CorruptZstdError("reserved block type");
      p += type === 1 ? 1 : h >>> 3; // an RLE block stores one byte
      if (p > b.length) throw new CorruptZstdError("truncated block");
      if (h & 1) break; // last block
    }
    if (hasChecksum) p += 4;
    if (p > b.length) throw new CorruptZstdError("truncated checksum");
    frames.push({ start, end: p, contentSize });
  }
  if (frames.length === 0) throw new CorruptZstdError("no data frame");
  return frames;
}

/** Decode a whole zstd file, every frame; CorruptZstdError unless it is complete. */
export function decompressZstd(buf: Uint8Array, codec: ZstdCodec): Buffer {
  const parts: Buffer[] = [];
  for (const f of zstdFrames(buf)) {
    let out: Buffer;
    try {
      out = codec.decompressFrame(buf.subarray(f.start, f.end));
    } catch (e) {
      throw new CorruptZstdError(e instanceof Error ? e.message : String(e));
    }
    if (f.contentSize !== undefined && out.length !== f.contentSize) {
      throw new CorruptZstdError("decoded size does not match the frame header");
    }
    parts.push(out);
  }
  return parts.length === 1 ? parts[0]! : Buffer.concat(parts);
}

/** Decode one frame until its first newline; `newline` false when the frame has none. */
function frameHead(codec: ZstdCodec, frame: Uint8Array): Promise<{ bytes: Buffer; newline: boolean }> {
  return new Promise((resolve, reject) => {
    const d = codec.createDecompressStream();
    const chunks: Buffer[] = [];
    let settled = false;
    const done = (r: { bytes: Buffer; newline: boolean }): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    d.on("data", (chunk: Buffer) => {
      if (settled) return;
      const nl = chunk.indexOf(0x0a);
      if (nl < 0) {
        chunks.push(chunk);
        return;
      }
      chunks.push(chunk.subarray(0, nl));
      done({ bytes: Buffer.concat(chunks), newline: true });
      d.destroy(); // the rest of the frame is never decoded
    });
    d.on("end", () => done({ bytes: Buffer.concat(chunks), newline: false }));
    d.on("error", (e) => {
      if (settled) return;
      settled = true;
      reject(new CorruptZstdError(e.message));
    });
    d.end(frame);
  });
}

/**
 * Line 1 of a zstd file (without its newline), decoding only up to it. The
 * file must still be complete (zstdFrames), so a truncated log is unreadable
 * here exactly as it is for a full read.
 */
export async function zstdFirstLine(buf: Uint8Array, codec: ZstdCodec): Promise<string> {
  const parts: Buffer[] = [];
  for (const f of zstdFrames(buf)) {
    const h = await frameHead(codec, buf.subarray(f.start, f.end));
    parts.push(h.bytes);
    if (h.newline) break;
  }
  return Buffer.concat(parts).toString("utf8");
}
