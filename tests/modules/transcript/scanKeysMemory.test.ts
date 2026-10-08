import { describe, expect, it } from "vitest";
import v8 from "node:v8";
import vm from "node:vm";
import { scanClaudeRequestKeys, type KeyScan } from "../../../src/modules/transcript/parse.js";

// gc() without launching node with --expose-gc. If it cannot be obtained
// the test is skipped rather than failing confusingly.
let gc: (() => void) | undefined;
try {
  v8.setFlagsFromString("--expose-gc");
  const g: unknown = vm.runInNewContext("gc");
  if (typeof g === "function") gc = g as () => void;
} catch {
  gc = undefined;
}

function line(i: number, pad: string): string {
  return JSON.stringify({
    type: "assistant",
    requestId: `req_${i % 20}`,
    message: {
      id: `msg_${i % 20}`,
      content: [{ type: "text", text: pad }],
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    timestamp: `2026-09-01T10:00:${String(i % 60).padStart(2, "0")}Z`,
  });
}

/** Scans ~50 MB of text and returns only the scan result (the text goes out of scope). */
function scanBigFile(): KeyScan {
  const pad = "x".repeat(5000);
  const lines: string[] = [];
  for (let i = 0; i < 10_000; i++) lines.push(line(i, pad));
  return scanClaudeRequestKeys(lines.join("\n"));
}

describe("scanClaudeRequestKeys memory", () => {
  it.skipIf(gc === undefined)("does not retain the scanned text (keys and timestamps are copies, not slices)", () => {
    gc!();
    const before = process.memoryUsage().heapUsed;
    const scan = scanBigFile();
    gc!();
    gc!();
    const retainedMB = (process.memoryUsage().heapUsed - before) / 1048576;
    expect(scan.keys).toHaveLength(20);
    expect(scan.startedAt).toBe("2026-09-01T10:00:00Z");
    // Retaining the parent text would be ~50 MB.
    expect(retainedMB).toBeLessThan(5);
  });
});
