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
void ASSERT_NO_NETWORK;

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { z } from "zod";

import { RealFileSystem } from "../lib/fs.js";
import { RealClock } from "../lib/clock.js";
import { RealProcessEnv } from "../lib/process.js";
import { RealGit } from "../lib/git.js";
import { loadPricingForDate, pricingAgeDays } from "../lib/pricing/load.js";
import {
  listAllSessions,
  findSessionById,
  resolveProjectsDir,
} from "../modules/transcript/discover.js";
import { parseTranscriptVerbose } from "../modules/transcript/parse.js";
import { analyzeTokens } from "../modules/transcript/analyzers/tokens.js";
import { analyzeDuplicateReads } from "../modules/transcript/analyzers/duplicateReads.js";
import { analyzeIdleContext } from "../modules/transcript/analyzers/idleContext.js";
import { analyzeTopExpensive } from "../modules/transcript/analyzers/topExpensive.js";
import { analyzeCounterfactual } from "../modules/transcript/analyzers/counterfactual.js";
import { renderReport } from "../modules/why/render.js";
import { formatJson as formatWhyJson } from "../modules/why/format-json.js";

import { runEstimate } from "../commands/estimate.js";

// ---- Server metadata ----

import { readFileSync as _readFileSync } from "node:fs";
import { fileURLToPath as _fileURLToPath } from "node:url";
import { dirname as _dirname, join as _join } from "node:path";

const SERVER_NAME = "sipcode";
const _serverDir = _dirname(_fileURLToPath(import.meta.url));
const SERVER_VERSION = (JSON.parse(
  _readFileSync(_join(_serverDir, "..", "..", "package.json"), "utf-8"),
) as { version: string }).version;

// ---- Helpers ----

async function readTranscript(fs: RealFileSystem, filePath: string): Promise<string> {
  return fs.readFile(filePath);
}

function ok(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function fail(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

// ---- Tool implementations ----

async function toolVerifySipcodeImpact(opts: { cwd?: string; since?: string }): Promise<CallToolResult> {
  const { runImpactCommand } = await import("../commands/impact.js");
  const { existsSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");

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
    const here = process.cwd();
    if (hasMarker(here)) {
      resolvedCwd = here;
    } else {
      // 2. Walk ~/.claude/projects/* — these are projects where Claude Code
      //    has run. The project-hash dir name decodes to an absolute path
      //    ("C--Projects-Sipcode" → "C:\Projects\Sipcode"). Pick the first
      //    decoded path that contains an install-state.json. Claude only
      //    sees one MCP server, but it's reasonable to scan all projects.
      const projectsDir = join(homedir(), ".claude", "projects");
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
  const finalCwd = resolvedCwd ?? process.cwd();

  let captured = "";
  const cmdOpts: { since?: string; json: true; cwd: string } = {
    json: true,
    cwd: finalCwd,
  };
  if (opts.since !== undefined) cmdOpts.since = opts.since;
  const result = await runImpactCommand(cmdOpts, {
    stdout: (s) => {
      captured += s + "\n";
    },
    stderr: (s) => {
      captured += s + "\n";
    },
  });
  if (result.exitCode !== 0) return fail(captured.trim());

  // If we couldn't find a marker even after walking known locations, append
  // a friendly diagnostic so the user understands why and can pass `cwd:`
  // explicitly or use `since:` as a workaround.
  if (!resolvedCwd && !opts.since) {
    const diagnostic = [
      "",
      "---",
      "Could not auto-locate .sipcode/install-state.json. Tried:",
      ...triedPaths.map((p) => `  • ${p}`),
      "",
      "Workarounds:",
      "  • Pass cwd: \"/absolute/path/to/your/project\" to point at the right directory.",
      "  • Pass since: \"YYYY-MM-DD\" to set the pivot manually (e.g., when you started using Sipcode).",
      "  • Run `sipcode rules --install` in your project to create the marker going forward.",
    ].join("\n");
    return ok(captured.trim() + diagnostic);
  }

  return ok(captured.trim());
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

async function toolListRecentSessions(limit: number): Promise<CallToolResult> {
  const fs = new RealFileSystem();
  const env = new RealProcessEnv();
  const projectsDir = resolveProjectsDir(env);
  if (!(await fs.exists(projectsDir))) {
    return fail(`No Claude Code transcripts found at ${projectsDir}.`);
  }
  const sessions = await listAllSessions(fs, projectsDir);
  const top = sessions.slice(0, limit);
  if (top.length === 0) return ok("No sessions found.");
  const lines = top.map((s) => {
    const when = new Date(s.mtimeMs).toISOString();
    const kb = (s.size / 1024).toFixed(1);
    return `${s.sessionId.slice(0, 8)}  ${when}  ${s.projectHash}  ${kb}KB`;
  });
  return ok(
    `Found ${sessions.length} session(s). Showing ${top.length} most recent:\n\n${lines.join("\n")}`,
  );
}

async function toolAuditLatestSession(
  opts: { sessionId?: string },
): Promise<CallToolResult> {
  const fs = new RealFileSystem();
  const clock = new RealClock();
  const env = new RealProcessEnv();

  const projectsDir = resolveProjectsDir(env);
  if (!(await fs.exists(projectsDir))) {
    return fail(`No Claude Code transcripts found at ${projectsDir}.`);
  }

  const sessions = await listAllSessions(fs, projectsDir);
  if (sessions.length === 0) return fail("No sessions to audit.");

  let chosen = sessions[0];
  if (opts.sessionId) {
    const match = await findSessionById(fs, projectsDir, opts.sessionId);
    if (!match) return fail(`No session matches "${opts.sessionId}".`);
    chosen = match;
  }
  if (!chosen) return fail("No sessions to audit.");

  let contents: string;
  try {
    contents = await readTranscript(fs, chosen.filePath);
  } catch {
    return fail(`Could not read session file ${chosen.filePath}.`);
  }

  const { session, issues } = parseTranscriptVerbose(contents);

  const sessionDate = session.startedAt
    ? new Date(session.startedAt)
    : clock.now();
  const pricing = loadPricingForDate(sessionDate);
  const ageDays = pricingAgeDays(pricing, clock.now());

  const totals = analyzeTokens(session, pricing);
  const dups = analyzeDuplicateReads(session);
  const idle = analyzeIdleContext(session);
  const topEx = analyzeTopExpensive(session);
  const counter = analyzeCounterfactual(session, dups);

  const report = renderReport({
    session,
    totals,
    duplicates: dups,
    idle,
    topExpensive: topEx,
    counterfactual: counter,
    issues,
    projectHash: chosen.projectHash,
    pricingMeta: { asOf: pricing.as_of, ageDays },
  });

  return ok(formatWhyJson(report));
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

// ---- Tool registry ----

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
      "Prove that Sipcode is actually saving the user tokens by A/B-comparing their token spend before vs after they installed Sipcode's optimizers. Reads the user's local Claude Code sessions and the install-state.json marker. Returns a JSON impact report with before/after totals + a delta block. Use this when the user asks 'is sipcode actually working?', 'is sipcode really saving me tokens?', or 'show me the impact'.",
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
      },
    },
    schema: z.object({
      cwd: z.string().min(1).optional(),
      since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
  },
  {
    name: "list_recent_sessions",
    description:
      "List the user's most recent Claude Code sessions from ~/.claude/projects, sorted newest first. Returns session id, timestamp, project hash, and file size for each. Use this when the user wants to see what sessions they have available, OR before calling audit_latest_session with a specific id.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max sessions to return. Defaults to 10.",
        },
      },
    },
    schema: z.object({
      limit: z.number().int().positive().max(100).optional(),
    }),
  },
  {
    name: "audit_latest_session",
    description:
      "Audit a Claude Code session and return a JSON report of where tokens went: total spend, output ratio, duplicate file reads, idle context, top expensive tool calls, and an estimate of what Sipcode would have saved. Defaults to the most recent session if no id is given. This is the equivalent of running `sipcode why` from the CLI.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description:
            "Optional. Specific session id (or unique prefix) to audit. If omitted, picks the most recent session across all projects.",
        },
      },
    },
    schema: z.object({
      session_id: z.string().min(1).optional(),
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
  return {
    tools: TOOL_DEFS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: rawArgs } = req.params;
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

  try {
    switch (name) {
      case "get_sipcode_info": {
        return await toolGetSipcodeInfo();
      }
      case "verify_sipcode_impact": {
        const impactOpts: { cwd?: string; since?: string } = {};
        const cwdArg = args["cwd"] as string | undefined;
        const sinceArg = args["since"] as string | undefined;
        if (cwdArg !== undefined) impactOpts.cwd = cwdArg;
        if (sinceArg !== undefined) impactOpts.since = sinceArg;
        return await toolVerifySipcodeImpact(impactOpts);
      }
      case "list_recent_sessions": {
        const limit = (args["limit"] as number | undefined) ?? 10;
        return await toolListRecentSessions(limit);
      }
      case "audit_latest_session": {
        const opts: { sessionId?: string } = {};
        const sid = args["session_id"] as string | undefined;
        if (sid !== undefined) opts.sessionId = sid;
        return await toolAuditLatestSession(opts);
      }
      case "get_project_manifest": {
        return await toolGetProjectManifest({ cwd: args["cwd"] as string });
      }
      case "estimate_task_cost": {
        return await toolEstimateTaskCost({
          task: args["task"] as string,
          cwd: args["cwd"] as string,
        });
      }
      default:
        return fail(`Tool ${name} is registered but has no handler.`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`Error executing ${name}: ${msg}`);
  }
});

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

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Don't log to stdout — that's the MCP transport. stderr is fine.
  process.stderr.write(
    `[sipcode-mcp] connected (${SERVER_NAME} v${SERVER_VERSION}, ${TOOL_DEFS.length} tools)\n`,
  );
}

main().catch((err) => {
  logFatal("fatal during boot", err);
  process.exit(1);
});
