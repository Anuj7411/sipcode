/**
 * Lightweight `benchmark --vs-rtk` estimator.
 *
 * The benchmark corpus is a set of static transcript fixtures, not a live
 * command runner — so we cannot literally run each task "with the proxy on vs
 * off". Instead we replay the proxy's pure rewriters over the tool calls
 * recorded in each task's baseline transcript and tally how many the proxy
 * would have rewritten, plus the heuristic tokens it would have saved.
 *
 * This is a preview, not a measurement (no tool is re-executed). The numbers
 * use each rewriter's declared `savedTokensEstimate`; for verified savings the
 * user runs the full `sipcode benchmark`.
 */
import { resolveRewriter } from "./registry.js";

export interface ProxyEstimate {
  /** Tool calls seen. */
  readonly toolCalls: number;
  /** Tool calls the proxy would have rewritten. */
  readonly rewrites: number;
  /** Heuristic tokens the proxy would have saved. */
  readonly estSavedTokens: number;
}

export interface VsRtkRow {
  readonly taskId: string;
  readonly title: string;
  readonly estimate: ProxyEstimate;
}

/**
 * Per-re-read estimated tokens. Conservative: a typical source file in the
 * corpus is ~6-15 KB → ~1500-3750 tokens. We credit 2000 per dedup. Matches
 * the savedTokensEstimate floor used by other rewriters so the preview stays
 * internally consistent.
 */
const DEDUP_TOKENS_PER_REREAD = 2000;

/** Replay the rewriter registry over a transcript's tool calls. Pure.
 *
 * Also counts B5 dedup credit: when the same `Read(file_path)` appears twice
 * or more in the same transcript, each subsequent re-read counts as a
 * dedup-saved 2000 tokens. The heuristic without this was undercounting the
 * proxy's biggest single feature (B5, shipped v1.6.6).
 */
export function estimateProxyOverToolCalls(
  calls: ReadonlyArray<{ readonly name: string; readonly input: unknown }>,
): ProxyEstimate {
  let toolCalls = 0;
  let rewrites = 0;
  let estSavedTokens = 0;
  const seenReadFiles = new Set<string>();
  for (const c of calls) {
    toolCalls++;
    // B5 dedup credit (pure detection: file_path seen before in this transcript).
    if (c.name === "Read" && typeof c.input === "object" && c.input !== null) {
      const fp = (c.input as { file_path?: unknown }).file_path;
      if (typeof fp === "string" && fp.length > 0) {
        if (seenReadFiles.has(fp)) {
          rewrites++;
          estSavedTokens += DEDUP_TOKENS_PER_REREAD;
        } else {
          seenReadFiles.add(fp);
        }
        continue;
      }
    }
    const fn = resolveRewriter(c.name);
    if (!fn) continue;
    if (typeof c.input !== "object" || c.input === null) continue;
    const r = fn(c.input as Record<string, unknown>);
    if (r) {
      rewrites++;
      estSavedTokens += r.savedTokensEstimate;
    }
  }
  return { toolCalls, rewrites, estSavedTokens };
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** Render the side-by-side without-proxy / with-proxy preview table. Pure. */
export function renderVsRtkTable(rows: ReadonlyArray<VsRtkRow>): string {
  const lines: string[] = [];
  lines.push("sipcode proxy — vs-RTK preview (heuristic; replays rewriters over corpus tool calls)");
  lines.push("");
  lines.push(
    `  ${"task".padEnd(8)} ${"calls".padStart(6)} ${"rewrites".padStart(9)} ${"~saved".padStart(10)}  title`,
  );
  let totalCalls = 0;
  let totalRewrites = 0;
  let totalSaved = 0;
  for (const r of rows) {
    totalCalls += r.estimate.toolCalls;
    totalRewrites += r.estimate.rewrites;
    totalSaved += r.estimate.estSavedTokens;
    lines.push(
      `  ${r.taskId.padEnd(8)} ${String(r.estimate.toolCalls).padStart(6)} ` +
        `${String(r.estimate.rewrites).padStart(9)} ${("~" + fmt(r.estimate.estSavedTokens)).padStart(10)}  ${r.title}`,
    );
  }
  lines.push("");
  lines.push(
    `  ${"TOTAL".padEnd(8)} ${String(totalCalls).padStart(6)} ${String(totalRewrites).padStart(9)} ${("~" + fmt(totalSaved)).padStart(10)}`,
  );
  lines.push("");
  lines.push("  without proxy: 0 rewrites. with proxy: the above would fire automatically.");
  lines.push("  Heuristic preview — run `sipcode benchmark` for measured savings.");
  return lines.join("\n");
}
