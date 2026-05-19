/**
 * Claude Code adapter — wraps the existing transcript pipeline and CLAUDE.md
 * marker logic behind the Agent interface.
 *
 * This adapter introduces ZERO behavior change for users with only Claude
 * Code installed. It exists so the same call sites can also serve Cursor.
 */
import path from "node:path";
import {
  listAllSessions,
  resolveProjectsDir,
  type SessionMeta,
} from "../../transcript/discover.js";
import { parseTranscript } from "../../transcript/parse.js";
import { ok, type Result } from "../../../lib/result.js";
import type { SipcodeIssue } from "../../../lib/errors.js";
import {
  removeSubBlock,
  upsertSubBlock,
} from "../../../lib/claudeMd.js";
import type {
  Agent,
  AgentDeps,
  AgentRulesRead,
  AgentRulesWrite,
  RulesBlockInput,
  WriteFile,
} from "../types.js";

const RULES_FILE_NAME = "CLAUDE.md";

export const claudeCodeAgent: Agent = {
  id: "claude-code",
  displayName: "Claude Code",
  rulesPathCandidates(cwd: string): readonly string[] {
    return [path.join(cwd, RULES_FILE_NAME)];
  },
  transcriptParsingSupported: true,

  async discoverSessions(
    deps: AgentDeps,
  ): Promise<Result<SessionMeta[], SipcodeIssue[]>> {
    const projectsDir = resolveProjectsDir(deps.env);
    const sessions = await listAllSessions(deps.fs, projectsDir);
    return ok(sessions);
  },

  parseTranscript(content: string) {
    return parseTranscript(content);
  },

  async readRulesFile(
    deps: AgentDeps,
    cwd: string,
  ): Promise<AgentRulesRead | null> {
    const target = path.join(cwd, RULES_FILE_NAME);
    if (!(await deps.fs.exists(target))) return null;
    const content = await deps.fs.readFile(target);
    return { path: target, content };
  },

  async writeRulesBlock(
    deps: AgentDeps,
    cwd: string,
    block: RulesBlockInput,
    write: WriteFile,
    existingContent?: string,
  ): Promise<Result<AgentRulesWrite, SipcodeIssue[]>> {
    const target = path.join(cwd, RULES_FILE_NAME);
    const existing =
      existingContent !== undefined
        ? existingContent
        : (await this.readRulesFile(deps, cwd))?.content ?? "";
    const next = upsertSubBlock(existing, {
      name: block.name,
      ...(block.mode !== undefined ? { mode: block.mode } : {}),
      body: block.body,
    });
    if (!next.ok) return next;
    await write(target, next.value);
    return ok({ path: target, content: next.value });
  },

  async removeRulesBlock(
    deps: AgentDeps,
    cwd: string,
    blockName: string,
    write: WriteFile,
  ): Promise<Result<AgentRulesWrite | null, SipcodeIssue[]>> {
    const target = path.join(cwd, RULES_FILE_NAME);
    const existingRead = await this.readRulesFile(deps, cwd);
    if (!existingRead) return ok(null);
    const next = removeSubBlock(existingRead.content, blockName);
    if (!next.ok) return next;
    if (next.value === existingRead.content) return ok(null);
    await write(target, next.value);
    return ok({ path: target, content: next.value });
  },

  async isInstalled(deps: AgentDeps, cwd: string): Promise<boolean> {
    // "Installed" = either CLAUDE.md exists here, or ~/.claude/projects exists.
    if (await deps.fs.exists(path.join(cwd, RULES_FILE_NAME))) return true;
    const projectsDir = resolveProjectsDir(deps.env);
    return deps.fs.exists(projectsDir);
  },
};
