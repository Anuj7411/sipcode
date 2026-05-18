/**
 * Install / switch / uninstall the output-compression sub-block.
 * Pure functions over CLAUDE.md content strings.
 */
import {
  removeSubBlock,
  upsertSubBlock,
} from "../../lib/claudeMd.js";
import type { Result } from "../../lib/result.js";
import type { SipcodeIssue } from "../../lib/errors.js";
import { renderRulesBlock } from "./blocks.js";
import { OUTPUT_COMPRESSION_BLOCK_NAME, type RulesMode } from "./types.js";

/**
 * Produce the next CLAUDE.md content with output-compression installed
 * (or switched) to `mode`. Idempotent: re-running with the same mode on
 * already-installed content yields a byte-identical result.
 */
export function installRules(
  currentContent: string,
  mode: RulesMode,
): Result<string, SipcodeIssue[]> {
  const block = renderRulesBlock(mode);
  return upsertSubBlock(currentContent, {
    name: OUTPUT_COMPRESSION_BLOCK_NAME,
    mode,
    body: block.body,
  });
}

/**
 * Remove the output-compression sub-block. No-op if not installed.
 */
export function uninstallRules(
  currentContent: string,
): Result<string, SipcodeIssue[]> {
  return removeSubBlock(currentContent, OUTPUT_COMPRESSION_BLOCK_NAME);
}
