import { describe, it, expect } from "vitest";
import {
  decideReadDedup,
  MIN_TOKENS_FOR_DEDUP,
  REASON_TOKEN_COST,
  type DedupReadInput,
} from "../../../../src/modules/proxy/rewriters/dedupRead.js";
import type { ReadEntry } from "../../../../src/modules/proxy/read-cache.js";

const entry = (over: Partial<ReadEntry> = {}): ReadEntry => ({
  filePath: "/tmp/auth.ts",
  sha256: "abcdef123456",
  mtimeMs: 1000,
  sizeBytes: 4000,
  estimatedTokens: 1000,
  firstReadAtTurn: 5,
  firstReadAt: "2026-06-09T00:00:00.000Z",
  ...over,
});

const input = (over: Partial<DedupReadInput> = {}): DedupReadInput => ({
  toolInput: { file_path: "/tmp/auth.ts" },
  current: { sha256: "abcdef123456", mtimeMs: 1000 },
  cached: entry(),
  ...over,
});

describe("decideReadDedup", () => {
  it("dedups when sha+mtime match and cache size exceeds threshold", () => {
    const d = decideReadDedup(input());
    expect(d.kind).toBe("dedup");
    if (d.kind !== "dedup") return;
    expect(d.rewriterName).toBe("dedup-read");
    expect(d.savedTokensEstimate).toBe(1000 - REASON_TOKEN_COST);
    expect(d.reason).toContain("/tmp/auth.ts");
    expect(d.reason).toContain("turn 5");
  });

  it("passes when there is no cache entry", () => {
    const d = decideReadDedup(input({ cached: undefined }));
    expect(d).toEqual({ kind: "pass", reason: "no-cache-entry" });
  });

  it("passes when current fingerprint is missing (file gone or unreadable)", () => {
    const d = decideReadDedup(input({ current: null }));
    expect(d).toEqual({ kind: "pass", reason: "missing-current-fingerprint" });
  });

  it("passes when sha differs (file edited)", () => {
    const d = decideReadDedup(
      input({ current: { sha256: "DIFFERENT", mtimeMs: 1000 } }),
    );
    expect(d).toEqual({ kind: "pass", reason: "file-changed" });
  });

  it("passes when mtime differs (touch + same content still re-read)", () => {
    const d = decideReadDedup(
      input({ current: { sha256: "abcdef123456", mtimeMs: 2000 } }),
    );
    expect(d).toEqual({ kind: "pass", reason: "file-changed" });
  });

  it("passes when cached token estimate is below threshold", () => {
    const d = decideReadDedup(
      input({ cached: entry({ estimatedTokens: MIN_TOKENS_FOR_DEDUP - 1 }) }),
    );
    expect(d).toEqual({ kind: "pass", reason: "below-threshold" });
  });

  it("passes when the model asked for a partial read (offset specified)", () => {
    const d = decideReadDedup(
      input({ toolInput: { file_path: "/tmp/auth.ts", offset: 100 } }),
    );
    expect(d).toEqual({ kind: "pass", reason: "partial-read-requested" });
  });

  it("passes when the model asked for a partial read (limit specified)", () => {
    const d = decideReadDedup(
      input({ toolInput: { file_path: "/tmp/auth.ts", limit: 50 } }),
    );
    expect(d).toEqual({ kind: "pass", reason: "partial-read-requested" });
  });

  it("passes when file_path is missing or not a string", () => {
    const d = decideReadDedup(input({ toolInput: {} }));
    expect(d).toEqual({ kind: "pass", reason: "missing-file-path" });
  });

  it("dedup reason mentions sha prefix and token estimate", () => {
    const d = decideReadDedup(
      input({
        cached: entry({ sha256: "abcdef1234567890", estimatedTokens: 5000 }),
        current: { sha256: "abcdef1234567890", mtimeMs: 1000 },
      }),
    );
    if (d.kind !== "dedup") throw new Error("expected dedup");
    expect(d.reason).toContain("abcdef1"); // first 7 chars of sha
    expect(d.reason).toContain("5000 tokens");
  });

  it("dedup reason includes the escape hatch (offset+limit guidance)", () => {
    const d = decideReadDedup(input());
    if (d.kind !== "dedup") throw new Error("expected dedup");
    expect(d.reason).toContain("offset:0 limit:2000");
  });

  it("savedTokensEstimate cannot be negative even if cached estimate < reason cost", () => {
    const d = decideReadDedup(
      input({
        cached: entry({ estimatedTokens: MIN_TOKENS_FOR_DEDUP }),
      }),
    );
    if (d.kind !== "dedup") throw new Error("expected dedup");
    expect(d.savedTokensEstimate).toBeGreaterThanOrEqual(0);
  });
});
