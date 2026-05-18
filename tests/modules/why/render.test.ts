import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTranscript } from "../../../src/modules/transcript/parse.js";
import { analyzeTokens } from "../../../src/modules/transcript/analyzers/tokens.js";
import { analyzeDuplicateReads } from "../../../src/modules/transcript/analyzers/duplicateReads.js";
import { analyzeIdleContext } from "../../../src/modules/transcript/analyzers/idleContext.js";
import { analyzeTopExpensive } from "../../../src/modules/transcript/analyzers/topExpensive.js";
import { analyzeCounterfactual } from "../../../src/modules/transcript/analyzers/counterfactual.js";
import { renderReport } from "../../../src/modules/why/render.js";
import { loadPricingForDate, pricingAgeDays } from "../../../src/lib/pricing/load.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, "../../fixtures/transcripts");
const load = (n: string) => readFileSync(path.join(fixtures, n), "utf-8");

function buildReport(fixture: string) {
  const r = parseTranscript(load(fixture));
  if (!r.ok) throw new Error("parse failed");
  const pricing = loadPricingForDate(new Date("2026-05-01"));
  const totals = analyzeTokens(r.value, pricing);
  const dups = analyzeDuplicateReads(r.value);
  const idle = analyzeIdleContext(r.value);
  const topEx = analyzeTopExpensive(r.value);
  const counter = analyzeCounterfactual(r.value, dups);
  return renderReport({
    session: r.value,
    totals,
    duplicates: dups,
    idle,
    topExpensive: topEx,
    counterfactual: counter,
    issues: [],
    projectHash: "test-project",
    pricingMeta: {
      asOf: pricing.as_of,
      ageDays: pricingAgeDays(pricing, new Date("2026-05-15")),
    },
  });
}

describe("renderReport", () => {
  it("returns the stable schema version", () => {
    const report = buildReport("minimal-2turn.jsonl");
    expect(report.schemaVersion).toBe("sipcode-why/1");
  });

  it("punchline.totalTokens equals sum of M001-M004", () => {
    const report = buildReport("minimal-2turn.jsonl");
    expect(report.punchline.totalTokens).toBe(
      report.totals.inputTokens +
        report.totals.outputTokens +
        report.totals.cacheReadTokens +
        report.totals.cacheCreationTokens,
    );
  });

  it("top leaks are sorted desc by tokens", () => {
    const report = buildReport("read-heavy.jsonl");
    for (let i = 1; i < report.topLeaks.length; i++) {
      expect(report.topLeaks[i]!.tokens).toBeLessThanOrEqual(
        report.topLeaks[i - 1]!.tokens,
      );
    }
  });

  it("matches JSON snapshot for minimal-2turn", () => {
    const report = buildReport("minimal-2turn.jsonl");
    expect(report).toMatchSnapshot();
  });

  it("matches JSON snapshot for read-heavy", () => {
    const report = buildReport("read-heavy.jsonl");
    expect(report).toMatchSnapshot();
  });

  it("matches JSON snapshot for multi-model", () => {
    const report = buildReport("multi-model.jsonl");
    expect(report).toMatchSnapshot();
  });
});
