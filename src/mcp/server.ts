#!/usr/bin/env node
/**
 * Sipcode MCP server.
 *
 * Exposes Sipcode's offline analytics as tools the Claude desktop app
 * (and any other MCP-capable client) can call during a conversation.
 *
 * Wired up via the user's `claude_desktop_config.json`:
 *
 *   {
 *     "mcpServers": {
 *       "sipcode": {
 *         "command": "npx",
 *         "args": ["-y", "sipcode-mcp"]
 *       }
 *     }
 *   }
 *
 * Tools exposed:
 *   - audit_latest_session      → wraps `sipcode why` (forensic spend audit)
 *   - list_recent_sessions      → wraps `sipcode why --list`
 *   - get_project_manifest      → wraps `sipcode manifest` (generates on demand)
 *   - estimate_task_cost        → wraps `sipcode estimate "<task>"`
 *
 * Privacy contract: this server runs entirely on the user's machine. It
 * reads the same local files the CLI reads (~/.claude/projects/*.jsonl,
 * the cwd's source files, the pricing data shipped with Sipcode). It
 * makes zero network calls itself. The privacy guard test
 * (tests/privacy/no-network.test.ts) covers this file too.
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
import { withTimeout, ToolTimeoutError } from "../lib/timeout.js";
void ASSERT_NO_NETWORK;

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { z } from "zod";

import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import { RealGit } from "../lib/git.js";
import { isUnpricedNote, MESSAGES } from "../lib/messages.js";
import { shortSessionId } from "../lib/session-id.js";
import { resolveProjectsDir } from "../modules/transcript/discover.js";
import { isOtherAgentNote, resolveDisplayAgents } from "../modules/agents/multi.js";
import { listAgentSessions } from "../modules/agents/latest.js";
import { discoverAgentSessions } from "../modules/agents/loadSessions.js";
import type { DriftDeps } from "../commands/drift.js";

import { runEstimate } from "../commands/estimate.js";

// ---- Server metadata ----

import { readFileSync as _readFileSync } from "node:fs";
import {
  fileURLToPath as _fileURLToPath,
  pathToFileURL as _pathToFileURL,
} from "node:url";
import { dirname as _dirname, join as _join } from "node:path";

const SERVER_NAME = "sipcode";
const _serverDir = _dirname(_fileURLToPath(import.meta.url));
const SERVER_VERSION = (JSON.parse(
  _readFileSync(_join(_serverDir, "..", "..", "package.json"), "utf-8"),
) as { version: string }).version;

// ---- Helpers ----

function ok(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function fail(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

/** The `agent` input of the tools that read session logs. */
export type AgentArg = "claude-code" | "codex";

const AGENT_IDS = ["claude-code", "codex"] as const;

const AGENT_INPUT = {
  type: "string",
  enum: AGENT_IDS,
  description: "Which coding agent's logs to read. Default: Claude Code if installed, else Codex.",
} as const;

/**
 * Sent as a second text item, after the unchanged result, when the default
 * (Claude Code) was used and Codex has logs too. The first item stays the
 * exact JSON / text it always was, so clients that parse it keep working.
 */
const OTHER_AGENT_HINT =
  'Codex logs found too. This result covers Claude Code; call again with agent: "codex" for Codex.';

/**
 * Seams for tests. Every field defaults to the real thing; the server itself
 * never passes any.
 */
export interface McpToolDeps {
  readonly fs?: FileSystem;
  readonly env?: ProcessEnv;
  readonly clock?: Clock;
  /** The folder commands treat as current. Default: process.cwd(). */
  readonly cwd?: string;
  /** Drift's cache folder and config readers. */
  readonly drift?: Pick<DriftDeps, "now" | "homeDir" | "stateDir" | "storeIO" | "configPaths" | "configReader">;
}

function resolveDeps(deps: McpToolDeps): { fs: FileSystem; env: ProcessEnv; clock: Clock; cwd: string } {
  return {
    fs: deps.fs ?? new RealFileSystem(),
    env: deps.env ?? new RealProcessEnv(),
    clock: deps.clock ?? new RealClock(),
    cwd: deps.cwd ?? process.cwd(),
  };
}

/** A command's stdout and stderr, kept instead of printed (stdout is the MCP transport). */
class Captured {
  readonly out: string[] = [];
  readonly err: string[] = [];
  readonly stdout = (s: string): void => {
    this.out.push(s);
  };
  readonly stderr = (s: string): void => {
    this.err.push(s);
  };
  /** The CLI's "Codex logs found too" note was printed. */
  get otherAgent(): boolean {
    return this.err.some(isOtherAgentNote);
  }
  /** The unpriced-tokens note the command printed on stderr (--json has no field for it). */
  get unpriced(): string[] {
    return this.err.filter(isUnpricedNote);
  }
  /** stderr without those notes. */
  get errors(): string {
    return this.err.filter((l) => !isOtherAgentNote(l) && !isUnpricedNote(l)).join("\n").trim();
  }
}

/**
 * Adds, each as its own text item after the result, the unpriced-tokens note
 * (the cost leaves those tokens out) and the other-tool hint when the
 * command left Codex out. Never inside the JSON item.
 */
function withHint(result: CallToolResult, c: Captured): CallToolResult {
  if (result.isError) return result;
  const extra = [...c.unpriced, ...(c.otherAgent ? [OTHER_AGENT_HINT] : [])];
  if (extra.length === 0) return result;
  return { ...result, content: [...result.content, ...extra.map((text) => ({ type: "text" as const, text }))] };
}

/**
 * A command run with --json as a tool result: stdout on success (stderr notes
 * dropped), stderr on failure. The CLI's other-tool note never reaches the text.
 */
function commandResult(exitCode: number, c: Captured, failMessage: string): CallToolResult {
  if (exitCode !== 0) return fail(c.errors || c.out.join("\n").trim() || failMessage);
  return withHint(ok(c.out.join("\n")), c);
}

// ---- Tool implementations ----

export async function toolVerifySipcodeImpact(
  opts: { cwd?: string; since?: string; agent?: AgentArg },
  deps: McpToolDeps = {},
): Promise<CallToolResult> {
  const { runImpactCommand } = await import("../commands/impact.js");
  const d = resolveDeps(deps);
  const { existsSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");

  // Claude Desktop spawns sipcode-mcp with a cwd that is NOT the user's
  // project directory — typically the Claude install dir or %USERPROFILE%.
  // The default behavior of `process.cwd()` fails to find
  // .sipcode/install-state.json. Walk known locations in order so the
  // tool works without the caller having to know the right path.
  const triedPaths: string[] = [];
  function hasMarker(p: string): boolean {
    triedPaths.push(p);
    return existsSync(join(p, ".sipcode", "install-state.json"));
  }

  let resolvedCwd: string | undefined = opts.cwd;
  if (!resolvedCwd) {
    // 1. process.cwd() — the legacy default; still try it first.
    const here = d.cwd;
    if (hasMarker(here)) {
      resolvedCwd = here;
    } else {
      // 2. Walk ~/.claude/projects/* — these are projects where Claude Code
      //    has run. The project-hash dir name decodes to an absolute path
      //    ("C--Projects-Sipcode" → "C:\Projects\Sipcode"). Pick the first
      //    decoded path that contains an install-state.json. Claude only
      //    sees one MCP server, but it's reasonable to scan all projects.
      const projectsDir = join(d.env.homeDir(), ".claude", "projects");
      if (existsSync(projectsDir)) {
        let entries: string[] = [];
        try {
          entries = readdirSync(projectsDir);
        } catch {
          /* unreadable — skip */
        }
        for (const entry of entries) {
          // Decode hash: dashes → original separators. Windows is special:
          // "C--Projects-Sipcode" → "C:\Projects\Sipcode" (first dash-dash
          // becomes ":\", others become "\").
          const decoded =
            process.platform === "win32"
              ? entry.replace(/^([A-Za-z])--/, "$1:\\").replace(/-/g, "\\")
              : "/" + entry.replace(/-/g, "/");
          if (hasMarker(decoded)) {
            resolvedCwd = decoded;
            break;
          }
        }
      }
    }
  }

  // Fall back to process.cwd() so we still produce a report (with
  // no-install-marker status), but include the tried paths in the
  // output so the user knows what we looked at.
  const finalCwd = resolvedCwd ?? d.cwd;

  const c = new Captured();
  const cmdOpts: { since?: string; json: true; cwd: string; agent?: string } = {
    json: true,
    cwd: finalCwd,
  };
  if (opts.since !== undefined) cmdOpts.since = opts.since;
  if (opts.agent !== undefined) cmdOpts.agent = opts.agent;
  const result = await runImpactCommand(cmdOpts, {
    fs: d.fs,
    env: d.env,
    clock: d.clock,
    stdout: c.stdout,
    stderr: c.stderr,
  });
  if (result.exitCode !== 0) {
    // As before: everything the command printed explains the failure.
    return fail([c.errors, c.out.join("\n")].filter(Boolean).join("\n").trim());
  }
  // Success: only the JSON (stderr notes stay out of it).
  const captured = c.out.join("\n");

  // If we couldn't find a marker even after walking known locations, add
  // a friendly diagnostic so the user understands why and can pass `cwd:`
  // explicitly or use `since:` as a workaround. It is its own text item, so
  // the first item stays plain JSON.
  if (!resolvedCwd && !opts.since) {
    const diagnostic = [
      "Could not auto-locate .sipcode/install-state.json. Tried:",
      ...triedPaths.map((p) => `  • ${p}`),
      "",
      "Workarounds:",
      "  • Pass cwd: \"/absolute/path/to/your/project\" to point at the right directory.",
      "  • Pass since: \"YYYY-MM-DD\" to set the pivot manually (e.g., when you started using Sipcode).",
      "  • Run `sipcode rules --install` in your project to create the marker going forward.",
    ].join("\n");
    const r = withHint(ok(captured.trim()), c);
    return { ...r, content: [...r.content, { type: "text", text: diagnostic }] };
  }

  return withHint(ok(captured.trim()), c);
}

async function toolGetSipcodeInfo(): Promise<CallToolResult> {
  const lines = [
    `Sipcode v${SERVER_VERSION}`,
    `MCP server: ${SERVER_NAME}`,
    `Node: ${process.version}`,
    `Platform: ${process.platform}-${process.arch}`,
    `Tools registered: ${TOOL_DEFS.length}`,
    "",
    "Available tools:",
    ...TOOL_DEFS.map((t) => `  • ${t.name}`),
    "",
    "Update with: npm install -g sipcode@latest",
    "Source: https://github.com/Anuj7411/sipcode",
  ];
  return ok(lines.join("\n"));
}

export async function toolListRecentSessions(
  opts: { limit: number; agent?: AgentArg },
  deps: McpToolDeps = {},
): Promise<CallToolResult> {
  const { fs, env, clock, cwd } = resolveDeps(deps);
  const c = new Captured();
  const shown = await resolveDisplayAgents({
    agent: opts.agent,
    fs,
    env,
    clock,
    cwd,
    json: true,
    stderr: c.stderr,
    singleSession: true,
  });
  if (!shown.ok) return fail(c.errors);
  const agent = shown.agents[0]!;
  if (!agent.transcriptParsingSupported) return fail(MESSAGES.cursorTranscriptNotSupported());
  if (agent.id === "claude-code") {
    const projectsDir = resolveProjectsDir(env);
    if (!(await fs.exists(projectsDir))) {
      return fail(`No Claude Code transcripts found at ${projectsDir}.`);
    }
  }
  const found = await discoverAgentSessions(agent, { fs, env, clock });
  if (!found.ok) return fail(found.error.map((i) => i.message).join("\n"));
  const sessions = found.value.sessions;
  const top = sessions.slice(0, opts.limit);
  if (top.length === 0) return withHint(ok("No sessions found."), c);
  const lines = top.map((s) => {
    const when = new Date(s.mtimeMs).toISOString();
    const kb = (s.size / 1024).toFixed(1);
    // Codex helper threads are listed (their spend is real) but marked.
    const mark = s.isSubagent ? "  (subagent)" : "";
    return `${shortSessionId(s.sessionId, agent.id)}  ${when}  ${s.projectHash}  ${kb}KB${mark}`;
  });
  return withHint(
    ok(`Found ${sessions.length} session(s). Showing ${top.length} most recent:\n\n${lines.join("\n")}`),
    c,
  );
}

/**
 * `sipcode why --json`, so the pick follows the CLI rules: the newest
 * non-empty session that is not a helper thread, counting only its own
 * requests (a resumed session's copied history is left out).
 */
export async function toolAuditLatestSession(
  opts: { sessionId?: string; agent?: AgentArg },
  deps: McpToolDeps = {},
): Promise<CallToolResult> {
  const { runWhy } = await import("../commands/why.js");
  const { fs, env, clock, cwd } = resolveDeps(deps);
  let agent: string | undefined = opts.agent;
  const prefix = opts.sessionId;
  if (prefix !== undefined && agent === undefined) {
    // An id names one session: look in every tool with logs, not only the
    // default one, and refuse to guess when both have a match.
    const shown = await resolveDisplayAgents({
      agent: undefined,
      fs,
      env,
      clock,
      cwd,
      json: false,
      stderr: () => {},
      singleSession: true,
    });
    if (shown.ok) {
      const lists = await listAgentSessions({ agents: shown.agents, deps: { fs, env, clock }, cwd });
      const hits = lists
        .map((l) => ({ agent: l.agent, meta: l.all.find((m) => m.sessionId.startsWith(prefix)) }))
        .filter((h) => h.meta !== undefined);
      if (hits.length > 1) {
        return fail(
          [
            `session_id "${prefix}" matches sessions in more than one tool:`,
            ...hits.map((h) => `  ${h.agent.displayName}: ${shortSessionId(h.meta!.sessionId, h.agent.id)}`),
            "",
            `Pass ${hits.map((h) => `agent: "${h.agent.id}"`).join(" or ")}, or a longer session_id.`,
          ].join("\n"),
        );
      }
      if (hits.length === 1) agent = hits[0]!.agent.id;
    }
  }
  const c = new Captured();
  const whyOpts: { json: true; cwd: string; agent?: string; session?: string } = { json: true, cwd };
  if (agent !== undefined) whyOpts.agent = agent;
  if (prefix !== undefined) whyOpts.session = prefix;
  const r = await runWhy(whyOpts, { fs, env, clock, stdout: c.stdout, stderr: c.stderr });
  return commandResult(r.exitCode, c, "No sessions to audit.");
}

async function toolGetProjectManifest(opts: {
  cwd: string;
}): Promise<CallToolResult> {
  const fs = new RealFileSystem();
  const targetCwd = opts.cwd;
  const manifestPath = `${targetCwd.replace(/[/\\]$/, "")}/.sipcode/manifest.md`;
  if (await fs.exists(manifestPath)) {
    try {
      const content = await fs.readFile(manifestPath);
      return ok(content);
    } catch {
      // fall through and regenerate
    }
  }

  // No manifest yet → instruct the user instead of silently building.
  // Building requires the manifest pipeline (tree-sitter etc) which may
  // not be safe to run in arbitrary cwd without user consent.
  return fail(
    `No manifest at ${manifestPath}. Run \`npx sipcode manifest\` in that directory first, then re-call this tool.`,
  );
}

async function toolEstimateTaskCost(opts: {
  task: string;
  cwd: string;
}): Promise<CallToolResult> {
  if (!opts.task || opts.task.trim().length < 3) {
    return fail("Task description must be at least 3 characters.");
  }
  // Reuse runEstimate. Capture stdout (JSON) into a buffer instead of
  // letting it write to process.stdout (which is the MCP transport).
  const buf: string[] = [];
  const errs: string[] = [];
  const result = await runEstimate(
    { task: opts.task, cwd: opts.cwd, json: true },
    {
      stdout: (s: string) => buf.push(s),
      stderr: (s: string) => errs.push(s),
    },
  );
  if (result.exitCode !== 0) {
    return fail(errs.join("\n") || "estimate failed");
  }
  return ok(buf.join("\n"));
}

async function toolGetProxyStats(): Promise<CallToolResult> {
  const { readReport } = await import("../modules/proxy/stats-store.js");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");
  const dir = join(homedir(), ".sipcode", "proxy-stats");
  const report = await readReport(dir);
  return ok(JSON.stringify(report, null, 2));
}

export async function toolGetDriftReport(
  opts: { agent?: AgentArg } = {},
  deps: McpToolDeps = {},
): Promise<CallToolResult> {
  const { runDriftCommand } = await import("../commands/drift.js");
  const { fs, env, clock, cwd } = resolveDeps(deps);
  const c = new Captured();
  const r = await runDriftCommand(
    { json: true, cwd, ...(opts.agent !== undefined ? { agent: opts.agent } : {}) },
    { fs, env, clock, ...deps.drift, stdout: c.stdout, stderr: c.stderr },
  );
  return commandResult(r.exitCode, c, "drift failed");
}

export async function toolGetTodaySummary(
  opts: { agent?: AgentArg } = {},
  deps: McpToolDeps = {},
): Promise<CallToolResult> {
  const { runTodayCmd } = await import("../commands/today.js");
  const { fs, env, clock, cwd } = resolveDeps(deps);
  const c = new Captured();
  const r = await runTodayCmd(
    { json: true, cwd, ...(opts.agent !== undefined ? { agent: opts.agent } : {}) },
    { fs, env, clock, stdout: c.stdout, stderr: c.stderr },
  );
  return commandResult(r.exitCode, c, "today failed");
}

export async function toolForecastMonthlySpend(
  opts: { agent?: AgentArg } = {},
  deps: McpToolDeps = {},
): Promise<CallToolResult> {
  const { runForecastCmd } = await import("../commands/forecast.js");
  const { fs, env, clock, cwd } = resolveDeps(deps);
  const c = new Captured();
  const r = await runForecastCmd(
    { json: true, cwd, ...(opts.agent !== undefined ? { agent: opts.agent } : {}) },
    { fs, env, clock, stdout: c.stdout, stderr: c.stderr },
  );
  return commandResult(r.exitCode, c, "forecast failed");
}

async function toolGetAgentScore(cwd: string): Promise<CallToolResult> {
  const { runScoreCmd } = await import("../commands/score.js");
  const buf: string[] = [];
  const errs: string[] = [];
  const r = await runScoreCmd(
    { cwd, json: true, html: false },
    { stdout: (s: string) => buf.push(s), stderr: (s: string) => errs.push(s), writeFile: async () => {} },
  );
  if (r.exitCode !== 0) return fail(errs.join("\n") || "score failed");
  return ok(buf.join("\n"));
}

export async function toolGetSessionStats(
  opts: { agent?: AgentArg } = {},
  deps: McpToolDeps = {},
): Promise<CallToolResult> {
  const { runStats } = await import("../commands/stats.js");
  const { fs, env, clock, cwd } = resolveDeps(deps);
  const c = new Captured();
  const r = await runStats(
    { json: true, cwd, ...(opts.agent !== undefined ? { agent: opts.agent } : {}) },
    { fs, env, clock, stdout: c.stdout, stderr: c.stderr, writeFile: async () => {} },
  );
  return commandResult(r.exitCode, c, "stats failed");
}

async function toolInstallProxy(): Promise<CallToolResult> {
  const { runProxy } = await import("../commands/proxy.js");
  const buf: string[] = [];
  await runProxy({ install: true }, { stdout: (s: string) => buf.push(s) });
  return ok(buf.join("\n") || "sipcode proxy installed.");
}

async function toolUninstallProxy(): Promise<CallToolResult> {
  const { runProxy } = await import("../commands/proxy.js");
  const buf: string[] = [];
  await runProxy({ uninstall: true }, { stdout: (s: string) => buf.push(s) });
  return ok(buf.join("\n") || "sipcode proxy uninstalled.");
}

async function toolGetProxyStatus(): Promise<CallToolResult> {
  const { runProxy } = await import("../commands/proxy.js");
  const buf: string[] = [];
  await runProxy({}, { stdout: (s: string) => buf.push(s) });
  const { readReport } = await import("../modules/proxy/stats-store.js");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");
  const report = await readReport(join(homedir(), ".sipcode", "proxy-stats"));
  return ok(
    `${buf.join("\n")}\nRewrites recorded: ${report.totalInvocations} · est. tokens saved: ~${report.estimatedSavedTokens} (heuristic)`,
  );
}

// ---- Tool registry ----

/**
 * Number of MCP tools registered. Exported so v1.6.15+ `sipcode init` can
 * verify the count without spawning a subprocess. Kept as a getter (not a
 * cached const) so it always reflects TOOL_DEFS.length at the time of access,
 * preventing drift if the array grows.
 */
export function getRegisteredMcpToolCount(): number {
  return TOOL_DEFS.length;
}

const TOOL_DEFS = [
  {
    name: "get_sipcode_info",
    description:
      "Return the installed Sipcode version, the list of registered MCP tools, the Node runtime version, and the host platform. Use this whenever the user asks 'what version of sipcode is installed?', 'what sipcode tools do you have?', or 'is sipcode working?'. Takes no arguments.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    schema: z.object({}),
  },
  {
    name: "verify_sipcode_impact",
    description:
      "Prove that Sipcode is actually saving the user tokens by A/B-comparing their token spend before vs after they installed Sipcode's optimizers. Reads the user's local Claude Code or Codex sessions and the install-state.json marker. Returns a JSON impact report with before/after totals + a delta block. Use this when the user asks 'is sipcode actually working?', 'is sipcode really saving me tokens?', or 'show me the impact'.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description:
            "Optional. Absolute path to the project root where .sipcode/install-state.json lives. Defaults to the server's cwd.",
        },
        since: {
          type: "string",
          description:
            "Optional override for the install date in YYYY-MM-DD form. Skips the install-state.json lookup.",
        },
        agent: AGENT_INPUT,
      },
    },
    schema: z.object({
      cwd: z.string().min(1).optional(),
      since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      agent: z.enum(AGENT_IDS).optional(),
    }),
  },
  {
    name: "list_recent_sessions",
    description:
      "List the user's most recent Claude Code or Codex sessions, sorted newest first. Returns session id, timestamp, project hash, and file size for each; Codex helper threads are marked (subagent). Use this when the user wants to see what sessions they have available, OR before calling audit_latest_session with a specific id.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max sessions to return. Defaults to 10.",
        },
        agent: AGENT_INPUT,
      },
    },
    schema: z.object({
      limit: z.number().int().positive().max(100).optional(),
      agent: z.enum(AGENT_IDS).optional(),
    }),
  },
  {
    name: "audit_latest_session",
    description:
      "Audit a Claude Code or Codex session and return a JSON report of where tokens went: total spend, output ratio, duplicate file reads, idle context, top expensive tool calls, and an estimate of what Sipcode COULD HAVE RECOVERED (potential, not realized; assumes optimizers were active). Defaults to the most recent session if no id is given. This is the equivalent of running `sipcode why` from the CLI. Note: 'estimatedSavings' fields are projections from the session data alone; they become measured-real numbers only after running `sipcode rules --install` and re-running impact.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description:
            "Optional. Specific session id (or unique prefix) to audit, from either tool. If omitted, picks the most recent session across all projects.",
        },
        agent: AGENT_INPUT,
      },
    },
    schema: z.object({
      session_id: z.string().min(1).optional(),
      agent: z.enum(AGENT_IDS).optional(),
    }),
  },
  {
    name: "get_project_manifest",
    description:
      "Return the Sipcode project manifest for a given directory. The manifest is a compressed <2k-token codebase map (file tree, hot files, framework fingerprint, detected patterns) generated by `sipcode manifest`. Use this BEFORE exploring a codebase — it's far cheaper than reading individual files. If no manifest exists yet, this tool returns an error with instructions for the user to generate one.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description:
            "Absolute path to the project root. Required so the tool reads the right manifest.",
        },
      },
      required: ["cwd"],
    },
    schema: z.object({
      cwd: z.string().min(1),
    }),
  },
  {
    name: "estimate_task_cost",
    description:
      "Predict what a coding task will cost across models (Opus / Sonnet / Haiku) before the user runs it. Returns a JSON cost prediction with a confidence band and per-model token estimates. Use this when the user asks 'how expensive will this be?' or before quoting a task.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description:
            "Natural-language description of the task. Example: 'refactor the auth pipeline across 6 files'.",
        },
        cwd: {
          type: "string",
          description:
            "Absolute path to the project root. Used to read the manifest and historical session anchors.",
        },
      },
      required: ["task", "cwd"],
    },
    schema: z.object({
      task: z.string().min(3),
      cwd: z.string().min(1),
    }),
  },
  {
    name: "get_proxy_stats",
    description:
      "Return aggregated Sipcode proxy rewrite stats: total invocations, per-rewriter counts, and estimated saved tokens (heuristic). Use when the user asks 'is the proxy active?' or 'how much is the proxy saving?'.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    schema: z.object({}),
  },
  {
    name: "get_agent_score",
    description:
      "Run Sipcode's 24-check static audit of a project's agent-friendliness and return the tier + composite score as JSON. Use when the user asks 'how agent-friendly is this codebase?' or 'what's my sipcode score?'.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description: "Absolute path to the project root to audit.",
        },
      },
      required: ["cwd"],
    },
    schema: z.object({ cwd: z.string().min(1) }),
  },
  {
    name: "get_session_stats",
    description:
      "Return cross-session token analytics (totals, per-session breakdown, top expensive sessions) as JSON, read from the local Claude Code (or Codex) logs. Use when the user asks 'how many tokens have I used?' or 'what are my most expensive sessions?'.",
    inputSchema: { type: "object", properties: { agent: AGENT_INPUT } },
    schema: z.object({ agent: z.enum(AGENT_IDS).optional() }),
  },
  {
    name: "install_proxy",
    description:
      "Install the Sipcode runtime proxy: writes the PreToolUse hook and registers it in ~/.claude/settings.json so Claude Code rewrites tool inputs for compact output. WRITES to settings.json (reversible with uninstall_proxy). Use when the user asks to 'turn on the proxy' or 'start saving tokens'.",
    inputSchema: { type: "object", properties: {} },
    schema: z.object({}),
  },
  {
    name: "uninstall_proxy",
    description:
      "Remove the Sipcode proxy hook from ~/.claude/settings.json and delete the hook script. WRITES to settings.json. Use when the user asks to 'turn off the proxy'.",
    inputSchema: { type: "object", properties: {} },
    schema: z.object({}),
  },
  {
    name: "get_proxy_status",
    description:
      "Report whether the Sipcode proxy is installed plus its accumulated rewrite stats. Read-only. Use when the user asks 'is the proxy on?'.",
    inputSchema: { type: "object", properties: {} },
    schema: z.object({}),
  },
  {
    name: "get_today_summary",
    description:
      "Daily dashboard: answers 'how am I doing today?' Returns spend so far today, sessions count, output ratio, and a comparison to the user's adaptive N-day median (cascades 30→14→7→3 based on available history). Includes a one-paragraph headline plus structured fields. Status field: ok | no-sessions-today | no-baseline | no-data. Use this when the user asks 'how am I doing today?', 'what have I spent today?', or 'how's my Claude usage looking?'. Reads Claude Code or Codex logs.",
    inputSchema: {
      type: "object",
      properties: { agent: AGENT_INPUT },
    },
    schema: z.object({ agent: z.enum(AGENT_IDS).optional() }),
  },
  {
    name: "forecast_monthly_spend",
    description:
      "Projects month-end Claude Code (or Codex) spend at the user's current trajectory (last 14 or 7 days, adaptive). Returns avg + median daily spend, projected month-end total with an honest confidence band (±1σ daily-spend stdev, capped at ±20% of projection), spend-so-far this month, and an optional comparison to last month's actual spend. Status field: ok | insufficient-data | near-month-end | no-recent-activity | no-data. Use this when the user asks 'how much will I spend this month?', 'am I on track?', or 'how does this month compare to last?'.",
    inputSchema: {
      type: "object",
      properties: { agent: AGENT_INPUT },
    },
    schema: z.object({ agent: z.enum(AGENT_IDS).optional() }),
  },
  {
    name: "get_drift_report",
    description:
      "Detect context/cost drift: whether the user's recent Claude Code or Codex sessions regressed (cost/turn up, cache-hit-rate down, re-read waste up) vs their own baseline. Returns JSON. Use when the user asks 'is my agent getting more expensive / sloppier?' or 'has anything regressed?'.",
    inputSchema: { type: "object", properties: { agent: AGENT_INPUT } },
    schema: z.object({ agent: z.enum(AGENT_IDS).optional() }),
  },
] as const;

// ---- Wire up the server ----

const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: listToolDefinitions() };
});

/** Name, description and input schema of every registered tool (what tools/list returns). */
export function listToolDefinitions(): Array<{ name: string; description: string; inputSchema: unknown }> {
  return TOOL_DEFS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  return callTool(req.params.name, req.params.arguments);
});

/**
 * Validate a tool call's arguments and run it. Exported for tests, which pass
 * `deps` to keep every read off the real disk.
 */
export async function callTool(
  name: string,
  rawArgs: Record<string, unknown> | undefined,
  deps: McpToolDeps = {},
): Promise<CallToolResult> {
  const def = TOOL_DEFS.find((t) => t.name === name);
  if (!def) {
    return fail(`Unknown tool: ${name}`);
  }
  const parsed = def.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return fail(
      `Invalid arguments for ${name}: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ")}`,
    );
  }
  const args = parsed.data as Record<string, unknown>;
  const agent = args["agent"] as AgentArg | undefined;
  const agentOpt = agent !== undefined ? { agent } : {};

  try {
    // Each handler is wrapped in withTimeout so a single slow/hung
    // tool cannot make Claude Desktop's MCP client time out at the
    // 4-minute mark and surface a generic "server is down" error.
    // The user sees a real diagnostic instead. Tool-specific hints
    // tell them how to narrow the scan if the work was genuinely
    // too big rather than a bug.
    switch (name) {
      case "get_sipcode_info": {
        return await withTimeout(name, 5_000, toolGetSipcodeInfo());
      }
      case "verify_sipcode_impact": {
        const impactOpts: { cwd?: string; since?: string; agent?: AgentArg } = { ...agentOpt };
        const cwdArg = args["cwd"] as string | undefined;
        const sinceArg = args["since"] as string | undefined;
        if (cwdArg !== undefined) impactOpts.cwd = cwdArg;
        if (sinceArg !== undefined) impactOpts.since = sinceArg;
        return await withTimeout(
          name,
          45_000,
          toolVerifySipcodeImpact(impactOpts, deps),
          "scan was too large or your session catalog has many files — pass `since: \"YYYY-MM-DD\"` (recent date) to narrow the window, or pass `cwd: \"<absolute-project-path>\"` to scope to one project",
        );
      }
      case "list_recent_sessions": {
        const limit = (args["limit"] as number | undefined) ?? 10;
        return await withTimeout(name, 10_000, toolListRecentSessions({ limit, ...agentOpt }, deps));
      }
      case "audit_latest_session": {
        const opts: { sessionId?: string; agent?: AgentArg } = { ...agentOpt };
        const sid = args["session_id"] as string | undefined;
        if (sid !== undefined) opts.sessionId = sid;
        return await withTimeout(
          name,
          20_000,
          toolAuditLatestSession(opts, deps),
          "the target session is unusually large — pass `session_id: \"<short-hash>\"` to pick a specific smaller one from list_recent_sessions",
        );
      }
      case "get_project_manifest": {
        return await withTimeout(
          name,
          15_000,
          toolGetProjectManifest({ cwd: args["cwd"] as string }),
          "the project at this cwd may not have a Sipcode manifest yet — run `sipcode manifest` in that project first",
        );
      }
      case "estimate_task_cost": {
        return await withTimeout(
          name,
          15_000,
          toolEstimateTaskCost({
            task: args["task"] as string,
            cwd: args["cwd"] as string,
          }),
        );
      }
      case "get_proxy_stats": {
        return await withTimeout(name, 5_000, toolGetProxyStats());
      }
      case "get_agent_score": {
        return await withTimeout(
          name,
          30_000,
          toolGetAgentScore(args["cwd"] as string),
          "the project at this cwd may be large — point cwd at a specific package, or run `sipcode score` in your terminal",
        );
      }
      case "get_session_stats": {
        return await withTimeout(
          name,
          30_000,
          toolGetSessionStats(agentOpt, deps),
          "your session catalog may be large — run `sipcode stats` in your terminal, or pass a recent `since` window via the CLI",
        );
      }
      case "install_proxy": {
        return await withTimeout(name, 10_000, toolInstallProxy());
      }
      case "uninstall_proxy": {
        return await withTimeout(name, 10_000, toolUninstallProxy());
      }
      case "get_proxy_status": {
        return await withTimeout(name, 5_000, toolGetProxyStatus());
      }
      case "get_drift_report": {
        return await withTimeout(name, 15_000, toolGetDriftReport(agentOpt, deps));
      }
      case "get_today_summary": {
        return await withTimeout(name, 10_000, toolGetTodaySummary(agentOpt, deps));
      }
      case "forecast_monthly_spend": {
        return await withTimeout(name, 10_000, toolForecastMonthlySpend(agentOpt, deps));
      }
      default:
        return fail(`Tool ${name} is registered but has no handler.`);
    }
  } catch (e) {
    // Surface ToolTimeoutError specifically — it carries a structured
    // hint that helps the user fix their request, not a generic error.
    if (e instanceof ToolTimeoutError) {
      return fail(e.message);
    }
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`Error executing ${name}: ${msg}`);
  }
}

// ---- Boot ----
//
// Process-level safety nets. The MCP server runs as a long-lived stdio
// child of Claude Desktop. A SINGLE unhandled error here surfaces to
// the user as "MCP sipcode: Server disconnected" — the exact failure
// shape that triggered the v1.1.3–v1.1.5 bug streak. Belt + suspenders:
//   • uncaughtException / unhandledRejection — log + exit non-zero so
//     Claude Desktop's auto-restart kicks in (vs. silent zombie).
//   • SIGINT / SIGTERM — clean exit 0 so the parent shutdown is graceful.
//   • stdin 'end' — parent closed the pipe; nothing to serve. Exit 0.

function logFatal(scope: string, err: unknown): void {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  // stdout is the MCP JSON-RPC channel — log to stderr only.
  process.stderr.write(`[sipcode-mcp] ${scope}: ${msg}\n`);
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Don't log to stdout — that's the MCP transport. stderr is fine.
  process.stderr.write(
    `[sipcode-mcp] connected (${SERVER_NAME} v${SERVER_VERSION}, ${TOOL_DEFS.length} tools)\n`,
  );
}

// Only start the server — and install its process-level exit handlers — when
// this module is run AS the sipcode-mcp binary. When it is merely imported
// (e.g. `sipcode init` pulls in getRegisteredMcpToolCount), starting the server
// would attach a stdin "end" handler that calls process.exit(0); with non-TTY
// stdin (CI, pipes) that fires immediately and kills the host command mid-run.
const _isMainModule =
  process.argv[1] != null &&
  _pathToFileURL(process.argv[1]).href === import.meta.url;

if (_isMainModule) {
  process.on("uncaughtException", (err) => {
    logFatal("uncaughtException", err);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logFatal("unhandledRejection", reason);
    process.exit(1);
  });

  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => {
      process.stderr.write(`[sipcode-mcp] received ${sig}, shutting down\n`);
      process.exit(0);
    });
  }

  // Parent died / disconnected the stdio pipe — we have no work left.
  process.stdin.on("end", () => {
    process.stderr.write(`[sipcode-mcp] stdin closed, shutting down\n`);
    process.exit(0);
  });
  process.stdin.on("error", (err) => {
    logFatal("stdin error", err);
    process.exit(1);
  });

  main().catch((err) => {
    logFatal("fatal during boot", err);
    process.exit(1);
  });
}
