/**
 * Inspect: read CLAUDE.md and report whether output-compression rules are
 * installed and at what mode. Pure.
 */
import { listSubBlocks } from "../../lib/claudeMd.js";
import {
  OUTPUT_COMPRESSION_BLOCK_NAME,
  isRulesMode,
  type RulesState,
} from "./types.js";

export function inspectRules(claudeMdContent: string): RulesState {
  const subs = listSubBlocks(claudeMdContent);
  if (subs === null) return { installed: false };
  const ours = subs.find((s) => s.name === OUTPUT_COMPRESSION_BLOCK_NAME);
  if (!ours) return { installed: false };
  if (ours.mode !== undefined && isRulesMode(ours.mode)) {
    return { installed: true, mode: ours.mode };
  }
  return { installed: true };
}
