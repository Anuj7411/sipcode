/**
 * regress inputs from disk, through the shared loaders: discovery, cross-file
 * dedupe (a request copied into a resumed or forked file counts once) and the
 * usage cache. Everything that could not be read is counted, never dropped
 * silently: a sandbox that blocks a log folder must not look like a clean
 * result.
 */
import path from "node:path";
import type { SipcodeIssue } from "../../lib/errors.js";
import { err, ok, type Result } from "../../lib/result.js";
import { resolveCodexHome } from "../agents/codex/discover.js";
import type { LimitReading } from "../agents/codex/rateLimits.js";
import { loadSessions, type LoadCounts } from "../agents/loadSessions.js";
import { getAgentById } from "../agents/registry.js";
import type { AgentDeps } from "../agents/types.js";
import type { UsageCaches } from "../agents/usageSessions.js";
import { loadCodexReadings } from "../limits/load.js";
import { resolveProjectsDir } from "../transcript/discover.js";
import type { RegressAccess } from "./report.js";
import { claudeRows, codexRequests, type ClaudeRow, type CodexRequest } from "./rows.js";

export interface ClaudeInput {
  readonly dir: string;
  /** Each session file's rows (claudeRows), discovery order. */
  readonly files: ClaudeRow[][];
  readonly counts: LoadCounts;
  readonly missing: boolean;
}

export interface CodexInput {
  readonly dir: string;
  readonly readings: LimitReading[];
  /** Limit reading lines or windows that could not be read. */
  readonly malformedReadings: number;
  readonly requests: CodexRequest[];
  readonly counts: LoadCounts;
  readonly missing: boolean;
}

export async function loadClaudeInput(
  deps: AgentDeps,
  cwd: string,
  caches: UsageCaches,
): Promise<Result<ClaudeInput, SipcodeIssue[]>> {
  const dir = resolveProjectsDir(deps.env);
  const missing = !(await deps.fs.exists(dir));
  const loaded = await loadSessions({
    agent: getAgentById("claude-code"),
    deps,
    cwd,
    cache: caches("claude-code"),
    needsToolCalls: () => false,
    analyze: claudeRows,
  });
  if (!loaded.ok) return err(loaded.error);
  return ok({ dir, files: loaded.value.sessions.map((s) => s.value), counts: loaded.value, missing });
}

export async function loadCodexInput(
  deps: AgentDeps,
  cwd: string,
  caches: UsageCaches,
): Promise<Result<CodexInput, SipcodeIssue[]>> {
  const dir = resolveCodexHome(deps.env);
  const missing =
    !(await deps.fs.exists(path.join(dir, "sessions"))) && !(await deps.fs.exists(path.join(dir, "archived_sessions")));
  const scan = await loadCodexReadings(deps);
  const loaded = await loadSessions({
    agent: getAgentById("codex"),
    deps,
    cwd,
    cache: caches("codex"),
    needsToolCalls: () => false,
    analyze: codexRequests,
  });
  if (!loaded.ok) return err(loaded.error);
  const requests: CodexRequest[] = [];
  for (const s of loaded.value.sessions) for (const r of s.value) requests.push(r);
  return ok({
    dir,
    readings: scan.readings,
    malformedReadings: scan.malformed,
    requests,
    counts: loaded.value,
    missing,
  });
}

/** What the report says could not be read, across the agents loaded. */
export function accessOf(claude: ClaudeInput | null, codex: CodexInput | null): RegressAccess {
  const missingDirs: string[] = [];
  if (claude?.missing) missingDirs.push(claude.dir);
  if (codex?.missing) missingDirs.push(path.join(codex.dir, "sessions"));
  const counts = [claude?.counts, codex?.counts].filter((c): c is LoadCounts => c !== undefined);
  return {
    missingDirs,
    unreadableFiles: counts.reduce((n, c) => n + c.unreadable + c.issues.length, 0),
    unreadableFolders: counts.reduce((n, c) => n + c.unreadableFolders, 0),
    skippedCompressed: counts.reduce((n, c) => n + c.skippedCompressed, 0),
  };
}
