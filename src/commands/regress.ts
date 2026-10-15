/**
 * `sipcode regress`: did Claude Code or Codex get worse after an update?
 * Compares each version with the user's own other versions, from their local
 * logs only. Zero network calls.
 *
 * Thin orchestrator: flags → loadClaudeInput / loadCodexInput (shared
 * loaders) → buildRegressReport → terminal or JSON. Exit codes: 0 ran (with
 * or without findings), 1 bad flag or load error, 2 nothing could be read
 * (never a clean result).
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import { MESSAGES } from "../lib/messages.js";
import { parseAgentFlag } from "../modules/agents/cli.js";
import { discoveryNotes, unreadWarnings } from "../modules/agents/loadSessions.js";
import { getAgentById } from "../modules/agents/registry.js";
import { defaultUsageCaches, type UsageCaches } from "../modules/agents/usageSessions.js";
import { DEFAULT_MIN_N } from "../modules/regress/claude.js";
import { formatRegressJson } from "../modules/regress/format-json.js";
import { formatRegressTerminal } from "../modules/regress/format-terminal.js";
import { accessOf, loadClaudeInput, loadCodexInput, type ClaudeInput, type CodexInput } from "../modules/regress/load.js";
import { buildRegressReport } from "../modules/regress/report.js";

export interface RegressOptions {
  json?: boolean;
  /** Add the GitHub-issue-ready evidence block. */
  bugReport?: boolean;
  /** Minimum requests per version a check needs (default 20). */
  minN?: string;
  agent?: string;
  cwd?: string;
}

export interface RegressDeps {
  fs?: FileSystem;
  clock?: Clock;
  env?: ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  usageCaches?: UsageCaches;
  /** Installed Sipcode version (cli.ts reads package.json), named in the bug report. */
  version?: string;
}

export interface RegressExit {
  readonly exitCode: 0 | 1 | 2;
}

function parseMinN(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_MIN_N;
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= 1 && n <= 1000 ? n : null;
}

export async function runRegress(opts: RegressOptions = {}, deps: RegressDeps = {}): Promise<RegressExit> {
  const fs = deps.fs ?? new RealFileSystem();
  const clock = deps.clock ?? new RealClock();
  const env = deps.env ?? new RealProcessEnv();
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s + "\n"));
  const version = deps.version ?? "unknown";

  const agent = parseAgentFlag(opts.agent);
  if (!agent.ok) {
    stderr(agent.message);
    return { exitCode: 1 };
  }
  if (agent.selector === "cursor") {
    stderr(MESSAGES.regressCursor);
    return { exitCode: 1 };
  }
  const minN = parseMinN(opts.minN);
  if (minN === null) {
    stderr(MESSAGES.regressBadMinN(String(opts.minN)));
    return { exitCode: 1 };
  }

  const agentDeps = { fs, env, clock };
  const cwd = opts.cwd ?? process.cwd();
  const caches = deps.usageCaches ?? defaultUsageCaches(fs, env);
  let claude: ClaudeInput | null = null;
  let codex: CodexInput | null = null;
  if (agent.selector !== "codex") {
    const r = await loadClaudeInput(agentDeps, cwd, caches);
    if (!r.ok) {
      stderr(r.error.map((e) => e.message).join("\n"));
      return { exitCode: 1 };
    }
    claude = r.value;
  }
  if (agent.selector !== "claude-code") {
    const r = await loadCodexInput(agentDeps, cwd, caches);
    if (!r.ok) {
      stderr(r.error.map((e) => e.message).join("\n"));
      return { exitCode: 1 };
    }
    codex = r.value;
    if (codex.malformedReadings > 0) stderr(MESSAGES.limitsMalformed(codex.malformedReadings));
  }

  const report = buildRegressReport({
    minN,
    claudeDir: claude?.dir ?? "",
    codexDir: codex?.dir ?? "",
    claude: claude ? claude.files : null,
    codex: codex ? { readings: codex.readings, requests: codex.requests } : null,
    access: accessOf(claude, codex),
  });
  // Logs left out: warnings at the top of the terminal output; with --json,
  // notes on stderr (the JSON's `access` holds the counts).
  const loaded = [
    ...(claude ? [{ name: getAgentById("claude-code").displayName, counts: claude.counts }] : []),
    ...(codex ? [{ name: getAgentById("codex").displayName, counts: codex.counts }] : []),
  ];
  const fmt = { bugReport: opts.bugReport === true, version };
  if (opts.json) {
    for (const l of loaded) {
      for (const n of discoveryNotes(l.counts)) stderr(loaded.length > 1 ? `${l.name}: ${n}` : n);
    }
    stdout(formatRegressJson(report, fmt));
  } else {
    stdout(formatRegressTerminal(report, { ...fmt, unreadWarnings: loaded.flatMap((l) => unreadWarnings(l.name, l.counts)) }));
  }
  return { exitCode: report.access.nothingRead ? 2 : 0 };
}
