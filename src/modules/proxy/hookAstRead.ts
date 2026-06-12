/**
 * Hook-side orchestrator for B3 AST-aware symbol reads.
 *
 * For TS/JS Read calls without offset/limit:
 *   1. Read the file
 *   2. Extract top-level symbols via tree-sitter
 *   3. Load the per-session signal cache
 *   4. Score each symbol against recent grep patterns
 *   5. If any symbol's confidence ≥ threshold AND the file is large enough
 *      to bother trimming, inject offset/limit to read just the picked
 *      symbol(s) plus a small surrounding buffer
 *   6. Otherwise, pass through the full file (Claude reads as normal)
 *
 * Safety: when ANY of (file too small, no signals, no confident match,
 * parser error) holds, we pass through. The cost of a missed trim is just
 * "tokens we could have saved." The cost of a wrong trim is "Claude can't
 * see the line it needed" — which is far worse. Bias hard toward pass-through.
 *
 * Lives outside `rewriters/` so the rewriter-purity guard doesn't apply.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  extractTsSymbols,
  isTsLikeFile,
  type ExtractedSymbol,
} from "./ast/ts-symbols.js";
import { extractPySymbols, isPyFile } from "./ast/py-symbols.js";
import {
  scoreSymbols,
  pickRelevantSymbols,
  DEFAULT_CONFIDENCE_THRESHOLD,
} from "./ast/relevance.js";
import {
  loadSignals,
  appendSignal,
  sessionSignalsPath,
  deriveSignalFromInput,
  realStoreIO,
  type StoreIO,
} from "./signal-cache.js";
import type {
  PreToolUseInput,
  HookSpecificOutput,
  ProxyStatsEntry,
} from "./types.js";

export interface HookAstReadResult {
  readonly hookOutput: HookSpecificOutput | null;
  readonly statsEntry: ProxyStatsEntry | null;
}

const EMPTY: HookAstReadResult = { hookOutput: null, statsEntry: null };

/**
 * Files smaller than this (in lines) aren't worth trimming. We'd save at most
 * MIN_LINES_TO_TRIM tokens; not worth the overhead of injecting a slice
 * + risk of missing context.
 */
export const MIN_LINES_TO_TRIM = 200;

/** Lines of context around each picked symbol. */
export const CONTEXT_LINES = 5;

export interface AstIO extends StoreIO {
  readFile(p: string): Promise<string | null>;
  now(): Date;
}

export const realAstIO: AstIO = {
  ...realStoreIO,
  async readFile(p) {
    try {
      return await fs.readFile(p, "utf-8");
    } catch {
      return null;
    }
  },
  now() {
    return new Date();
  },
};

/**
 * Side-effect: record a signal derived from this tool call (Grep/Glob/Bash).
 * Fire-and-forget; failures don't block anything. Use this for every tool
 * call routed by the hook script.
 */
export async function recordSignal(
  input: PreToolUseInput,
  homeDir: string,
  io: AstIO = realAstIO,
): Promise<void> {
  try {
    if (!input.session_id) return;
    const signal = deriveSignalFromInput(
      input.tool_name,
      input.tool_input,
      io.now().getTime(),
    );
    if (!signal) return;
    const p = sessionSignalsPath(homeDir, input.session_id);
    await appendSignal(p, signal, io);
  } catch {
    // never throw from a signal-write
  }
}

export async function hookAstRead(
  input: PreToolUseInput,
  homeDir: string,
  io: AstIO = realAstIO,
): Promise<HookAstReadResult> {
  try {
    if (input.tool_name !== "Read") return EMPTY;
    const filePath = input.tool_input.file_path;
    if (typeof filePath !== "string" || filePath.length === 0) return EMPTY;
    // Supported: TS/JS family and Python.
    const ext: "ts" | "py" | null = isTsLikeFile(filePath)
      ? "ts"
      : isPyFile(filePath)
        ? "py"
        : null;
    if (ext === null) return EMPTY;
    // Bail if the model asked for a slice — they have intent, don't override.
    if (input.tool_input.offset !== undefined || input.tool_input.limit !== undefined) {
      return EMPTY;
    }
    if (!input.session_id) return EMPTY;

    const content = await io.readFile(filePath);
    if (content === null) return EMPTY;
    const lineCount = countLines(content);
    if (lineCount < MIN_LINES_TO_TRIM) return EMPTY;

    const symbols: ExtractedSymbol[] =
      ext === "py" ? extractPySymbols(filePath, content) : extractTsSymbols(filePath, content);
    if (symbols.length === 0) return EMPTY; // parser failed or empty

    const signalsPath = sessionSignalsPath(homeDir, input.session_id);
    const signals = await loadSignals(signalsPath, io);
    if (signals.length === 0) return EMPTY; // no signal to trim by

    const scored = scoreSymbols(symbols, signals);
    const picked = pickRelevantSymbols(scored, DEFAULT_CONFIDENCE_THRESHOLD);
    if (picked.length === 0) return EMPTY;

    const slice = computeSlice(picked, lineCount);
    // If our slice ends up covering ~the whole file, there's no point.
    if (slice.limit >= Math.floor(lineCount * 0.8)) return EMPTY;

    const savedTokensEstimate = estimateSavedTokens(lineCount, slice.limit);
    const note =
      `ast-trim: returning lines ${slice.offset + 1}-${slice.offset + slice.limit} ` +
      `(symbols ${picked.map((p) => p.symbol.name).join(", ")}; ` +
      `confidence ${picked[0]!.confidence.toFixed(2)})`;

    return {
      hookOutput: {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: {
            ...input.tool_input,
            offset: slice.offset,
            limit: slice.limit,
          },
        },
      },
      statsEntry: {
        timestamp: io.now().toISOString(),
        toolName: "Read",
        rewriterName: "ast-read",
        savedTokensEstimate,
        integrityScore: 0.7, // we kept the symbol(s) Claude searched for; bias to conservative
      },
    };
  } catch {
    return EMPTY;
  }
}

function countLines(s: string): number {
  let n = 1;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 10 /* \n */) n++;
  }
  return n;
}

interface Slice {
  /** 0-indexed start line for Claude Code's Read tool. */
  readonly offset: number;
  /** Number of lines to read. */
  readonly limit: number;
}

/** Pick a window covering the picked symbols + CONTEXT_LINES on each side. */
function computeSlice(
  picked: ReadonlyArray<{ readonly symbol: { startLine: number; endLine: number } }>,
  totalLines: number,
): Slice {
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const p of picked) {
    if (p.symbol.startLine < minStart) minStart = p.symbol.startLine;
    if (p.symbol.endLine > maxEnd) maxEnd = p.symbol.endLine;
  }
  const start = Math.max(1, minStart - CONTEXT_LINES);
  const end = Math.min(totalLines, maxEnd + CONTEXT_LINES);
  return {
    offset: start - 1, // Claude Code's offset is 0-indexed
    limit: end - start + 1,
  };
}

/** Heuristic: ~4 chars/line average, ~4 chars/token. Treat 1 line ≈ 12 tokens. */
function estimateSavedTokens(totalLines: number, keptLines: number): number {
  const droppedLines = Math.max(0, totalLines - keptLines);
  return droppedLines * 12;
}
