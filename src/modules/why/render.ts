/**
 * Renderer: pure analyzer results → RenderedReport.
 * No I/O, no colors — that's format-terminal.ts.
 */
import type { ParsedSession } from "../transcript/parse.js";
import { formatNum } from "../../lib/format.js";
import type { TokenTotals } from "../transcript/analyzers/tokens.js";
import type { DuplicateReadsResult } from "../transcript/analyzers/duplicateReads.js";
import type { IdleContextResult } from "../transcript/analyzers/idleContext.js";
import type { ExpensiveCall } from "../transcript/analyzers/topExpensive.js";
import type { CounterfactualSavings } from "../transcript/analyzers/counterfactual.js";
import type { SipcodeIssue } from "../../lib/errors.js";

export interface RenderedReport {
  readonly schemaVersion: "sipcode-why/1";
  readonly header: {
    readonly sessionIdShort: string;
    readonly model: string;
    readonly durationHuman: string;
    readonly projectHash: string | undefined;
  };
  readonly punchline: {
    readonly totalTokens: number;
    readonly outputTokens: number;
    readonly nonOutputTokens: number;
    readonly outputRatioPct: number; // e.g. 0.6
    readonly oneLiner: string;
  };
  readonly estimatedSavings: {
    readonly totalTokens: number;
    readonly totalUSD: number;
    readonly breakdown: {
      readonly s001_manifest: number;
      readonly s030_readOnce: number;
      readonly s021_diffOutput: number;
    };
  };
  readonly topLeaks: ReadonlyArray<{
    readonly rank: number;
    readonly title: string;
    readonly tokens: number;
    readonly detail: string;
  }>;
  readonly totals: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheCreationTokens: number;
    readonly estCostUSD: number;
    readonly toolCallCount: number;
    readonly distinctFilesRead: number;
  };
  readonly topExpensive: ReadonlyArray<{
    readonly toolName: string;
    readonly reason: ExpensiveCall["reason"];
    readonly tokens: number;
    readonly label: string;
  }>;
  readonly duplicates: ReadonlyArray<{
    readonly filePath: string;
    readonly reads: number;
    readonly wastedTokens: number;
  }>;
  readonly idle: ReadonlyArray<{
    readonly filePath: string;
    readonly idleTurns: number;
    readonly wastedTokens: number;
  }>;
  readonly warnings: ReadonlyArray<{ readonly code: string; readonly message: string }>;
  readonly metaPricing: { readonly asOf: string; readonly ageDays: number };
  readonly nextStep: string;
}

interface RenderInput {
  readonly session: ParsedSession;
  readonly totals: TokenTotals;
  readonly duplicates: DuplicateReadsResult;
  readonly idle: IdleContextResult;
  readonly topExpensive: ReadonlyArray<ExpensiveCall>;
  readonly counterfactual: CounterfactualSavings;
  readonly issues: ReadonlyArray<SipcodeIssue>;
  readonly projectHash: string | undefined;
  readonly pricingMeta: { asOf: string; ageDays: number };
}

function humanDuration(sec: number): string {
  if (sec <= 0) return "0s";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function shortId(id: string | undefined): string {
  if (!id) return "unknown";
  return id.slice(0, 8);
}

function pct(n: number): number {
  return Math.round(n * 1000) / 10; // one decimal
}

export function renderReport(input: RenderInput): RenderedReport {
  const { session, totals, duplicates, idle, topExpensive, counterfactual } =
    input;

  const total =
    totals.inputTokens +
    totals.outputTokens +
    totals.cacheReadTokens +
    totals.cacheCreationTokens;
  const nonOutput = total - totals.outputTokens;
  const ratioPct = pct(totals.outputRatio);

  // Build top-3 leaks ranked by token cost.
  const leakCandidates = [
    {
      title: "duplicate file reads",
      tokens: duplicates.duplicateReadTokenCost,
      detail:
        duplicates.topOffenders.length > 0
          ? `${duplicates.topOffenders.length} files read more than once`
          : "no duplicates",
    },
    {
      title: "idle context",
      tokens: idle.idleTokenCost,
      detail:
        idle.idleFiles.length > 0
          ? `${idle.idleFiles.length} file(s) held without re-reference`
          : "no idle files",
    },
    {
      title: "cache-creation overhead",
      tokens: totals.cacheCreationTokens,
      detail: "context written into cache",
    },
    {
      title: "input tokens (system + prompts)",
      tokens: totals.inputTokens,
      detail: "rehydrated each turn",
    },
  ]
    .filter((l) => l.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 3)
    .map((l, i) => ({ rank: i + 1, ...l }));

  // Counterfactual cost — estimate roughly by re-applying the input/cache rate.
  const totalUSDApprox =
    totals.estCostUSD * (total > 0 ? counterfactual.total / total : 0);

  const oneLiner =
    `you burned ${formatNum(total)} tokens. ${formatNum(totals.outputTokens)} were code output. ` +
    `the other ${formatNum(nonOutput)} were exploration, re-reads, and idle context.`;

  return {
    schemaVersion: "sipcode-why/1",
    header: {
      sessionIdShort: shortId(session.sessionId),
      model: session.primaryModel ?? "(unknown)",
      durationHuman: humanDuration(session.durationSec),
      projectHash: input.projectHash,
    },
    punchline: {
      totalTokens: total,
      outputTokens: totals.outputTokens,
      nonOutputTokens: nonOutput,
      outputRatioPct: ratioPct,
      oneLiner,
    },
    estimatedSavings: {
      totalTokens: counterfactual.total,
      totalUSD: Math.max(0, totalUSDApprox),
      breakdown: {
        s001_manifest: counterfactual.s001_manifest,
        s030_readOnce: counterfactual.s030_readOnce,
        s021_diffOutput: counterfactual.s021_diffOutput,
      },
    },
    topLeaks: leakCandidates,
    totals: {
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheCreationTokens: totals.cacheCreationTokens,
      estCostUSD: totals.estCostUSD,
      toolCallCount: totals.toolCallCount,
      distinctFilesRead: duplicates.distinctFilesRead,
    },
    topExpensive: topExpensive.map((c) => ({
      toolName: c.toolName,
      reason: c.reason,
      tokens: c.attributedTokens,
      label: c.label,
    })),
    duplicates: duplicates.topOffenders.slice(0, 5).map((d) => ({
      filePath: d.filePath,
      reads: d.readCount,
      wastedTokens: d.duplicateTokenCost,
    })),
    idle: idle.idleFiles.slice(0, 5).map((f) => ({
      filePath: f.filePath,
      idleTurns: f.idleTurns,
      wastedTokens: f.idleTokenCost,
    })),
    warnings: input.issues.map((i) => ({ code: i.code, message: i.message })),
    metaPricing: input.pricingMeta,
    nextStep: "run `npx sipcode init` to start saving on your next session.",
  };
}
