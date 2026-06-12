/**
 * Pure install/uninstall helpers for the proxy PreToolUse hook.
 *
 * All filesystem I/O lives in the CLI command (`src/commands/proxy.ts`);
 * everything here is a pure transform on a parsed settings.json object plus
 * deterministic path/URL builders, so it is trivially testable.
 */
import { join } from "node:path";
import {
  upsertSipcodeHook,
  removeSipcodeHooks,
} from "../hygiene/settingsJson.js";
import { HOOK_PROXY_ID } from "../hygiene/types.js";

export { HOOK_PROXY_ID };

type JsonObj = Record<string, unknown>;

/** Absolute path the generated hook `.mjs` is written to. */
export function proxyHookScriptPath(homeDir: string): string {
  return join(homeDir, ".claude", "hooks", "sipcode-proxy.mjs");
}

/**
 * `file://` URL of the compiled `runRewriter.js`, resolved relative to this
 * module. After build both sit in `dist/modules/proxy/`, so this is stable
 * across global installs and version bumps.
 */
export function runRewriterModuleUrl(): string {
  return new URL("./runRewriter.js", import.meta.url).href;
}

/** `file://` URL of the compiled `hookReadDedup.js`. Same dist layout. */
export function hookReadDedupModuleUrl(): string {
  return new URL("./hookReadDedup.js", import.meta.url).href;
}

/** `file://` URL of the compiled `hookAstRead.js`. v1.7.0+. */
export function hookAstReadModuleUrl(): string {
  return new URL("./hookAstRead.js", import.meta.url).href;
}

/** Add (or replace) the proxy PreToolUse hook entry. Idempotent. */
export function installProxyHook(settings: JsonObj, scriptPath: string): JsonObj {
  return upsertSipcodeHook(settings, {
    event: "PreToolUse",
    matcher: "*",
    scriptPath,
    id: HOOK_PROXY_ID,
  });
}

/** Remove only the proxy hook entry; leaves other sipcode hooks intact. */
export function uninstallProxyHook(settings: JsonObj): JsonObj {
  return removeSipcodeHooks(settings, [HOOK_PROXY_ID]);
}
