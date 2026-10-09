/**
 * Codex adapter: analytics only in this release. Writing AGENTS.md and
 * registering the MCP server arrive with Codex setup (a later piece).
 */
import path from "node:path";
import { err, ok, type Result } from "../../../lib/result.js";
import { issue, type SipcodeIssue } from "../../../lib/errors.js";
import type { Agent, AgentDeps, AgentRulesRead, SessionDiscovery } from "../types.js";
import type { SessionMeta } from "../shared.js";
import { hasCodexRollout, listCodexSessions, resolveCodexHome } from "./discover.js";
import { parseCodexRollout } from "./parse.js";

const RULES_FILE_NAME = "AGENTS.md";

const notYet = (): Result<never, SipcodeIssue[]> =>
  err([issue("E009", "writing rules to AGENTS.md is not supported for Codex yet.")]);

/** Drive letter (`C:`) or UNC (`\\server`): Codex ran on Windows. */
const WINDOWS_PATH = /^(?:[A-Za-z]:|[\\/]{2}[^\\/])/;

/**
 * Is `inner` the folder `outer` or inside it? Compared in the path flavour the
 * strings were written in (Codex may have run on another OS than Sipcode), never
 * resolved against process.cwd(), and only at whole path segments.
 */
export function isWithinFolder(inner: string, outer: string): boolean {
  const windows = WINDOWS_PATH.test(inner) || WINDOWS_PATH.test(outer);
  const sep = windows ? "\\" : "/";
  const norm = (p: string): string => {
    const n = windows ? path.win32.normalize(p).toLowerCase() : path.posix.normalize(p);
    return n.endsWith(sep) ? n.slice(0, -1) : n;
  };
  const a = norm(inner);
  const b = norm(outer);
  return a === b || a.startsWith(b + sep);
}

export const codexAgent: Agent = {
  id: "codex",
  displayName: "Codex",
  rulesPathCandidates: (cwd: string): readonly string[] => [path.join(cwd, RULES_FILE_NAME)],
  transcriptParsingSupported: true,

  async discoverSessions(deps: AgentDeps): Promise<Result<SessionDiscovery, SipcodeIssue[]>> {
    const r = await listCodexSessions(deps.fs, resolveCodexHome(deps.env));
    return ok({
      sessions: r.sessions,
      unreadable: r.unreadable,
      unreadableFolders: r.unreadableFolders,
      skippedCompressed: r.skippedCompressed,
      issues: [],
    });
  },

  parseTranscript(content: string) {
    return parseCodexRollout(content);
  },

  matchesCwd(meta: SessionMeta, cwd: string): boolean {
    return meta.cwd !== undefined && isWithinFolder(meta.cwd, cwd);
  },

  async readRulesFile(deps: AgentDeps, cwd: string): Promise<AgentRulesRead | null> {
    const target = path.join(cwd, RULES_FILE_NAME);
    if (!(await deps.fs.exists(target))) return null;
    return { path: target, content: await deps.fs.readFile(target) };
  },

  async writeRulesBlock() {
    return notYet();
  },

  async removeRulesBlock() {
    return notYet();
  },

  /** Installed = $CODEX_HOME/sessions holds at least one rollout-*.jsonl. */
  async isInstalled(deps: AgentDeps): Promise<boolean> {
    return hasCodexRollout(deps.fs, path.join(resolveCodexHome(deps.env), "sessions"));
  },
};
