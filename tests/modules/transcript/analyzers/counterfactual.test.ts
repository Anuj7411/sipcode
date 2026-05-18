import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTranscript } from "../../../../src/modules/transcript/parse.js";
import { analyzeDuplicateReads } from "../../../../src/modules/transcript/analyzers/duplicateReads.js";
import { analyzeCounterfactual } from "../../../../src/modules/transcript/analyzers/counterfactual.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, "../../../fixtures/transcripts");
const load = (n: string) => readFileSync(path.join(fixtures, n), "utf-8");

describe("analyzeCounterfactual", () => {
  it("reports positive savings for read-heavy session", () => {
    const r = parseTranscript(load("read-heavy.jsonl"));
    if (!r.ok) throw new Error("parse failed");
    const dups = analyzeDuplicateReads(r.value);
    const c = analyzeCounterfactual(r.value, dups);
    expect(c.s001_manifest).toBeGreaterThan(0);
    expect(c.s030_readOnce).toBeGreaterThan(0);
    expect(c.total).toBeGreaterThan(0);
  });

  it("M013 exactly equals duplicate read cost", () => {
    const r = parseTranscript(load("read-heavy.jsonl"));
    if (!r.ok) throw new Error("parse failed");
    const dups = analyzeDuplicateReads(r.value);
    const c = analyzeCounterfactual(r.value, dups);
    expect(c.s030_readOnce).toBe(dups.duplicateReadTokenCost);
  });

  it("0 savings on session with no usage data", () => {
    const r = parseTranscript(load("older-schema-no-usage.jsonl"));
    if (!r.ok) throw new Error("parse failed");
    const dups = analyzeDuplicateReads(r.value);
    const c = analyzeCounterfactual(r.value, dups);
    expect(c.total).toBe(0);
  });
});
