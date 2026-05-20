/**
 * Inspect: read CLAUDE.md + parsed settings.json and report current
 * session-hygiene state. Pure.
 */
import { listSubBlocks } from "../../lib/claudeMd.js";
import {
  SESSION_HYGIENE_BLOCK_NAME,
  isHygieneMode,
  type HygieneState,
} from "./types.js";
import { inspectSipcodeHooks } from "./settingsJson.js";

export function inspectHygiene(
  claudeMdContent: string,
  parsedSettings: Record<string, unknown>,
): HygieneState {
  const subs = listSubBlocks(claudeMdContent);
  const ours = subs?.find((s) => s.name === SESSION_HYGIENE_BLOCK_NAME);
  const blockInstalled = ours !== undefined;
  const blockMode =
    ours && ours.mode !== undefined && isHygieneMode(ours.mode)
      ? ours.mode
      : undefined;
  const hookState = inspectSipcodeHooks(parsedSettings);
  return blockMode !== undefined
    ? {
        blockInstalled,
        blockMode,
        pressureHookInstalled: hookState.pressureInstalled,
        breakpointHookInstalled: hookState.breakpointInstalled,
      }
    : {
        blockInstalled,
        pressureHookInstalled: hookState.pressureInstalled,
        breakpointHookInstalled: hookState.breakpointInstalled,
      };
}
