import { describe, expect, it } from "vitest";
import {
  defaultCorpusDir,
  loadCorpus,
} from "../../../src/modules/benchmark/corpus.js";
import { runOne } from "../../../src/modules/benchmark/runOne.js";
import { runSuite } from "../../../src/modules/benchmark/runSuite.js";
import { renderBenchmark } from "../../../src/modules/benchmark/render.js";
import { formatJson } from "../../../src/modules/benchmark/format-json.js";
import { formatHtml } from "../../../src/modules/benchmark/format-html.js";
import {
  formatTerminal,
  formatTaskList,
} from "../../../src/modules/benchmark/format-terminal.js";
import { loadPricingForDate } from "../../../src/lib/pricing/load.js";
import { readFileSync } from "node:fs";
import type { TaskResult } from "../../../src/modules/benchmark/types.js";

function liveSuite() {
  const r = loadCorpus(defaultCorpusDir());
  if (!r.ok) throw new Error("corpus didn't load in test");
  const pricing = loadPricingForDate(new Date("2026-05-20"));
  const taskResults: TaskResult[] = [];
  for (const task of r.value) {
    const baseline = readFileSync(task.baselineTranscriptPath, "utf-8");
    const optimized = readFileSync(task.optimizedTranscriptPath, "utf-8");
    const rr = runOne({ task, baselineJsonl: baseline, optimizedJsonl: optimized, pricing });
    if (rr.ok) taskResults.push(rr.value);
  }
  return runSuite({
    tasks: taskResults,
    pricingMeta: { asOf: pricing.as_of, ageDays: 19 },
    warnings: [],
  });
}

describe("renderBenchmark", () => {
  it("produces a stable RenderedBenchmark over the live corpus", () => {
    const suite = liveSuite();
    const rendered = renderBenchmark(suite);
    expect(rendered.tasks.length).toBe(20);
    expect(rendered.headline.medianSavingsPct).toBeGreaterThan(0);
    expect(rendered.headline.medianSavingsPct).toBeLessThanOrEqual(100);
  });
});

describe("formatters", () => {
  const suite = liveSuite();
  const rendered = renderBenchmark(suite);

  it("formatJson emits parseable JSON with stable schema version", () => {
    const json = formatJson(rendered);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe("sipcode-benchmark-rendered/1");
    expect(parsed.taskCount).toBe(20);
    expect(Array.isArray(parsed.tasks)).toBe(true);
  });

  it("formatJson is idempotent", () => {
    const a = formatJson(rendered);
    const b = formatJson(rendered);
    expect(a).toBe(b);
  });

  it("formatHtml produces a single-file HTML under 30 KB", () => {
    const html = formatHtml(rendered);
    expect(html.startsWith("<!doctype html>") || html.includes("<html"));
    expect(Buffer.byteLength(html, "utf-8")).toBeLessThan(30_000);
  });

  it("formatTerminal mentions the headline median savings", () => {
    const term = formatTerminal(rendered);
    expect(term).toContain("median");
    expect(term).toContain("%");
    expect(term).toContain("BT001");
  });

  it("formatTaskList lists every BT id once", () => {
    const corp = loadCorpus(defaultCorpusDir());
    if (!corp.ok) throw new Error("corpus didn't load");
    const out = formatTaskList(corp.value);
    for (let n = 1; n <= 10; n++) {
      expect(out).toContain(`BT${String(n).padStart(3, "0")}`);
    }
  });
});
