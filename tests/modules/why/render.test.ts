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
import { punchlineOneLiner, renderReport } from "../../../src/modules/why/render.js";
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

  // The non-output tokens are the context sent with each request (mostly re-sent
  // conversation, much of it read from cache), not "exploration, re-reads and idle context".
  it("oneLiner: output vs the context sent with each request, with the cache-read share", () => {
    expect(buildReport("minimal-2turn.jsonl").punchline.oneLiner).toBe(
      "you used 2,622 tokens. 120 were output (text, code and reasoning). the other 2,502 were context sent with each request, 48% of it read from cache.",
    );
    expect(buildReport("read-heavy.jsonl").punchline.oneLiner).toBe(
      "you used 47,965 tokens. 970 were output (text, code and reasoning). the other 46,995 were context sent with each request, 78% of it read from cache.",
    );
  });

  it("oneLiner: no cache clause when nothing was read from cache", () => {
    expect(punchlineOneLiner({ outputTokens: 60, inputTokens: 940, cacheReadTokens: 0, cacheCreationTokens: 0 })).toBe(
      "you used 1,000 tokens. 60 were output (text, code and reasoning). the other 940 were context sent with each request.",
    );
    expect(punchlineOneLiner({ outputTokens: 0, inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 })).toBe(
      "you used 0 tokens. 0 were output (text, code and reasoning). the other 0 were context sent with each request.",
    );
    // A share above zero never reads 0%.
    expect(punchlineOneLiner({ outputTokens: 0, inputTokens: 999_999, cacheReadTokens: 1, cacheCreationTokens: 0 })).toBe(
      "you used 1,000,000 tokens. 0 were output (text, code and reasoning). the other 1,000,000 were context sent with each request, <0.1% of it read from cache.",
    );
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
