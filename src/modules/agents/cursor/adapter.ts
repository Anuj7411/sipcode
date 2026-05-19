/**
 * Cursor adapter — injection-only in v0.2.0-alpha.3.
 *
 * Transcript parsing is stubbed with E009: cursor's chat history schema is
 * internal and varies across versions. Rules + manifest injection still flow
 * through this adapter so users get the cross-agent surface today.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { issue, type SipcodeIssue } from "../../../lib/errors.js";
import { MESSAGES } from "../../../lib/messages.js";
import { cursorLooksInstalled, detectCursor } from "./detect.js";
import {
  LEGACY_PATH_SEGMENT,
  MDC_PATH_SEGMENTS,
  removeCursorBlock,
  resolveCursorRulesPath,
  upsertCursorBlock,
} from "./rules-file.js";
import type {
  Agent,
  AgentDeps,
  AgentRulesRead,
  AgentRulesWrite,
  RulesBlockInput,
  WriteFile,
} from "../types.js";
import type {
  ParsedSession,
  SessionMeta,
} from "../shared.js";
import path from "node:path";

export const cursorAgent: Agent = {
  id: "cursor",
  displayName: "Cursor",
  rulesPathCandidates(cwd: string): readonly string[] {
    return [
      path.join(cwd, ...MDC_PATH_SEGMENTS),
      path.join(cwd, LEGACY_PATH_SEGMENT),
    ];
  },
  transcriptParsingSupported: false,

  async discoverSessions(
    _deps: AgentDeps,
  ): Promise<Result<SessionMeta[], SipcodeIssue[]>> {
    return err([
      issue("E009", MESSAGES.cursorTranscriptNotSupported()),
    ]);
  },

  parseTranscript(_content: string): Result<ParsedSession, SipcodeIssue[]> {
    return err([
      issue("E009", MESSAGES.cursorTranscriptNotSupported()),
    ]);
  },

  async readRulesFile(
    deps: AgentDeps,
    cwd: string,
  ): Promise<AgentRulesRead | null> {
    const resolved = await resolveCursorRulesPath(deps.fs, cwd);
    if (!resolved.exists) return null;
    const content = await deps.fs.readFile(resolved.path);
    return { path: resolved.path, content };
  },

  async writeRulesBlock(
    deps: AgentDeps,
    cwd: string,
    block: RulesBlockInput,
    write: WriteFile,
    existingContent?: string,
  ): Promise<Result<AgentRulesWrite, SipcodeIssue[]>> {
    const resolved = await resolveCursorRulesPath(deps.fs, cwd);
    const existing =
      existingContent !== undefined
        ? existingContent
        : resolved.exists
        ? await deps.fs.readFile(resolved.path)
        : "";
    const next = upsertCursorBlock(
      existing,
      {
        name: block.name,
        ...(block.mode !== undefined ? { mode: block.mode } : {}),
        body: block.body,
      },
      resolved.isMdc,
    );
    if (!next.ok) return next;
    await write(resolved.path, next.value);
    return ok({ path: resolved.path, content: next.value });
  },

  async removeRulesBlock(
    deps: AgentDeps,
    cwd: string,
    blockName: string,
    write: WriteFile,
  ): Promise<Result<AgentRulesWrite | null, SipcodeIssue[]>> {
    const resolved = await resolveCursorRulesPath(deps.fs, cwd);
    if (!resolved.exists) return ok(null);
    const existing = await deps.fs.readFile(resolved.path);
    const next = removeCursorBlock(existing, blockName, resolved.isMdc);
    if (!next.ok) return next;
    if (next.value === existing) return ok(null);
    await write(resolved.path, next.value);
    return ok({ path: resolved.path, content: next.value });
  },

  async isInstalled(deps: AgentDeps, cwd: string): Promise<boolean> {
    const presence = await detectCursor(deps.fs, deps.env, cwd);
    return cursorLooksInstalled(presence);
  },
};
