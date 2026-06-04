/**
 * Pure JSON-object editor for Claude Code's `settings.json` hook array.
 *
 * Schema (per https://docs.claude.com/en/docs/claude-code/hooks):
 *   {
 *     "hooks": {
 *       "PreToolUse": [
 *         { "matcher": "...", "hooks": [{ "type": "command", "command": "..." }] }
 *       ],
 *       "PostToolUse": [ ... ]
 *     }
 *   }
 *
 * We identify sipcode-owned entries by a stable marker string embedded
 * in the `command` field: "sipcode-pressure" or "sipcode-breakpoint".
 * That way we can upsert + remove without touching unrelated hooks the
 * user has configured.
 *
 * Constraints:
 *  - additive: never modify or remove non-sipcode entries
 *  - idempotent: calling upsert twice yields a deep-equal result
 *  - reversible: removeSipcodeHooks(upsertSipcodeHooks(x)) === x (structurally)
 */
import { HOOK_BREAKPOINT_ID, HOOK_PRESSURE_ID, HOOK_PROXY_ID } from "./types.js";

type Json = unknown;
type JsonObj = { [k: string]: Json };

export interface HookEntryPlan {
  /** "PreToolUse" | "PostToolUse" */
  readonly event: string;
  /** Tool-matcher regex; "*" matches every tool. */
  readonly matcher: string;
  /** Absolute path to the on-disk hook script. */
  readonly scriptPath: string;
  /** Stable sipcode id ("sipcode-pressure" | "sipcode-breakpoint"). */
  readonly id: string;
}

export function buildHookCommand(scriptPath: string): string {
  // Quote the path so spaces in Windows paths survive shell parsing.
  return `node "${scriptPath}"`;
}

function isObj(v: unknown): v is JsonObj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asArr(v: unknown): JsonObj[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj);
}

/** Entry is one of ours iff one of its inner hook commands contains our id. */
function entryIsSipcode(entry: JsonObj, id: string): boolean {
  const inner = entry["hooks"];
  if (!Array.isArray(inner)) return false;
  for (const h of inner) {
    if (!isObj(h)) continue;
    const cmd = h["command"];
    if (typeof cmd === "string" && cmd.includes(id)) return true;
  }
  return false;
}

/** Upsert one sipcode hook plan into a parsed settings.json object. */
export function upsertSipcodeHook(
  settings: JsonObj,
  plan: HookEntryPlan,
): JsonObj {
  const next: JsonObj = { ...settings };
  const hooks = isObj(next["hooks"]) ? { ...(next["hooks"] as JsonObj) } : {};
  const eventArr = asArr(hooks[plan.event]);
  const filtered = eventArr.filter((e) => !entryIsSipcode(e, plan.id));
  const entry: JsonObj = {
    matcher: plan.matcher,
    hooks: [
      {
        type: "command",
        command: buildHookCommand(plan.scriptPath),
      },
    ],
  };
  filtered.push(entry);
  hooks[plan.event] = filtered;
  next["hooks"] = hooks;
  return next;
}

/**
 * Remove sipcode-owned hook entries from a parsed settings.json object.
 *
 * `ids` defaults to every sipcode hook id, so a bare call strips all of them.
 * Pass a narrower list (e.g. `[HOOK_PROXY_ID]`) to remove just one feature's
 * hooks without disturbing the others.
 */
export function removeSipcodeHooks(
  settings: JsonObj,
  ids: readonly string[] = [HOOK_PRESSURE_ID, HOOK_BREAKPOINT_ID, HOOK_PROXY_ID],
): JsonObj {
  if (!isObj(settings["hooks"])) return settings;
  const next: JsonObj = { ...settings };
  const hooks: JsonObj = { ...(next["hooks"] as JsonObj) };
  let touched = false;
  for (const evt of Object.keys(hooks)) {
    const arr = asArr(hooks[evt]);
    const filtered = arr.filter((e) => !ids.some((id) => entryIsSipcode(e, id)));
    if (filtered.length !== arr.length) {
      touched = true;
      if (filtered.length === 0) {
        delete hooks[evt];
      } else {
        hooks[evt] = filtered;
      }
    }
  }
  if (!touched) return settings;
  if (Object.keys(hooks).length === 0) {
    delete next["hooks"];
  } else {
    next["hooks"] = hooks;
  }
  return next;
}

/** Inspect: are both sipcode hooks present? */
export interface SettingsHookState {
  readonly pressureInstalled: boolean;
  readonly breakpointInstalled: boolean;
}

export function inspectSipcodeHooks(settings: JsonObj): SettingsHookState {
  if (!isObj(settings["hooks"])) {
    return { pressureInstalled: false, breakpointInstalled: false };
  }
  const hooks = settings["hooks"] as JsonObj;
  let pressure = false;
  let breakpoint = false;
  for (const evt of Object.keys(hooks)) {
    for (const e of asArr(hooks[evt])) {
      if (entryIsSipcode(e, HOOK_PRESSURE_ID)) pressure = true;
      if (entryIsSipcode(e, HOOK_BREAKPOINT_ID)) breakpoint = true;
    }
  }
  return { pressureInstalled: pressure, breakpointInstalled: breakpoint };
}

/** Parse settings.json text safely; returns {} on any error. */
export function parseSettings(text: string): JsonObj {
  if (text.trim().length === 0) return {};
  try {
    const v = JSON.parse(text);
    return isObj(v) ? v : {};
  } catch {
    return {};
  }
}

/** Render settings.json with 2-space indent + trailing newline. */
export function renderSettings(settings: JsonObj): string {
  return JSON.stringify(settings, null, 2) + "\n";
}
