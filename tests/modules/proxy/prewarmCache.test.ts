/**
 * Tests for prewarmCache.ts — the Verified Warm-Fill module.
 *
 * Architecture detail in docs/research/2026-06-15-mid-session-cache-warming.md.
 *
 * Each test follows the form:
 *   1. Build an in-memory transcript (JSONL lines)
 *   2. Build an in-memory disk state (path -> rawBytes)
 *   3. Invoke prewarmFromTranscript
 *   4. Assert on entries + stats
 *
 * The pure module's I/O seam is fully mockable, so no actual fs.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  prewarmFromTranscript,
  canonicalizeForCompare,
  type PrewarmIO,
} from "../../../src/modules/proxy/prewarmCache.js";

const NOW = new Date("2026-06-15T12:00:00.000Z");

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

interface MockState {
  transcript: string;
  files: Record<string, string | null>; // null = file missing
}

function makeIO(s: MockState): PrewarmIO {
  return {
    async readTranscript(_p) {
      return s.transcript;
    },
    async readAndStatFile(p) {
      const v = s.files[p];
      if (v === undefined || v === null) return null;
      const rawBytes = Buffer.from(v, "utf-8");
      return {
        rawBytes,
        sha256: sha256(rawBytes),
        mtimeMs: 1700000000000,
        sizeBytes: rawBytes.length,
      };
    },
    now() {
      return NOW;
    },
  };
}

/** Build a single transcript line for a Read tool_result with file content. */
function readLine(args: {
  filePath: string;
  content: string;
  numLines?: number;
  totalLines?: number;
  startLine?: number;
  toolUseId?: string;
}): string {
  const numLines = args.numLines ?? args.content.split("\n").length;
  const totalLines = args.totalLines ?? numLines;
  const startLine = args.startLine ?? 1;
  return (
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            tool_use_id: args.toolUseId ?? "toolu_x",
            type: "tool_result",
            content: `${startLine}\t${args.content}`,
          },
        ],
      },
      toolUseResult: {
        type: "text",
        file: {
          filePath: args.filePath,
          content: args.content,
          numLines,
          startLine,
          totalLines,
        },
      },
    }) + "\n"
  );
}

function assistantTurn(): string {
  return JSON.stringify({ type: "assistant", role: "assistant" }) + "\n";
}

describe("canonicalizeForCompare", () => {
  it("strips a leading UTF-8 BOM", () => {
    expect(canonicalizeForCompare("﻿hello")).toBe("hello");
  });

  it("normalizes CRLF to LF", () => {
    expect(canonicalizeForCompare("a\r\nb\r\nc")).toBe("a\nb\nc");
  });

  it("normalizes lone CR to LF", () => {
    expect(canonicalizeForCompare("a\rb\rc")).toBe("a\nb\nc");
  });

  it("leaves LF-only input alone", () => {
    expect(canonicalizeForCompare("a\nb\nc")).toBe("a\nb\nc");
  });

  it("returns empty string on empty input", () => {
    expect(canonicalizeForCompare("")).toBe("");
  });

  it("handles BOM + CRLF combined", () => {
    expect(canonicalizeForCompare("﻿a\r\nb")).toBe("a\nb");
  });
});

describe("prewarmFromTranscript — happy path", () => {
  it("warms an entry when transcript content matches disk content", async () => {
    const fileContent = "export const x = 1;\nexport const y = 2;\n";
    const io = makeIO({
      transcript:
        assistantTurn() +
        readLine({ filePath: "C:\\proj\\auth.ts", content: fileContent }),
      files: { "c:/proj/auth.ts": fileContent },
    });

    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(),
      io,
    });

    expect(result.entries.length).toBe(1);
    expect(result.entries[0]!.filePath).toBe("c:/proj/auth.ts");
    expect(result.entries[0]!.source).toBe("warmfill");
    expect(result.entries[0]!.sha256).toBe(sha256(Buffer.from(fileContent, "utf-8")));
    expect(result.stats.written).toBe(1);
    expect(result.stats.bailed).toBe(false);
  });
});

describe("prewarmFromTranscript — safety guarantees (zero false-dedup)", () => {
  it("DROPS the entry when disk content drifted from transcript content", async () => {
    const oldContent = "old content\n";
    const newContent = "edited content\n";
    const io = makeIO({
      transcript:
        assistantTurn() +
        readLine({ filePath: "C:\\proj\\auth.ts", content: oldContent }),
      // disk has the NEW content (someone edited the file between historical read and warm)
      files: { "c:/proj/auth.ts": newContent },
    });

    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(),
      io,
    });

    // Critical safety property: drift between historical and current
    // bytes must NEVER produce a cache entry. Next live read will
    // refresh naturally.
    expect(result.entries.length).toBe(0);
    expect(result.stats.skippedShaMismatch).toBe(1);
  });

  it("DROPS the entry when the file no longer exists on disk", async () => {
    const io = makeIO({
      transcript:
        assistantTurn() +
        readLine({ filePath: "C:\\proj\\removed.ts", content: "x" }),
      files: {}, // file is gone
    });

    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(),
      io,
    });

    expect(result.entries.length).toBe(0);
    expect(result.stats.skippedMissingFile).toBe(1);
  });
});

describe("prewarmFromTranscript — partial reads", () => {
  it("skips partial reads where numLines < totalLines", async () => {
    const io = makeIO({
      transcript:
        assistantTurn() +
        readLine({
          filePath: "C:\\proj\\big.ts",
          content: "first 100 lines",
          numLines: 100,
          totalLines: 500,
        }),
      files: { "c:/proj/big.ts": "first 100 lines" },
    });

    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(),
      io,
    });

    expect(result.entries.length).toBe(0);
    expect(result.stats.skippedPartial).toBe(1);
  });

  it("skips partial reads where startLine > 1", async () => {
    const io = makeIO({
      transcript:
        assistantTurn() +
        readLine({
          filePath: "C:\\proj\\file.ts",
          content: "middle slice",
          startLine: 50,
          numLines: 20,
          totalLines: 200,
        }),
      files: { "c:/proj/file.ts": "middle slice" },
    });

    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(),
      io,
    });

    expect(result.entries.length).toBe(0);
    expect(result.stats.skippedPartial).toBe(1);
  });

  it("treats reads with no startLine/totalLines fields as full reads", async () => {
    // Older Claude Code versions may not emit numLines/totalLines fields.
    // Conservative default: treat as full read if fields are absent.
    const content = "x";
    const lineObj = {
      type: "user",
      toolUseResult: {
        type: "text",
        file: { filePath: "C:\\proj\\f.ts", content },
      },
    };
    const io = makeIO({
      transcript: assistantTurn() + JSON.stringify(lineObj) + "\n",
      files: { "c:/proj/f.ts": content },
    });

    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(),
      io,
    });

    expect(result.entries.length).toBe(1);
  });
});

describe("prewarmFromTranscript — line endings + BOM canonicalization", () => {
  it("matches CRLF disk content against LF transcript content", async () => {
    const lfContent = "a\nb\nc\n";
    const crlfContent = "a\r\nb\r\nc\r\n";
    const io = makeIO({
      transcript: assistantTurn() + readLine({ filePath: "C:\\f.ts", content: lfContent }),
      files: { "c:/f.ts": crlfContent },
    });

    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(),
      io,
    });

    expect(result.entries.length).toBe(1);
  });

  it("matches BOM-prefixed disk content against no-BOM transcript content", async () => {
    const noBom = "hello world";
    const withBom = "﻿hello world";
    const io = makeIO({
      transcript: assistantTurn() + readLine({ filePath: "C:\\f.ts", content: noBom }),
      files: { "c:/f.ts": withBom },
    });

    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(),
      io,
    });

    expect(result.entries.length).toBe(1);
  });
});

describe("prewarmFromTranscript — idempotency + cap", () => {
  it("skips candidates already present in existingPaths", async () => {
    const content = "x";
    const io = makeIO({
      transcript: assistantTurn() + readLine({ filePath: "C:\\proj\\seen.ts", content }),
      files: { "c:/proj/seen.ts": content },
    });

    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(["c:/proj/seen.ts"]),
      io,
    });

    expect(result.entries.length).toBe(0);
    expect(result.stats.skippedAlreadyCached).toBe(1);
  });

  it("respects cap, keeping the most-recently-read entries", async () => {
    // Build a transcript with 5 unique files; cap at 3 should keep the last 3.
    const lines: string[] = [assistantTurn()];
    for (let i = 0; i < 5; i++) {
      lines.push(assistantTurn());
      lines.push(readLine({ filePath: `C:\\f${i}.ts`, content: `file ${i}` }));
    }
    const files: Record<string, string> = {};
    for (let i = 0; i < 5; i++) {
      files[`c:/f${i}.ts`] = `file ${i}`;
    }

    const io = makeIO({ transcript: lines.join(""), files });

    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(),
      io,
      cap: 3,
    });

    expect(result.entries.length).toBe(3);
    // The most-recently-read 3 are f2, f3, f4 (last seen turns).
    const paths = result.entries.map((e) => e.filePath).sort();
    expect(paths).toEqual(["c:/f2.ts", "c:/f3.ts", "c:/f4.ts"]);
    expect(result.stats.skippedOverCap).toBe(2);
  });

  it("keeps the LATEST content when the same file is read multiple times", async () => {
    // Important: Claude's freshest in-context copy is the most recent. If we
    // kept the OLDEST, we'd risk warming with an stale sha that doesn't match
    // current disk even when the file is unchanged since the latest read.
    const oldContent = "first version";
    const newContent = "edited mid-session";
    const lines =
      assistantTurn() +
      readLine({ filePath: "C:\\f.ts", content: oldContent, toolUseId: "t1" }) +
      assistantTurn() +
      readLine({ filePath: "C:\\f.ts", content: newContent, toolUseId: "t2" });

    const io = makeIO({
      transcript: lines,
      files: { "c:/f.ts": newContent }, // disk matches the LATEST read
    });

    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(),
      io,
    });

    expect(result.entries.length).toBe(1);
  });
});

describe("prewarmFromTranscript — robustness", () => {
  it("returns empty when transcript is missing", async () => {
    const io: PrewarmIO = {
      async readTranscript() {
        return null;
      },
      async readAndStatFile() {
        return null;
      },
      now() {
        return NOW;
      },
    };
    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(),
      io,
    });
    expect(result.entries.length).toBe(0);
    expect(result.stats.bailed).toBe(true);
  });

  it("skips malformed transcript lines without bailing", async () => {
    const content = "x";
    const io = makeIO({
      transcript:
        "not valid json\n" +
        "{ also not: a complete obj\n" +
        assistantTurn() +
        readLine({ filePath: "C:\\f.ts", content }) +
        "\n\n", // empty lines too
      files: { "c:/f.ts": content },
    });

    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(),
      io,
    });

    expect(result.entries.length).toBe(1);
    expect(result.stats.bailed).toBe(false);
  });

  it("bails when transcript exceeds maxTranscriptBytes", async () => {
    const big = "x".repeat(1_000_000); // 1 MB
    const io = makeIO({ transcript: big, files: {} });

    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(),
      io,
      maxTranscriptBytes: 500_000, // cap below transcript size
    });

    expect(result.entries.length).toBe(0);
    expect(result.stats.bailed).toBe(true);
  });

  it("ignores non-tool-result lines (assistant turns, user messages, etc.)", async () => {
    const io = makeIO({
      transcript:
        JSON.stringify({ type: "assistant", role: "assistant" }) + "\n" +
        JSON.stringify({ type: "user", role: "user", content: [{ type: "text", text: "hello" }] }) + "\n" +
        JSON.stringify({ type: "user", toolUseResult: { type: "summary", summary: "x" } }) + "\n",
      files: {},
    });

    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(),
      io,
    });

    expect(result.entries.length).toBe(0);
    expect(result.stats.candidates).toBe(0);
  });
});

describe("prewarmFromTranscript — research doc § 10 scenarios", () => {
  // Scenario 6: "File deleted between warm and re-read."
  // We can't test the re-read step from prewarmCache.ts alone — that's the
  // live decision's job. But we CAN assert that a file deleted BEFORE warm
  // (so readAndStatFile returns null) does not produce a stale entry.
  it("scenario 6: a file deleted before warm is dropped (no entry, missing counter increments)", async () => {
    const io = makeIO({
      transcript: assistantTurn() + readLine({ filePath: "C:\\proj\\gone.ts", content: "x" }),
      files: {}, // file is gone
    });

    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(),
      io,
    });

    expect(result.entries.length).toBe(0);
    expect(result.stats.skippedMissingFile).toBe(1);
  });

  // Scenario 10: "1000+ Read transcript: stream-parse, memory bounded,
  // completes under 500ms." We assert correctness on a synthetic 1000-Read
  // transcript and ensure the cap correctly bounds work to 200 files.
  it("scenario 10: handles a 1000-Read transcript without blowing up the cap", async () => {
    const lines: string[] = [];
    const files: Record<string, string> = {};
    for (let i = 0; i < 1000; i++) {
      lines.push(assistantTurn());
      lines.push(readLine({ filePath: `C:\\f${i}.ts`, content: `payload ${i}` }));
      files[`c:/f${i}.ts`] = `payload ${i}`;
    }
    const io = makeIO({ transcript: lines.join(""), files });

    const start = Date.now();
    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(),
      io,
      // cap defaults to 200; assert we honor it on stress input
    });
    const elapsed = Date.now() - start;

    expect(result.entries.length).toBe(200);
    expect(result.stats.candidates).toBe(1000);
    expect(result.stats.skippedOverCap).toBe(800);
    // Sanity: even synchronous-only mocked I/O shouldn't take more than 2s
    // on a thousand-entry walk. Real-disk numbers are bounded by the cap.
    expect(elapsed).toBeLessThan(2000);
  });

  // Scenario 13: "Schema backwards compatibility — v1.6.14 cache entries
  // (no source field) still read correctly by v1.6.15." This is enforced by
  // the optional `source?` field on ReadEntry. We test by writing a legacy
  // entry shape and re-loading it via loadReadCache.
  it("scenario 13: v1.6.14 cache entries without `source` field load cleanly", async () => {
    // We import loadReadCache here to avoid coupling — same module the
    // hook uses to load cache state.
    const { loadReadCache } = await import("../../../src/modules/proxy/read-cache.js");
    const legacyEntry = JSON.stringify({
      filePath: "/proj/auth.ts",
      sha256: "abc",
      mtimeMs: 1000,
      sizeBytes: 4000,
      estimatedTokens: 1000,
      firstReadAtTurn: 5,
      firstReadAt: "2026-06-14T00:00:00.000Z",
      // NO `source` field — this is what v1.6.14 wrote
    }) + "\n";

    const fakeIO = {
      async read() {
        return legacyEntry;
      },
      async append() {
        // never called in this test
      },
    };
    const cache = await loadReadCache("/fake-cache.jsonl", fakeIO);

    expect(cache.size).toBe(1);
    const entry = cache.get("/proj/auth.ts")!;
    expect(entry.sha256).toBe("abc");
    expect(entry.source).toBeUndefined(); // optional; not set in legacy data
  });
});

describe("prewarmFromTranscript — entry metadata", () => {
  it("attributes firstReadAtTurn to the earliest assistant turn count", async () => {
    const content = "x";
    const lines =
      assistantTurn() + // turn 1
      assistantTurn() + // turn 2
      readLine({ filePath: "C:\\f.ts", content, toolUseId: "t1" }) +
      assistantTurn() + // turn 3
      readLine({ filePath: "C:\\f.ts", content, toolUseId: "t2" });

    const io = makeIO({ transcript: lines, files: { "c:/f.ts": content } });

    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(),
      io,
    });

    expect(result.entries.length).toBe(1);
    expect(result.entries[0]!.firstReadAtTurn).toBe(2);
  });

  it("records source as 'warmfill' for every entry it writes", async () => {
    const content = "x";
    const io = makeIO({
      transcript: assistantTurn() + readLine({ filePath: "C:\\f.ts", content }),
      files: { "c:/f.ts": content },
    });

    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(),
      io,
    });

    expect(result.entries[0]!.source).toBe("warmfill");
  });

  it("uses io.now() for firstReadAt timestamp", async () => {
    const content = "x";
    const io = makeIO({
      transcript: assistantTurn() + readLine({ filePath: "C:\\f.ts", content }),
      files: { "c:/f.ts": content },
    });

    const result = await prewarmFromTranscript({
      transcriptPath: "/t/sess.jsonl",
      existingPaths: new Set(),
      io,
    });

    expect(result.entries[0]!.firstReadAt).toBe(NOW.toISOString());
  });
});
