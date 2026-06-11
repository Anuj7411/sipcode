import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeStats, readReport } from "../../../src/modules/proxy/stats-store.js";
import type { ProxyStatsEntry } from "../../../src/modules/proxy/types.js";

function entry(rewriterName: string, saved: number): ProxyStatsEntry {
  return {
    timestamp: "2026-06-04T00:00:00.000Z",
    toolName: "Bash",
    rewriterName,
    savedTokensEstimate: saved,
  };
}

describe("stats-store", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sipcode-proxy-stats-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writeStats creates a per-invocation proxy-stats-*.jsonl file", async () => {
    await writeStats(dir, entry("git-status", 800));
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^proxy-stats-\d+-\d+-\d+\.jsonl$/);
  });

  it("readReport aggregates across multiple files + per rewriter", async () => {
    await writeStats(dir, entry("git-status", 800));
    await writeStats(dir, entry("git-status", 800));
    await writeStats(dir, entry("npm-ls", 5000));
    const report = await readReport(dir);
    expect(report.totalInvocations).toBe(3);
    expect(report.estimatedSavedTokens).toBe(6600);
    expect(report.perRewriter["git-status"]).toEqual({
      invocations: 2,
      estimatedSavedTokens: 1600,
    });
    expect(report.perRewriter["npm-ls"]).toEqual({
      invocations: 1,
      estimatedSavedTokens: 5000,
    });
    expect(report.schemaVersion).toBe("sipcode-proxy/2");
  });

  it("skips malformed lines instead of crashing", async () => {
    await writeFile(
      join(dir, "proxy-stats-1-1.jsonl"),
      '{"timestamp":"t","toolName":"Bash","rewriterName":"ls","savedTokensEstimate":10}\nNOT JSON\n',
      "utf-8",
    );
    const report = await readReport(dir);
    expect(report.totalInvocations).toBe(1);
    expect(report.estimatedSavedTokens).toBe(10);
  });

  it("returns an empty report when the dir does not exist", async () => {
    const report = await readReport(join(dir, "nope"));
    expect(report.totalInvocations).toBe(0);
    expect(report.estimatedSavedTokens).toBe(0);
    expect(report.perRewriter).toEqual({});
  });
});

describe("stats-store — B4 integrity aggregation", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sipcode-b4-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("computes per-rewriter avgIntegrityScore from invocations that include it", async () => {
    await writeStats(dir, {
      timestamp: "t",
      toolName: "Bash",
      rewriterName: "git-log",
      savedTokensEstimate: 3000,
      integrityScore: 0.3,
    });
    await writeStats(dir, {
      timestamp: "t",
      toolName: "Bash",
      rewriterName: "git-log",
      savedTokensEstimate: 3000,
      integrityScore: 0.5,
    });
    const report = await readReport(dir);
    expect(report.perRewriter["git-log"]?.avgIntegrityScore).toBeCloseTo(0.4, 5);
  });

  it("computes weightedAvgIntegrityScore across all rewriters by invocation count", async () => {
    // 1 invocation of dedup-read at 0.95, 3 of git-log at 0.3
    await writeStats(dir, {
      timestamp: "t",
      toolName: "Read",
      rewriterName: "dedup-read",
      savedTokensEstimate: 2000,
      integrityScore: 0.95,
    });
    for (let i = 0; i < 3; i++) {
      await writeStats(dir, {
        timestamp: "t",
        toolName: "Bash",
        rewriterName: "git-log",
        savedTokensEstimate: 3000,
        integrityScore: 0.3,
      });
    }
    const report = await readReport(dir);
    // Weighted: (0.95 * 1 + 0.3 * 3) / 4 = 0.4625
    expect(report.weightedAvgIntegrityScore).toBeCloseTo(0.4625, 4);
  });

  it("omits integrity fields entirely when no entry includes a score (v1.6.7-and-older backward compat)", async () => {
    await writeStats(dir, {
      timestamp: "t",
      toolName: "Bash",
      rewriterName: "git-log",
      savedTokensEstimate: 3000,
    });
    const report = await readReport(dir);
    expect(report.weightedAvgIntegrityScore).toBeUndefined();
    expect(report.perRewriter["git-log"]?.avgIntegrityScore).toBeUndefined();
  });

  it("handles a mix of scored and un-scored entries for the same rewriter (avg over scored only)", async () => {
    // 2 scored at 0.6, 1 un-scored — avg = 0.6
    for (let i = 0; i < 2; i++) {
      await writeStats(dir, {
        timestamp: "t",
        toolName: "Bash",
        rewriterName: "ls",
        savedTokensEstimate: 100,
        integrityScore: 0.6,
      });
    }
    await writeStats(dir, {
      timestamp: "t",
      toolName: "Bash",
      rewriterName: "ls",
      savedTokensEstimate: 100,
    });
    const report = await readReport(dir);
    expect(report.perRewriter["ls"]?.invocations).toBe(3);
    expect(report.perRewriter["ls"]?.avgIntegrityScore).toBeCloseTo(0.6, 5);
  });
});
