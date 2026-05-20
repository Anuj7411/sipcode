/**
 * Install / uninstall the session-hygiene sub-block in CLAUDE.md.
 * Pure functions over CLAUDE.md content strings. The hook-script side of
 * install (writing .mjs files + editing settings.json) lives in the
 * command orchestrator at the I/O boundary — these helpers stay pure.
 */
import { removeSubBlock, upsertSubBlock } from "../../lib/claudeMd.js";
import type { Result } from "../../lib/result.js";
import type { SipcodeIssue } from "../../lib/errors.js";
import { renderHygieneBlock } from "./blocks.js";
import { SESSION_HYGIENE_BLOCK_NAME, type HygieneMode } from "./types.js";

/**
 * Produce the next CLAUDE.md content with session-hygiene installed at
 * `mode`. Idempotent: re-running at the same mode is byte-identical.
 */
export function installHygieneBlock(
  currentContent: string,
  mode: HygieneMode,
): Result<string, SipcodeIssue[]> {
  const block = renderHygieneBlock(mode);
  return upsertSubBlock(currentContent, {
    name: SESSION_HYGIENE_BLOCK_NAME,
    mode,
    body: block.body,
  });
}

/** Remove the session-hygiene sub-block. No-op if not present. */
export function uninstallHygieneBlock(
  currentContent: string,
): Result<string, SipcodeIssue[]> {
  return removeSubBlock(currentContent, SESSION_HYGIENE_BLOCK_NAME);
}
