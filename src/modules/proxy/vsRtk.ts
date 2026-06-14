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
import { normalizeFilePath } from "../../lib/path-normalize.js";

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
 * corpus is ~6-15 KB → ~1500-3750 tokens. We credit 2000 per dedup.
 */
const DEDUP_TOKENS_PER_REREAD = 2000;

/**
 * Per-AST-trim estimated tokens. A first read of a TS/JS/Python file that
 * comes AFTER a Grep is the textbook B3 scenario: AST extracts the symbol
 * matching the grep pattern, returns just that symbol's line range + buffer.
 * Conservative: typical file is ~3-8 KB, symbol slice ~500-1500 tokens kept,
 * so saving ~2500-3500 tokens. We credit 3000.
 */
const AST_TRIM_TOKENS_PER_HIT = 3000;

/** File extensions where AST trim can fire. */
const AST_ELIGIBLE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|pyi?)$/i;

/** Replay the rewriter registry over a transcript's tool calls. Pure.
 *
 * Credits three classes of savings:
 *   - Registry rewriters (git/npm/grep/cat/etc.) — actual savedTokensEstimate
 *   - B5 dedup (re-read of same file_path) — DEDUP_TOKENS_PER_REREAD
 *   - B3 AST trim (first read of an AST-eligible file after any prior Grep) —
 *     AST_TRIM_TOKENS_PER_HIT
 *
 * The B3 credit is conservative: we only count a Read as AST-eligible if
 * (a) it's the FIRST read of that file (so we don't double-count with dedup),
 * (b) the file extension is TS/JS/Python, and (c) any Grep has fired earlier
 * in the same transcript (the signal cache would have a pattern to match).
 * We do NOT verify that the grep pattern actually matches a symbol in the
 * file — that requires reading the file, which violates the pure-walker
 * contract this function maintains. The result is a credible upper bound,
 * not a measured number, which is the contract `--vs-rtk` advertises.
 */
export function estimateProxyOverToolCalls(
  calls: ReadonlyArray<{ readonly name: string; readonly input: unknown }>,
): ProxyEstimate {
  let toolCalls = 0;
  let rewrites = 0;
  let estSavedTokens = 0;
  const seenReadFiles = new Set<string>();
  let anyGrepSeen = false;

  for (const c of calls) {
    toolCalls++;

    // Track grep activity for B3 credit eligibility.
    if (c.name === "Grep" && typeof c.input === "object" && c.input !== null) {
      const pat = (c.input as { pattern?: unknown }).pattern;
      if (typeof pat === "string" && pat.length > 0) anyGrepSeen = true;
    } else if (c.name === "Bash" && typeof c.input === "object" && c.input !== null) {
      const cmd = (c.input as { command?: unknown }).command;
      if (typeof cmd === "string" && /^\s*(?:grep|rg|ag)\b/.test(cmd)) {
        anyGrepSeen = true;
      }
    }

    // Read tool: track first-read for B3 credit, re-reads for B5 credit.
    if (c.name === "Read" && typeof c.input === "object" && c.input !== null) {
      const fp = (c.input as { file_path?: unknown }).file_path;
      if (typeof fp === "string" && fp.length > 0) {
        // v1.6.14 bug fix: normalize before keying. Pre-fix the heuristic
        // walker would treat `C:\foo` and `c:/foo` as different files and
        // undercount dupes — same bug as hookReadDedup had.
        const fpNorm = normalizeFilePath(fp);
        if (seenReadFiles.has(fpNorm)) {
          rewrites++;
          estSavedTokens += DEDUP_TOKENS_PER_REREAD;
        } else {
          seenReadFiles.add(fpNorm);
          // B3 AST trim credit (first read of an AST-eligible file post-grep).
          if (anyGrepSeen && AST_ELIGIBLE_RE.test(fp)) {
            rewrites++;
            estSavedTokens += AST_TRIM_TOKENS_PER_HIT;
          }
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
