/**
 * `sipcode proxy` — install/uninstall/diff/stats the runtime input-rewriting
 * proxy: a PreToolUse hook that rewrites tool inputs so tools produce
 * naturally-compact output (e.g. `git status` → `git status -s`).
 *
 * Flags:
 *   --install     write the hook script + register the PreToolUse hook (idempotent)
 *   --uninstall   remove the hook entry + delete the hook script
 *   --diff        show what would change without writing
 *   --stats       show accumulated rewrite stats
 *   --json        machine-readable output (with --stats)
 *   (no flags)    inspect: show whether the proxy is installed
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import path from "node:path";
import os from "node:os";
import { promises as nodeFs } from "node:fs";
import { parseSettings, renderSettings } from "../modules/hygiene/settingsJson.js";
import {
  installProxyHook,
  uninstallProxyHook,
  proxyHookScriptPath,
  runRewriterModuleUrl,
  hookReadDedupModuleUrl,
} from "../modules/proxy/install.js";
import { generateProxyHookScript } from "../modules/proxy/proxyHookScript.js";
import { readReport } from "../modules/proxy/stats-store.js";
import { renderProxyReport } from "../modules/proxy/format-terminal.js";

export interface ProxyOptions {
  install?: boolean;
  uninstall?: boolean;
  diff?: boolean;
  stats?: boolean;
  json?: boolean;
}

export interface ProxyDeps {
  homeDir?: string;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  readFile?: (absPath: string) => Promise<string | undefined>;
  writeFile?: (absPath: string, content: string) => Promise<void>;
  removeFile?: (absPath: string) => Promise<void>;
}

export interface ProxyResult {
  readonly exitCode: 0 | 1;
}

export async function runProxy(
  opts: ProxyOptions = {},
  deps: ProxyDeps = {},
): Promise<ProxyResult> {
  const homeDir = deps.homeDir ?? os.homedir();
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const readFile =
    deps.readFile ??
    (async (p: string) => {
      try {
        return await nodeFs.readFile(p, "utf-8");
      } catch {
        return undefined;
      }
    });
  const writeFile =
    deps.writeFile ??
    (async (p: string, c: string) => {
      await nodeFs.mkdir(path.dirname(p), { recursive: true });
      await nodeFs.writeFile(p, c, "utf-8");
    });
  const removeFile =
    deps.removeFile ??
    (async (p: string) => {
      try {
        await nodeFs.rm(p, { force: true });
      } catch {
        /* best-effort */
      }
    });

  const settingsPath = path.join(homeDir, ".claude", "settings.json");
  const scriptPath = proxyHookScriptPath(homeDir);
  const statsDir = path.join(homeDir, ".sipcode", "proxy-stats");

  // --stats —
  if (opts.stats) {
    const report = await readReport(statsDir);
    stdout(opts.json ? JSON.stringify(report, null, 2) : renderProxyReport(report));
    return { exitCode: 0 };
  }

  const existingRaw = (await readFile(settingsPath)) ?? "";
  const parsed = parseSettings(existingRaw);

  // --uninstall —
  if (opts.uninstall) {
    const cleaned = uninstallProxyHook(parsed);
    const changed = JSON.stringify(parsed) !== JSON.stringify(cleaned);
    if (opts.diff) {
      stdout(
        changed
          ? `would uninstall sipcode proxy: remove hook from ${settingsPath} and delete ${scriptPath}`
          : "sipcode proxy is not installed",
      );
      return { exitCode: 0 };
    }
    if (!changed) {
      stdout("sipcode proxy is not installed");
      return { exitCode: 0 };
    }
    await writeFile(settingsPath, renderSettings(cleaned));
    await removeFile(scriptPath);
    stdout("sipcode proxy uninstalled.");
    return { exitCode: 0 };
  }

  // --install / --diff —
  if (opts.install || opts.diff) {
    const nextObj = installProxyHook(parsed, scriptPath);
    const nextSettings = renderSettings(nextObj);
    const newScript = generateProxyHookScript(
      runRewriterModuleUrl(),
      hookReadDedupModuleUrl(),
    );
    const existingScript = await readFile(scriptPath);
    const settingsChanged = existingRaw !== nextSettings;
    const scriptChanged = existingScript !== newScript;

    if (opts.diff) {
      if (!settingsChanged && !scriptChanged) {
        stdout("sipcode proxy already installed (no changes).");
        return { exitCode: 0 };
      }
      stdout("would install sipcode proxy:");
      if (scriptChanged) stdout(`  write hook script   → ${scriptPath}`);
      if (settingsChanged) stdout(`  register PreToolUse  → ${settingsPath}`);
      return { exitCode: 0 };
    }

    if (!settingsChanged && !scriptChanged) {
      stdout("sipcode proxy already installed.");
      return { exitCode: 0 };
    }
    if (scriptChanged) await writeFile(scriptPath, newScript);
    if (settingsChanged) await writeFile(settingsPath, nextSettings);
    stdout(
      "sipcode proxy installed — PreToolUse rewriting active. Restart Claude Code to load the hook.",
    );
    return { exitCode: 0 };
  }

  // No flags → inspect.
  const installed = JSON.stringify(parsed).includes("sipcode-proxy");
  stdout(
    installed
      ? "sipcode proxy: installed."
      : "sipcode proxy: not installed. Run `sipcode proxy --install`.",
  );
  return { exitCode: 0 };
}
