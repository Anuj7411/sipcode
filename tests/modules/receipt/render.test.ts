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
import { renderReceipt } from "../../../src/modules/receipt/render.js";
import {
  loadPricingForDate,
  pricingAgeDays,
} from "../../../src/lib/pricing/load.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, "../../fixtures/transcripts");
const load = (n: string) => readFileSync(path.join(fixtures, n), "utf-8");

function buildWhyReport(fixture: string) {
  const r = parseTranscript(load(fixture));
  if (!r.ok) throw new Error("parse failed");
  const pricing = loadPricingForDate(new Date("2026-05-01"));
  const totals = analyzeTokens(r.value, pricing);
  const dups = analyzeDuplicateReads(r.value);
  const idle = analyzeIdleContext(r.value);
  const topEx = analyzeTopExpensive(r.value);
  const counter = analyzeCounterfactual(r.value, dups);
  return {
    report: renderReport({
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
    }),
    sessionStartedAt: r.value.startedAt,
  };
}

describe("renderReceipt", () => {
  it("has the stable schema version", () => {
    const { report, sessionStartedAt } = buildWhyReport("read-heavy.jsonl");
    const model = renderReceipt({
      report,
      variant: "post-install",
      sessionStartedAt,
    });
    expect(model.schemaVersion).toBe("sipcode-receipt/1");
  });

  it("post-install variant uses savings tokens + 'sipped' label", () => {
    const { report, sessionStartedAt } = buildWhyReport("read-heavy.jsonl");
    const model = renderReceipt({
      report,
      variant: "post-install",
      sessionStartedAt,
    });
    expect(model.hero.sublabel).toBe("sipped");
    expect(model.hero.tokens).toBe(report.estimatedSavings.totalTokens);
  });

  it("pre-install variant uses total tokens + 'wasted' label", () => {
    const { report, sessionStartedAt } = buildWhyReport("read-heavy.jsonl");
    const model = renderReceipt({
      report,
      variant: "pre-install",
      sessionStartedAt,
    });
    expect(model.hero.sublabel).toBe("wasted");
    expect(model.hero.tokens).toBe(report.punchline.totalTokens);
  });

  it("renders top-3 leaks, locale-pinned numbers", () => {
    const { report, sessionStartedAt } = buildWhyReport("read-heavy.jsonl");
    const model = renderReceipt({
      report,
      variant: "post-install",
      sessionStartedAt,
    });
    expect(model.leaks.length).toBeLessThanOrEqual(3);
    for (const leak of model.leaks) {
      // formatNum uses en-US grouping → contains commas iff >=1000.
      expect(/^[\d,]+$/.test(leak.tokensDisplay)).toBe(true);
    }
  });

  it("session-id short form is 4 lowercase hex chars", () => {
    const { report, sessionStartedAt } = buildWhyReport("read-heavy.jsonl");
    const model = renderReceipt({
      report,
      variant: "post-install",
      sessionStartedAt,
    });
    expect(model.header.sessionIdShort.length).toBe(4);
    expect(model.header.sessionIdShort).toBe(
      model.header.sessionIdShort.toLowerCase(),
    );
  });

  it("date display is locale-pinned (en-US, UTC) — deterministic", () => {
    const { report } = buildWhyReport("read-heavy.jsonl");
    const a = renderReceipt({
      report,
      variant: "post-install",
      sessionStartedAt: "2026-05-10T08:30:00Z",
    });
    const b = renderReceipt({
      report,
      variant: "post-install",
      sessionStartedAt: "2026-05-10T08:30:00Z",
    });
    expect(a.header.dateDisplay).toBe(b.header.dateDisplay);
    expect(a.header.dateDisplay).toMatch(/2026/);
  });

  it("tagline and url are LOCKED brand strings", () => {
    const { report, sessionStartedAt } = buildWhyReport("minimal-2turn.jsonl");
    const model = renderReceipt({
      report,
      variant: "post-install",
      sessionStartedAt,
    });
    expect(model.footer.tagline).toBe("sip your tokens. don't gulp them.");
    expect(model.footer.url).toBe("github.com/Anuj7411/sipcode");
  });
});
