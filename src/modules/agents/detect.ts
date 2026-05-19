/**
 * Auto-detect which agent to use for the cwd.
 *
 * Resolution order:
 *   1. Explicit AgentId from --agent <id> → use it.
 *   2. Unambiguous cwd signals:
 *        - CLAUDE.md exists + no .cursor/ → claude-code
 *        - .cursor/ exists + no CLAUDE.md → cursor
 *        - both → ambiguous (caller decides; default claude-code)
 *        - neither → fall through to global signals
 *   3. Global signals (~/.claude/projects, ~/.cursor/):
 *        - one installed, other not → use the installed one
 *        - both installed → ambiguous (default claude-code)
 *        - neither installed → default claude-code with a soft banner
 *
 * Always returns an AgentId; reason/banner is surfaced separately.
 */
import path from "node:path";
import type { FileSystem } from "../../lib/fs.js";
import type { ProcessEnv } from "../../lib/process.js";
import { resolveProjectsDir } from "../transcript/discover.js";
import {
  cursorLooksInstalled,
  detectCursor,
  type CursorPresence,
} from "./cursor/detect.js";
import type { AgentId, AgentSelector } from "./types.js";

export interface AgentDetectResult {
  readonly agent: AgentId;
  readonly reason: AgentDetectReason;
  /** True when both agents looked configured and we had to pick a default. */
  readonly ambiguous: boolean;
  /** True when the caller passed --agent <id> explicitly. */
  readonly explicit: boolean;
}

export type AgentDetectReason =
  | "explicit"
  | "cwd-claude-md"
  | "cwd-cursor"
  | "global-claude-code"
  | "global-cursor"
  | "default-fallback";

export interface DetectInputs {
  /** What the user passed (or "auto" if unset). */
  selector: AgentSelector;
  fs: FileSystem;
  env: ProcessEnv;
  cwd: string;
}

export async function detectAgent(
  inputs: DetectInputs,
): Promise<AgentDetectResult> {
  const { selector, fs, env, cwd } = inputs;

  if (selector !== "auto") {
    return {
      agent: selector,
      reason: "explicit",
      ambiguous: false,
      explicit: true,
    };
  }

  const cwdHasClaudeMd = await fs.exists(path.join(cwd, "CLAUDE.md"));
  const cursorPresence: CursorPresence = await detectCursor(fs, env, cwd);
  const cwdHasCursor =
    cursorPresence.cwdConfigDir || cursorPresence.cwdLegacyRules;

  if (cwdHasClaudeMd && !cwdHasCursor) {
    return {
      agent: "claude-code",
      reason: "cwd-claude-md",
      ambiguous: false,
      explicit: false,
    };
  }
  if (cwdHasCursor && !cwdHasClaudeMd) {
    return {
      agent: "cursor",
      reason: "cwd-cursor",
      ambiguous: false,
      explicit: false,
    };
  }
  if (cwdHasClaudeMd && cwdHasCursor) {
    // Ambiguous in-cwd; default to claude-code (largest user base).
    return {
      agent: "claude-code",
      reason: "cwd-claude-md",
      ambiguous: true,
      explicit: false,
    };
  }

  // Neither in cwd → check global installs.
  const ccGlobal = await fs.exists(resolveProjectsDir(env));
  const cursorGlobal = cursorLooksInstalled(cursorPresence);

  if (ccGlobal && !cursorGlobal) {
    return {
      agent: "claude-code",
      reason: "global-claude-code",
      ambiguous: false,
      explicit: false,
    };
  }
  if (cursorGlobal && !ccGlobal) {
    return {
      agent: "cursor",
      reason: "global-cursor",
      ambiguous: false,
      explicit: false,
    };
  }
  if (ccGlobal && cursorGlobal) {
    return {
      agent: "claude-code",
      reason: "global-claude-code",
      ambiguous: true,
      explicit: false,
    };
  }

  return {
    agent: "claude-code",
    reason: "default-fallback",
    ambiguous: false,
    explicit: false,
  };
}
