/**
 * `sipcode init` — interactive setup.
 *
 * Four prompts max:
 *   1. Confirm the project root (default: cwd).
 *   2. Confirm CLAUDE.md injection (default: yes).
 *   3. Confirm budget mode (strict / tighten / off).
 *   4. Output Compression rules mode (default / strict / verbose / skip).
 *
 * After confirmation, it runs the same pipeline as `sipcode manifest`,
 * injects the manifest sub-block into CLAUDE.md, and — if not skipped —
 * also installs the output-compression sub-block.
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import path from "node:path";
import { promises as nodeFs } from "node:fs";
import promptsLib from "prompts";
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import { RealGit, type Git } from "../lib/git.js";
import { MESSAGES } from "../lib/messages.js";
import {
  renderManifestSubBlockBody,
} from "../lib/claudeMd.js";
import { renderRulesBlock } from "../modules/rules/blocks.js";
import { isRulesMode, type RulesMode } from "../modules/rules/types.js";
import { OUTPUT_COMPRESSION_BLOCK_NAME } from "../modules/rules/types.js";
import { runManifest } from "./manifest.js";
import { resolveAgentFromOpts } from "../modules/agents/cli.js";
// v1.6.15 system-setup imports
import {
  installProxyHook,
  proxyHookScriptPath,
  runRewriterModuleUrl,
  hookReadDedupModuleUrl,
  hookAstReadModuleUrl,
} from "../modules/proxy/install.js";
import { generateProxyHookScript } from "../modules/proxy/proxyHookScript.js";
import { parseSettings, renderSettings } from "../modules/hygiene/settingsJson.js";
import { getRegisteredMcpToolCount } from "../mcp/server.js";
// v1.6.16 F-CACHE-DEFER imports
import {
  detectActiveClaudeSessions,
  type ActiveSessionsResult,
} from "../modules/init/sessionDetection.js";
import {
  writePendingMarker,
  type PendingInstallIO,
} from "../modules/init/pendingInstall.js";
import { promises as nodeFsPromises } from "node:fs";

export interface InitOptions {
  /** Tighten on first run (skip the prompt). */
  tighten?: boolean;
  /** Skip CLAUDE.md injection (skip the prompt). */
  noClaudeMd?: boolean;
  /** Force non-interactive: accept all defaults. */
  yes?: boolean;
  /**
   * Pre-select an output-compression rules mode (skips the prompt).
   * "skip" means don't install rules. Default: "default".
   */
  rulesMode?: RulesMode | "skip";
  /** Which agent to target: "claude-code" | "cursor" | "auto" (default). */
  agent?: string;
  /** v1.6.15: skip the proxy hook install step. Default: false (install). */
  noProxy?: boolean;
  /** v1.6.15: skip the install marker for `sipcode impact`. Default: false (set marker). */
  noMarker?: boolean;
  /** v1.6.15: skip the MCP tool count verification. Default: false (verify). */
  noVerifyMcp?: boolean;
  /**
   * v1.6.16 F-CACHE-DEFER: install even when an active Claude Code session
   * is detected. Without this flag, the settings.json write is deferred to
   * protect Anthropic's prompt cache; a marker is written so the next quiet
   * sipcode invocation applies the install.
   */
  force?: boolean;
}

export interface InitDeps {
  fs?: FileSystem;
  clock?: Clock;
  env?: ProcessEnv;
  git?: Git;
  cwd?: string;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  /** Pluggable prompter (default: `prompts`). */
  prompt?: (questions: PromptQuestion[]) => Promise<Record<string, unknown>>;
  /** Pluggable writeFile so InMemoryFs tests don't hit the disk. */
  writeFile?: (absPath: string, content: string) => Promise<void>;
  /** Pluggable readFile (for CLAUDE.md existing-content check). */
  readFile?: (absPath: string) => Promise<string | undefined>;
  /**
   * v1.6.15: home directory for system-setup (proxy hook + install marker
   * + MCP verify). If omitted, system-setup is SKIPPED — important for
   * existing tests that don't want to touch the real `~/.claude/`.
   * Production CLI passes `os.homedir()` explicitly.
   */
  homeDir?: string;
  /**
   * v1.6.15: pluggable Claude Code detection. Default impl checks
   * existence of `homeDir/.claude/`. Tests can pass a stub.
   */
  detectClaudeCode?: (homeDir: string) => Promise<{ installed: boolean; version: string | null }>;
  /**
   * v1.6.15: pluggable MCP tool-count verifier. Default uses the static
   * registry from `src/mcp/server.ts`. Tests can pass a stub.
   */
  verifyMcpToolCount?: () => Promise<number>;
}

export interface PromptQuestion {
  type: "text" | "confirm" | "select";
  name: string;
  message: string;
  initial?: unknown;
  choices?: Array<{ title: string; value: string }>;
}

export interface InitResult {
  readonly exitCode: 0 | 1;
  readonly manifestPath?: string;
  readonly claudeMdPath?: string;
  readonly rulesMode?: RulesMode | "skip";
}

export async function runInit(
  opts: InitOptions = {},
  deps: InitDeps = {},
): Promise<InitResult> {
  const fs = deps.fs ?? new RealFileSystem();
  const clock = deps.clock ?? new RealClock();
  const env = deps.env ?? new RealProcessEnv();
  const git = deps.git ?? new RealGit();
  const cwd = deps.cwd ?? process.cwd();
  const stdout =
    deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const stderr =
    deps.stderr ?? ((s: string) => process.stderr.write(s + "\n"));
  const prompt = deps.prompt ?? defaultPrompter;
  const writeFile =
    deps.writeFile ??
    (async (p, c) => {
      await nodeFs.mkdir(path.dirname(p), { recursive: true });
      await nodeFs.writeFile(p, c, "utf-8");
    });
  const readFile =
    deps.readFile ??
    (async (p) => {
      try {
        return await nodeFs.readFile(p, "utf-8");
      } catch {
        return undefined;
      }
    });

  stdout("sipcode init — setting this project up.");
  stdout("");

  // -- Prompts (skipped under --yes) --
  const answers = opts.yes
    ? {
        root: cwd,
        injectClaudeMd: !opts.noClaudeMd,
        budgetMode: opts.tighten ? "tighten" : "strict",
        rulesMode: opts.rulesMode ?? "default",
      }
    : await prompt([
        {
          type: "text",
          name: "root",
          message: "project root",
          initial: cwd,
        },
        {
          type: "confirm",
          name: "injectClaudeMd",
          message: "inject a sipcode block into CLAUDE.md?",
          initial: !opts.noClaudeMd,
        },
        {
          type: "select",
          name: "budgetMode",
          message: "manifest budget",
          choices: [
            { title: "strict (refuse if over 2k tokens)", value: "strict" },
            { title: "tighten (auto-drop low-signal sections)", value: "tighten" },
            { title: "off (--no-budget)", value: "off" },
          ],
          initial: opts.tighten ? 1 : 0,
        },
        {
          type: "select",
          name: "rulesMode",
          message: "install output compression rules?",
          choices: [
            { title: "default (recommended — diff edits, no preamble)", value: "default" },
            { title: "strict (telegraphic — for power users)", value: "strict" },
            { title: "verbose (learning mode — extra context)", value: "verbose" },
            { title: "skip (don't install rules)", value: "skip" },
          ],
          initial: 0,
        },
      ]);

  const root = String(answers["root"] ?? cwd);
  const injectClaudeMd = Boolean(answers["injectClaudeMd"]);
  const budgetMode = String(answers["budgetMode"] ?? "strict");
  const rulesModeRaw = String(answers["rulesMode"] ?? "default");
  const rulesMode: RulesMode | "skip" =
    rulesModeRaw === "skip"
      ? "skip"
      : isRulesMode(rulesModeRaw)
      ? rulesModeRaw
      : "default";

  // -- Manifest --
  const manifestResult = await runManifest(
    {
      budget: budgetMode !== "off",
      tighten: budgetMode === "tighten",
    },
    {
      fs,
      clock,
      env,
      git,
      cwd: root,
      stdout,
      stderr,
      writeFile,
    },
  );

  if (manifestResult.exitCode !== 0) {
    return { exitCode: 1 };
  }

  let claudeMdPath: string | undefined;

  // -- Rules-file injection (agent-aware) --
  if (injectClaudeMd) {
    const resolved = await resolveAgentFromOpts({
      agent: opts.agent,
      fs,
      env,
      cwd: root,
      stdout,
      stderr,
    });
    if (!resolved.ok) return { exitCode: 1 };
    const agent = resolved.agent;

    // Read existing rules content via the readFile seam first; fall back to
    // the agent's reader. The legacy claude-code path uses the readFile dep
    // for CLAUDE.md, so we preserve that behavior here.
    const candidatePath = agent.rulesPathCandidates(root)[0]!;
    let existingContent = await readFile(candidatePath);
    if (existingContent === undefined) {
      const ar = await agent.readRulesFile({ fs, env, clock }, root);
      existingContent = ar?.content ?? "";
    }

    const manifestBody = renderManifestSubBlockBody({
      manifestPath: ".sipcode/manifest.md",
      generatedAt: manifestResult.manifestPath
        ? `manifest @ .sipcode/manifest.md`
        : "now",
    });

    // Compose both sub-blocks (manifest + optional output-compression) in
    // one upsert chain so we issue a single writeFile per file.
    const manifestWrite = await agent.writeRulesBlock(
      { fs, env, clock },
      root,
      { name: "manifest", body: manifestBody },
      async () => {
        // no-op; capture via return value
      },
      existingContent,
    );
    if (!manifestWrite.ok) {
      for (const i of manifestWrite.error) {
        if (i.code === "E005")
          stderr(MESSAGES.claudeMdUnsafe(candidatePath));
        else stderr(`[${i.code}] ${i.message}`);
      }
      return { exitCode: 1 };
    }
    claudeMdPath = manifestWrite.value.path;
    let nextContent = manifestWrite.value.content;

    if (rulesMode !== "skip") {
      const rulesBody = renderRulesBlock(rulesMode).body;
      const rulesWrite = await agent.writeRulesBlock(
        { fs, env, clock },
        root,
        {
          name: OUTPUT_COMPRESSION_BLOCK_NAME,
          mode: rulesMode,
          body: rulesBody,
        },
        async () => {},
        nextContent,
      );
      if (!rulesWrite.ok) {
        for (const i of rulesWrite.error) {
          if (i.code === "E005") stderr(MESSAGES.claudeMdUnsafe(claudeMdPath));
          else stderr(`[${i.code}] ${i.message}`);
        }
        return { exitCode: 1 };
      }
      nextContent = rulesWrite.value.content;
    }

    await writeFile(claudeMdPath, nextContent);
    stdout(
      `injected sipcode block into ${toPosix(path.relative(root, claudeMdPath))}`,
    );
    if (rulesMode !== "skip") {
      stdout(`installed output compression rules (${rulesMode} mode).`);
    }
  }

  // v1.6.15: system-setup (proxy hook + install marker + MCP verify)
  // runs only when a homeDir was explicitly provided. Existing tests that
  // don't pass `homeDir` get a SKIPPED system-setup, so they keep their
  // current behavior. Production CLI passes os.homedir() explicitly.
  const systemSetupResult = deps.homeDir
    ? await runSystemSetup(
        {
          noProxy: opts.noProxy ?? false,
          noMarker: opts.noMarker ?? false,
          noVerifyMcp: opts.noVerifyMcp ?? false,
          force: opts.force ?? false,
        },
        {
          homeDir: deps.homeDir,
          cwd: root,
          rulesMode,
          readFile,
          writeFile,
          detectClaudeCode: deps.detectClaudeCode ?? defaultDetectClaudeCode,
          verifyMcpToolCount:
            deps.verifyMcpToolCount ?? (async () => getRegisteredMcpToolCount()),
          now: () => clock.now(),
        },
      )
    : null;

  // Render the style-C SETUP card. Preserves the legacy single-line output
  // when verbose system-setup isn't applicable (e.g. existing tests).
  if (systemSetupResult) {
    stdout("");
    stdout(
      formatSetupCard({
        manifestRelativePath: manifestResult.manifestPath
          ? toPosix(path.relative(root, manifestResult.manifestPath))
          : null,
        rulesInstalled: injectClaudeMd && rulesMode !== "skip",
        rulesMode,
        claudeMdRelativePath: claudeMdPath
          ? toPosix(path.relative(root, claudeMdPath))
          : null,
        systemSetup: systemSetupResult,
      }),
    );
  } else {
    stdout("");
    stdout("done. sip your tokens.");
  }

  return {
    exitCode: 0,
    rulesMode,
    ...(manifestResult.manifestPath !== undefined
      ? { manifestPath: manifestResult.manifestPath }
      : {}),
    ...(claudeMdPath !== undefined ? { claudeMdPath } : {}),
  };
}

// ─── v1.6.15: System setup (proxy hook + install marker + MCP verify) ──

export type StepStatus =
  | { kind: "ok"; detail?: string }
  | { kind: "skipped"; reason: string }
  | { kind: "deferred"; reason: string }
  | { kind: "failed"; reason: string };

export interface SystemSetupResult {
  claudeCodeDetected: StepStatus;
  settingsWritable: StepStatus;
  proxyHook: StepStatus;
  installMarker: StepStatus;
  mcpVerify: StepStatus;
}

export interface SystemSetupOptions {
  noProxy: boolean;
  noMarker: boolean;
  noVerifyMcp: boolean;
  /** v1.6.16 F-CACHE-DEFER. Bypass active-session detection. Default: false. */
  force?: boolean;
}

export interface SystemSetupDeps {
  homeDir: string;
  cwd: string;
  rulesMode: RulesMode | "skip";
  readFile: (absPath: string) => Promise<string | undefined>;
  writeFile: (absPath: string, content: string) => Promise<void>;
  detectClaudeCode: (
    homeDir: string,
  ) => Promise<{ installed: boolean; version: string | null }>;
  verifyMcpToolCount: () => Promise<number>;
  now: () => Date;
  /**
   * v1.6.16 F-CACHE-DEFER. Detect active Claude Code sessions to decide
   * whether to defer the settings.json write. Optional; default uses
   * node:fs to scan ~/.claude/projects.
   */
  detectActiveSessions?: (homeDir: string) => Promise<ActiveSessionsResult>;
  /**
   * v1.6.16 F-CACHE-DEFER. Write the pending-install marker when the
   * settings.json write is deferred. Optional; default reuses readFile +
   * writeFile + now to build a PendingInstallIO and call writePendingMarker.
   */
  writeDeferredMarker?: (input: {
    homeDir: string;
    scriptPath: string;
    settingsPath: string;
  }) => Promise<void>;
}

/**
 * Run the v1.6.15 system-setup steps. Each step degrades to a `skipped` or
 * `failed` status rather than throwing — init must remain useful even when
 * one piece (e.g. MCP smoke) can't run. Order matters: detection gates the
 * later steps.
 */
export async function runSystemSetup(
  opts: SystemSetupOptions,
  deps: SystemSetupDeps,
): Promise<SystemSetupResult> {
  const result: SystemSetupResult = {
    claudeCodeDetected: { kind: "skipped", reason: "not yet checked" },
    settingsWritable: { kind: "skipped", reason: "depends on detection" },
    proxyHook: { kind: "skipped", reason: "depends on settings" },
    installMarker: { kind: "skipped", reason: "deferred until rules complete" },
    mcpVerify: { kind: "skipped", reason: "depends on detection" },
  };

  // Step 1: detect Claude Code.
  const detection = await deps.detectClaudeCode(deps.homeDir);
  if (!detection.installed) {
    result.claudeCodeDetected = {
      kind: "skipped",
      reason: "no ~/.claude directory found",
    };
    return result;
  }
  result.claudeCodeDetected = {
    kind: "ok",
    detail: detection.version ?? "version unknown",
  };

  // Step 2: settings.json writable check.
  const settingsPath = path.join(deps.homeDir, ".claude", "settings.json");
  const existingSettings = await deps.readFile(settingsPath);
  // `undefined` from readFile means missing; that's fine — we can create.
  // We don't actually test write permissions here (would require a touch);
  // the proxy install step below surfaces any write failures.
  result.settingsWritable = { kind: "ok", detail: "writable" };

  // Step 3: proxy hook install (with v1.6.16 F-CACHE-DEFER gate).
  if (opts.noProxy) {
    result.proxyHook = { kind: "skipped", reason: "--no-proxy flag" };
  } else {
    // F-CACHE-DEFER: when an active Claude Code session exists, the
    // settings.json write would invalidate Anthropic's prompt cache for
    // that session. We defer the write and leave a marker that any later
    // sipcode invocation outside an active session will pick up and apply.
    // --force bypasses this check.
    let activeSessions: ActiveSessionsResult | null = null;
    if (!opts.force) {
      try {
        const detect =
          deps.detectActiveSessions ?? defaultDetectActiveSessions;
        activeSessions = await detect(deps.homeDir);
      } catch {
        // Defensive: detection failure must not block install.
        activeSessions = null;
      }
    }

    const scriptPath = proxyHookScriptPath(deps.homeDir);
    const newScript = generateProxyHookScript(
      runRewriterModuleUrl(),
      hookReadDedupModuleUrl(),
      hookAstReadModuleUrl(),
    );

    if (activeSessions?.active) {
      // Defer the settings.json write. The script file itself does NOT
      // invalidate the prompt cache (Claude Code only reads settings.json
      // to learn about hooks, not the script content), so we always write
      // the script. The marker tells future sipcode invocations to apply
      // the settings.json change later.
      try {
        const existingScript = await deps.readFile(scriptPath);
        if (existingScript !== newScript) {
          await deps.writeFile(scriptPath, newScript);
        }
        const writeMarker =
          deps.writeDeferredMarker ?? defaultWriteDeferredMarker(deps);
        await writeMarker({
          homeDir: deps.homeDir,
          scriptPath,
          settingsPath,
        });
        const count = activeSessions.count;
        const word = count === 1 ? "session" : "sessions";
        result.proxyHook = {
          kind: "deferred",
          reason: `${count} active claude code ${word} detected; settings.json write deferred to protect prompt cache. Auto-applies on next quiet sipcode command, or pass --force.`,
        };
      } catch (err) {
        result.proxyHook = {
          kind: "failed",
          reason: err instanceof Error ? err.message : "unknown error",
        };
      }
    } else {
      // Normal install path (no active sessions, or --force, or detection
      // unavailable). Existing v1.6.15 logic.
      try {
        const existingScript = await deps.readFile(scriptPath);
        const parsed = parseSettings(existingSettings ?? "");
        const nextObj = installProxyHook(parsed, scriptPath);
        const nextSettings = renderSettings(nextObj);
        const scriptChanged = existingScript !== newScript;
        const settingsChanged = (existingSettings ?? "") !== nextSettings;
        if (!scriptChanged && !settingsChanged) {
          result.proxyHook = { kind: "ok", detail: "already installed" };
        } else {
          if (scriptChanged) await deps.writeFile(scriptPath, newScript);
          if (settingsChanged)
            await deps.writeFile(settingsPath, nextSettings);
          result.proxyHook = {
            kind: "ok",
            detail: "installed (signature v4)",
          };
        }
      } catch (err) {
        result.proxyHook = {
          kind: "failed",
          reason: err instanceof Error ? err.message : "unknown error",
        };
      }
    }
  }

  // Step 4: install marker for `sipcode impact`. Uses rules timestamp slot —
  // semantically the closest existing field. v1.6.16 may add a dedicated
  // `proxyInstalledAt` field.
  if (opts.noMarker) {
    result.installMarker = { kind: "skipped", reason: "--no-marker flag" };
  } else if (deps.rulesMode === "skip") {
    result.installMarker = {
      kind: "skipped",
      reason: "rules mode is 'skip' — no marker to set",
    };
  } else if (result.proxyHook.kind === "deferred") {
    // F-CACHE-DEFER: don't set the impact baseline until the proxy actually
    // installs. Otherwise `sipcode impact` would attribute the deferral
    // window to "with sipcode active" and skew the before/after delta.
    result.installMarker = {
      kind: "deferred",
      reason: "proxy install deferred; baseline starts when proxy applies",
    };
  } else {
    try {
      // Write through deps.writeFile so tests can intercept failures.
      // Mirror the v1 schema from src/lib/install-state.ts: merge with
      // existing state when present, write the canonical JSON form.
      const markerPath = path.join(deps.cwd, ".sipcode", "install-state.json");
      const existing = await deps.readFile(markerPath);
      let prior: Record<string, unknown> = {};
      if (existing) {
        try {
          prior = JSON.parse(existing);
        } catch {
          // Corrupt existing state — overwrite cleanly.
          prior = {};
        }
      }
      const next = {
        ...prior,
        rulesInstalledAt: deps.now().toISOString(),
        rulesMode: deps.rulesMode,
        schemaVersion: "sipcode-install-state/1" as const,
      };
      await deps.writeFile(markerPath, JSON.stringify(next, null, 2));
      result.installMarker = {
        kind: "ok",
        detail: "impact baseline starts now",
      };
    } catch (err) {
      result.installMarker = {
        kind: "failed",
        reason: err instanceof Error ? err.message : "unknown error",
      };
    }
  }

  // Step 5: MCP verify.
  if (opts.noVerifyMcp) {
    result.mcpVerify = { kind: "skipped", reason: "--no-verify-mcp flag" };
  } else {
    try {
      const count = await deps.verifyMcpToolCount();
      result.mcpVerify = {
        kind: "ok",
        detail: `${count} tools registered`,
      };
    } catch (err) {
      result.mcpVerify = {
        kind: "failed",
        reason: err instanceof Error ? err.message : "unknown error",
      };
    }
  }

  return result;
}

/**
 * Default Claude Code detection: checks for the existence of `~/.claude/`.
 * Doesn't try to spawn `claude --version` (cross-platform headache) — the
 * presence of the directory is the load-bearing signal.
 */
async function defaultDetectClaudeCode(
  homeDir: string,
): Promise<{ installed: boolean; version: string | null }> {
  try {
    await nodeFs.access(path.join(homeDir, ".claude"));
    return { installed: true, version: null };
  } catch {
    return { installed: false, version: null };
  }
}

/**
 * v1.6.16 F-CACHE-DEFER: real-filesystem implementation of active-session
 * detection. Production CLI uses this; tests inject a mock via
 * `SystemSetupDeps.detectActiveSessions`.
 */
async function defaultDetectActiveSessions(
  homeDir: string,
): Promise<ActiveSessionsResult> {
  return detectActiveClaudeSessions({
    homeDir,
    io: {
      async listDir(p) {
        return nodeFsPromises.readdir(p);
      },
      async stat(p) {
        try {
          const s = await nodeFsPromises.stat(p);
          return { mtimeMs: s.mtimeMs, isDirectory: s.isDirectory() };
        } catch {
          return null;
        }
      },
      now() {
        return new Date();
      },
    },
  });
}

/**
 * v1.6.16 F-CACHE-DEFER: build a default `writeDeferredMarker` that reuses
 * the SystemSetupDeps' readFile/writeFile/now. Tests can override the whole
 * function via `SystemSetupDeps.writeDeferredMarker`.
 */
function defaultWriteDeferredMarker(deps: SystemSetupDeps) {
  return async (input: {
    homeDir: string;
    scriptPath: string;
    settingsPath: string;
  }): Promise<void> => {
    const io: PendingInstallIO = {
      async readFile(p) {
        const v = await deps.readFile(p);
        return v ?? null;
      },
      writeFile: deps.writeFile,
      async deleteFile(p) {
        try {
          await nodeFsPromises.unlink(p);
        } catch {
          // ignore — missing is fine
        }
      },
      now: deps.now,
    };
    await writePendingMarker(input, io);
  };
}

// ─── v1.6.15: style-C card formatter ────────────────────────────────────

const SETUP_CARD_RULE = "  " + "━".repeat(71);

interface SetupCardInput {
  manifestRelativePath: string | null;
  rulesInstalled: boolean;
  rulesMode: RulesMode | "skip";
  claudeMdRelativePath: string | null;
  systemSetup: SystemSetupResult;
}

/**
 * Render the v1.6.15 style-C SETUP card. Pure function — output is
 * deterministic given the input, so tests can character-match.
 */
export function formatSetupCard(input: SetupCardInput): string {
  const lines: string[] = [];
  lines.push("  SETUP");
  lines.push("");

  // Project manifest row.
  if (input.manifestRelativePath) {
    lines.push(row("✓", "project manifest", input.manifestRelativePath));
  } else {
    lines.push(row("✗", "project manifest", "not generated"));
  }

  // CLAUDE.md / AGENTS.md row.
  if (input.claudeMdRelativePath) {
    const detail = input.rulesInstalled
      ? `manifest + output-compression rules (${input.rulesMode} mode)`
      : "manifest";
    lines.push(row("✓", "rules file updated", `${input.claudeMdRelativePath}  ${detail}`));
  }

  // System-setup rows (only render if attempted).
  const s = input.systemSetup;
  lines.push(stepRow("Claude Code detected", s.claudeCodeDetected));
  lines.push(stepRow("~/.claude/settings.json", s.settingsWritable));
  lines.push(stepRow("proxy hook installed", s.proxyHook));
  lines.push(stepRow("install marker set", s.installMarker));
  lines.push(stepRow("MCP server verified", s.mcpVerify));

  lines.push("");
  lines.push(SETUP_CARD_RULE);
  lines.push("");

  // Footer message + next steps.
  const partial =
    s.claudeCodeDetected.kind !== "ok" ||
    s.proxyHook.kind === "failed" ||
    s.proxyHook.kind === "skipped" ||
    s.proxyHook.kind === "deferred";
  if (s.claudeCodeDetected.kind !== "ok") {
    lines.push("  partial setup. install Claude Code separately to also enable the proxy + MCP.");
    lines.push("");
    lines.push("  ▸ reload your agent to pick up the new project rules");
  } else if (s.proxyHook.kind === "deferred") {
    lines.push("  proxy install deferred to protect your active Claude Code session's prompt cache.");
    lines.push("");
    lines.push("  ▸ auto-applies on your next sipcode command outside an active session");
    lines.push("  ▸ or run `sipcode init --force` to install now (will invalidate prompt cache)");
  } else if (!partial) {
    lines.push("  ready. your next Claude Code session will use Sipcode automatically.");
    lines.push("");
    lines.push("  ▸ verify in 5 minutes:  sipcode drift");
    lines.push("  ▸ measure delta in 3-7 days:  sipcode impact");
  } else {
    lines.push("  partial setup. one or more system steps were skipped or failed.");
    lines.push("");
    lines.push("  ▸ details above; re-run sipcode init to retry, or sipcode proxy --install manually");
  }

  return lines.join("\n");
}

function stepRow(label: string, status: StepStatus): string {
  if (status.kind === "ok") return row("✓", label, status.detail ?? "");
  if (status.kind === "skipped") return row("⏵", label, status.reason);
  if (status.kind === "deferred") return row("⏸", label, status.reason);
  return row("✗", label, status.reason);
}

function row(mark: string, label: string, detail: string): string {
  // Mark + space + label padded to 36 chars + detail.
  const labelPadded = label.padEnd(36, " ");
  return `  ${mark} ${labelPadded}${detail}`;
}

async function defaultPrompter(
  questions: PromptQuestion[],
): Promise<Record<string, unknown>> {
  // Map to prompts-lib's expected shape.
  const mapped = questions.map((q) => {
    const base = {
      type: q.type,
      name: q.name,
      message: q.message,
    } as Record<string, unknown>;
    if (q.initial !== undefined) base["initial"] = q.initial;
    if (q.choices) base["choices"] = q.choices;
    return base;
  });
  // prompts is typed loosely; cast at the seam.
  const res = await (
    promptsLib as unknown as (q: unknown) => Promise<Record<string, unknown>>
  )(mapped);
  return res;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}
