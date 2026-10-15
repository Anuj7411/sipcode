/**
 * The `sipcode regress` report: both agents' checks and what could not be
 * read. Pure.
 *
 * "Nothing read" (exit code 2) = no interactive Claude Code request and no
 * Codex request was read, from the agents asked for. It is never reported as
 * a clean result: a sandbox that blocks the log folders looks exactly like it.
 */
import type { LimitReading } from "../agents/codex/rateLimits.js";
import { detectClaude, type ClaudeResult } from "./claude.js";
import { detectCodex, type CodexResult } from "./codex.js";
import type { ClaudeRow, CodexRequest } from "./rows.js";
import type { Finding } from "./types.js";

export type RegressAgent = "claude-code" | "codex";

export interface RegressAccess {
  /** Log folders that do not exist (or that a sandbox hides). */
  readonly missingDirs: readonly string[];
  /** Log files that could not be read or parsed. */
  readonly unreadableFiles: number;
  /** Log folders that could not be listed. */
  readonly unreadableFolders: number;
  /** Compressed Codex logs (.jsonl.zst) skipped: this Node.js has no zstd. */
  readonly skippedCompressed: number;
}

export interface RegressReport {
  readonly agents: readonly RegressAgent[];
  readonly minN: number;
  /** Claude Code's projects folder and Codex's home folder, as read. */
  readonly claudeDir: string;
  readonly codexDir: string;
  /** null when the agent was not asked for. */
  readonly claude: ClaudeResult | null;
  readonly codex: CodexResult | null;
  readonly access: RegressAccess & { readonly nothingRead: boolean };
  /** Claude Code findings, then Codex findings. */
  readonly findings: readonly Finding[];
  /** At least one check had versions to compare. */
  readonly comparable: boolean;
}

/**
 * Tools that were asked for and read (an interactive Claude Code request, or a
 * Codex request) but had no versions to compare. When the other tool was
 * compared, or a finding was reported, these are still named: no finding for
 * them is not a clean result.
 */
export function notCompared(report: RegressReport): RegressAgent[] {
  const out: RegressAgent[] = [];
  if (report.claude && report.claude.coverage.requests > 0 && !report.claude.comparable) out.push("claude-code");
  if (report.codex && report.codex.coverage.requests > 0 && !report.codex.comparable) out.push("codex");
  return out;
}

export interface BuildRegressInput {
  readonly minN: number;
  readonly claudeDir: string;
  readonly codexDir: string;
  /** Each Claude Code session file's rows; null when Claude Code was not asked for. */
  readonly claude: readonly (readonly ClaudeRow[])[] | null;
  readonly codex: { readonly readings: readonly LimitReading[]; readonly requests: readonly CodexRequest[] } | null;
  readonly access: RegressAccess;
}

export function buildRegressReport(input: BuildRegressInput): RegressReport {
  const claude = input.claude ? detectClaude(input.claude, input.minN) : null;
  const codex = input.codex ? detectCodex(input.codex.readings, input.codex.requests) : null;
  const agents: RegressAgent[] = [];
  if (claude) agents.push("claude-code");
  if (codex) agents.push("codex");
  const nothingRead = (claude?.coverage.requests ?? 0) === 0 && (codex?.coverage.requests ?? 0) === 0;
  return {
    agents,
    minN: input.minN,
    claudeDir: input.claudeDir,
    codexDir: input.codexDir,
    claude,
    codex,
    access: { ...input.access, nothingRead },
    findings: [...(claude?.findings ?? []), ...(codex?.findings ?? [])],
    comparable: (claude?.comparable ?? false) || (codex?.comparable ?? false),
  };
}
