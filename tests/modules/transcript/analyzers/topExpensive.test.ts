import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTranscript } from "../../../../src/modules/transcript/parse.js";
import { analyzeTopExpensive } from "../../../../src/modules/transcript/analyzers/topExpensive.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, "../../../fixtures/transcripts");
const load = (n: string) => readFileSync(path.join(fixtures, n), "utf-8");

describe("analyzeTopExpensive", () => {
  it("returns up to 5 entries sorted by token cost desc", () => {
    const r = parseTranscript(load("read-heavy.jsonl"));
    if (!r.ok) throw new Error("parse failed");
    const top = analyzeTopExpensive(r.value);
    expect(top.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < top.length; i++) {
      expect(top[i]!.attributedTokens).toBeLessThanOrEqual(
        top[i - 1]!.attributedTokens,
      );
    }
  });

  it("attaches a reason tag to each entry", () => {
    const r = parseTranscript(load("read-heavy.jsonl"));
    if (!r.ok) throw new Error("parse failed");
    const top = analyzeTopExpensive(r.value);
    for (const t of top) {
      expect([
        "large-input",
        "cache-creation",
        "long-output",
        "duplicate-read",
        "ordinary",
      ]).toContain(t.reason);
    }
  });
});
