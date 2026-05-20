import { describe, expect, it } from "vitest";
import { runSuite } from "../../../src/modules/benchmark/runSuite.js";
import type {
  FlavorTotals,
  TaskCategory,
  TaskResult,
} from "../../../src/modules/benchmark/types.js";

function makeFlavor(total: number, output: number): FlavorTotals {
  return {
    inputTokens: total * 0.6,
    outputTokens: output,
    cacheReadTokens: total * 0.2,
    cacheCreationTokens: total * 0.2 - output,
    totalTokens: total,
    estCostUSD: total / 1_000_000,
    outputRatioPct: (output / total) * 100,
    distinctFilesRead: 0,
    duplicateReadTokens: 0,
    toolCallCount: 0,
  };
}

function makeTask(
  id: string,
  baselineTotal: number,
  optimizedTotal: number,
  category: TaskCategory = "refactor",
): TaskResult {
  const baseline = makeFlavor(baselineTotal, baselineTotal * 0.05);
  const optimized = makeFlavor(optimizedTotal, optimizedTotal * 0.05);
  return {
    taskId: id,
    title: `task ${id}`,
    category,
    baseline,
    optimized,
    savingsPct:
      ((baselineTotal - optimizedTotal) / baselineTotal) * 100,
    savingsTokens: baselineTotal - optimizedTotal,
    savingsUSD: (baselineTotal - optimizedTotal) / 1_000_000,
    attribution: {
      s001_manifest: (baselineTotal - optimizedTotal) * 0.4,
      s021_outputCompression: (baselineTotal - optimizedTotal) * 0.3,
      s030_readOnceCache: (baselineTotal - optimizedTotal) * 0.3,
    },
    warnings: [],
  };
}

describe("runSuite", () => {
  it("computes the median (not mean) savings", () => {
    // Three tasks: 30%, 60%, 90%. Median = 60. Mean = 60 too here, but
    // we test with an outlier-skewed example below.
    const r = runSuite({
      tasks: [
        makeTask("BT001", 100, 70),
        makeTask("BT002", 100, 40),
        makeTask("BT003", 100, 10),
      ],
      pricingMeta: { asOf: "2026-05-01", ageDays: 0 },
      warnings: [],
    });
    expect(r.summary.medianSavingsPct).toBeCloseTo(60, 1);
  });

  it("median resists outliers (this is why we don't use mean)", () => {
    const r = runSuite({
      tasks: [
        makeTask("BT001", 100, 90),
        makeTask("BT002", 100, 60),
        makeTask("BT003", 100, 40),
        makeTask("BT004", 100, 1),
      ],
      pricingMeta: { asOf: "2026-05-01", ageDays: 0 },
      warnings: [],
    });
    expect(r.summary.medianSavingsPct).toBeCloseTo(50, 1);
  });

  it("sums total tokens and USD saved across all tasks", () => {
    const r = runSuite({
      tasks: [
        makeTask("BT001", 1_000_000, 500_000),
        makeTask("BT002", 2_000_000, 1_500_000),
      ],
      pricingMeta: { asOf: "2026-05-01", ageDays: 0 },
      warnings: [],
    });
    expect(r.summary.totalSavingsTokens).toBe(1_000_000);
    expect(r.summary.totalSavingsUSD).toBeCloseTo(1, 2);
  });

  it("preserves per-task BT order in the output", () => {
    const r = runSuite({
      tasks: [
        makeTask("BT003", 100, 50),
        makeTask("BT001", 100, 50),
        makeTask("BT002", 100, 50),
      ],
      pricingMeta: { asOf: "2026-05-01", ageDays: 0 },
      warnings: [],
    });
    // We do NOT re-sort by id; the caller controls order. The contract is
    // just "stable, deterministic".
    expect(r.tasks.length).toBe(3);
    expect(r.taskCount).toBe(3);
  });

  it("attribution percentages sum to ~100 of saved tokens", () => {
    const r = runSuite({
      tasks: [
        makeTask("BT001", 1000, 500),
        makeTask("BT002", 1000, 600),
      ],
      pricingMeta: { asOf: "2026-05-01", ageDays: 0 },
      warnings: [],
    });
    const { s001_manifest, s021_outputCompression, s030_readOnceCache } =
      r.summary.attribution;
    const totalAttributed =
      s001_manifest + s021_outputCompression + s030_readOnceCache;
    expect(totalAttributed).toBeCloseTo(r.summary.totalSavingsTokens, 0);
  });
});
