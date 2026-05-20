/**
 * `sipcode hygiene` — install/inspect/uninstall the Session Hygiene
 * package: CLAUDE.md sub-block + PreToolUse/PostToolUse hook scripts +
 * registration in `~/.claude/settings.json`.
 *
 * Flags:
 *   --install            install everything (idempotent)
 *   --uninstall          remove everything
 *   --diff               show what would change without writing
 *   --check              dry-run pressure check against latest transcript
 *   (no flags)           inspect: show current state
 */
import path from "node:path";
import os from "node:os";
import { promises as nodeFs } from "node:fs";
import { MESSAGES } from "../lib/messages.js";
import {
  installHygieneBlock,
  uninstallHygieneBlock,
} from "../modules/hygiene/install.js";
import { inspectHygiene } from "../modules/hygiene/inspect.js";
import { computeHygieneDiff } from "../modules/hygiene/diff.js";
import {
  buildHookCommand,
  inspectSipcodeHooks,
  parseSettings,
  removeSipcodeHooks,
  renderSettings,
  upsertSipcodeHook,
} from "../modules/hygiene/settingsJson.js";
import {
  HOOK_BREAKPOINT_ID,
  HOOK_PRESSURE_ID,
  type HygieneMode,
} from "../modules/hygiene/types.js";
import {
  breakpointHookScript,
  pressureHookScript,
} from "../modules/hygiene/hookScript.js";
import {
  classifyPressure,
  utilizationFromTranscript,
} from "../modules/hygiene/pressure.js";

export interface HygieneOptions {
  install?: boolean;
  uninstall?: boolean;
  diff?: boolean;
  check?: boolean;
}

export interface HygieneDeps {
  cwd?: string;
  homeDir?: string;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  readFile?: (absPath: string) => Promise<string | undefined>;
  writeFile?: (absPath: string, content: string) => Promise<void>;
  /** Resolve the latest Claude Code transcript path (for --check). */
  latestTranscriptPath?: () => Promise<string | undefined>;
}

export interface HygieneResult {
  readonly exitCode: 0 | 1;
}

interface Paths {
  readonly claudeMd: string;
  readonly claudeMdRel: string;
  readonly settingsJson: string;
  readonly hooksDir: string;
  readonly pressureScript: string;
  readonly breakpointScript: string;
}

function resolvePaths(cwd: string, homeDir: string): Paths {
  const claudeMd = path.join(cwd, "CLAUDE.md");
  const hooksDir = path.join(homeDir, ".claude", "hooks");
  return {
    claudeMd,
    claudeMdRel: toRel(cwd, claudeMd),
    settingsJson: path.join(homeDir, ".claude", "settings.json"),
    hooksDir,
    pressureScript: path.join(hooksDir, "sipcode-pressure.mjs"),
    breakpointScript: path.join(hooksDir, "sipcode-breakpoint.mjs"),
  };
}

export async function runHygiene(
  opts: HygieneOptions = {},
  deps: HygieneDeps = {},
): Promise<HygieneResult> {
  const cwd = deps.cwd ?? process.cwd();
  const homeDir = deps.homeDir ?? os.homedir();
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s + "\n"));
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

  const p = resolvePaths(cwd, homeDir);
  const mode: HygieneMode = "default";

  // Read existing state.
  const existingClaudeMd = (await readFile(p.claudeMd)) ?? "";
  const existingSettingsRaw = (await readFile(p.settingsJson)) ?? "";

  // --check —
  if (opts.check) {
    return runCheck(deps, homeDir, stdout);
  }

  // --uninstall —
  if (opts.uninstall) {
    const nextClaudeMd = uninstallHygieneBlock(existingClaudeMd);
    if (!nextClaudeMd.ok) {
      for (const i of nextClaudeMd.error) {
        if (i.code === "E005") stderr(MESSAGES.claudeMdUnsafe(p.claudeMdRel));
        else stderr(`[${i.code}] ${i.message}`);
      }
      return { exitCode: 1 };
    }
    const parsed = parseSettings(existingSettingsRaw);
    const cleaned = removeSipcodeHooks(parsed);
    const nextSettings = renderSettings(cleaned);

    if (opts.diff) {
      const d = computeHygieneDiff(
        existingClaudeMd,
        nextClaudeMd.value,
        existingSettingsRaw,
        nextSettings,
      );
      if (d.identical) {
        stdout(MESSAGES.hygieneNotInstalled);
        return { exitCode: 0 };
      }
      stdout(`would uninstall — ${d.summary}`);
      if (d.hunk.length > 0) stdout(d.hunk);
      return { exitCode: 0 };
    }

    const claudeMdChanged = nextClaudeMd.value !== existingClaudeMd;
    // Compare canonical JSON to decide if removeSipcodeHooks actually changed
    // anything (i.e. there WAS a sipcode entry to remove).
    const sipcodeWasPresent =
      JSON.stringify(parsed) !== JSON.stringify(cleaned);

    if (!claudeMdChanged && !sipcodeWasPresent) {
      stdout(MESSAGES.hygieneNotInstalled);
      return { exitCode: 0 };
    }

    if (claudeMdChanged) await writeFile(p.claudeMd, nextClaudeMd.value);
    if (sipcodeWasPresent) {
      // If cleaned settings would be empty AND the original file was empty
      // or missing, don't write anything — preserve "settings.json doesn't
      // exist" as a valid state.
      if (
        Object.keys(cleaned).length === 0 &&
        existingSettingsRaw.trim().length === 0
      ) {
        // nothing to write
      } else {
        await writeFile(p.settingsJson, nextSettings);
      }
    }
    stdout(MESSAGES.hygieneUninstalled(p.claudeMdRel));
    return { exitCode: 0 };
  }

  // --install (or implicit when no flags + not yet installed) —
  if (opts.install || opts.diff) {
    const nextClaudeMd = installHygieneBlock(existingClaudeMd, mode);
    if (!nextClaudeMd.ok) {
      for (const i of nextClaudeMd.error) {
        if (i.code === "E005") stderr(MESSAGES.claudeMdUnsafe(p.claudeMdRel));
        else stderr(`[${i.code}] ${i.message}`);
      }
      return { exitCode: 1 };
    }
    const parsed = parseSettings(existingSettingsRaw);
    let nextSettingsObj = upsertSipcodeHook(parsed, {
      event: "PreToolUse",
      matcher: "*",
      scriptPath: p.pressureScript,
      id: HOOK_PRESSURE_ID,
    });
    nextSettingsObj = upsertSipcodeHook(nextSettingsObj, {
      event: "PostToolUse",
      matcher: "*",
      scriptPath: p.breakpointScript,
      id: HOOK_BREAKPOINT_ID,
    });
    const nextSettings = renderSettings(nextSettingsObj);

    if (opts.diff) {
      const d = computeHygieneDiff(
        existingClaudeMd,
        nextClaudeMd.value,
        existingSettingsRaw,
        nextSettings,
      );
      if (d.identical) {
        stdout(MESSAGES.hygieneDiffIdentical);
        return { exitCode: 0 };
      }
      stdout(`would install session hygiene — ${d.summary}`);
      if (d.hunk.length > 0) stdout(d.hunk);
      return { exitCode: 0 };
    }

    const claudeMdChanged = nextClaudeMd.value !== existingClaudeMd;
    const settingsChanged = existingSettingsRaw !== nextSettings;

    // Always (re)write the hook scripts, but skip if they already match —
    // keeps the "byte-identical idempotent" promise.
    const existingPressure = await readFile(p.pressureScript);
    const existingBreakpoint = await readFile(p.breakpointScript);
    const newPressure = pressureHookScript();
    const newBreakpoint = breakpointHookScript();
    const pressureChanged = existingPressure !== newPressure;
    const breakpointChanged = existingBreakpoint !== newBreakpoint;

    if (
      !claudeMdChanged &&
      !settingsChanged &&
      !pressureChanged &&
      !breakpointChanged
    ) {
      stdout(MESSAGES.hygieneAlreadyInstalled());
      return { exitCode: 0 };
    }

    if (claudeMdChanged) await writeFile(p.claudeMd, nextClaudeMd.value);
    if (settingsChanged) await writeFile(p.settingsJson, nextSettings);
    if (pressureChanged) await writeFile(p.pressureScript, newPressure);
    if (breakpointChanged) await writeFile(p.breakpointScript, newBreakpoint);

    stdout(MESSAGES.hygieneInstalled(p.claudeMdRel, p.hooksDir));
    return { exitCode: 0 };
  }

  // No flags -> inspect.
  const parsed = parseSettings(existingSettingsRaw);
  const state = inspectHygiene(existingClaudeMd, parsed);
  const hooks = inspectSipcodeHooks(parsed);
  if (
    !state.blockInstalled &&
    !hooks.pressureInstalled &&
    !hooks.breakpointInstalled
  ) {
    stdout(MESSAGES.hygieneNotInstalled);
    return { exitCode: 0 };
  }
  stdout(MESSAGES.hygieneStatus(state));
  return { exitCode: 0 };
}

async function runCheck(
  deps: HygieneDeps,
  homeDir: string,
  stdout: (s: string) => void,
): Promise<HygieneResult> {
  const transcriptRoot = path.join(homeDir, ".claude", "projects");
  const latest =
    (await (deps.latestTranscriptPath ?? defaultLatestTranscript(homeDir))()) ??
    undefined;
  if (!latest) {
    stdout(MESSAGES.hygieneCheckNoTranscript(transcriptRoot));
    return { exitCode: 0 };
  }
  let content = "";
  try {
    content = await nodeFs.readFile(latest, "utf-8");
  } catch {
    stdout(MESSAGES.hygieneCheckNoTranscript(transcriptRoot));
    return { exitCode: 0 };
  }
  const util = utilizationFromTranscript(content);
  const sample = classifyPressure(util);
  stdout(MESSAGES.hygieneCheckBand(sample.band, util, sample.message));
  return { exitCode: 0 };
}

function defaultLatestTranscript(homeDir: string): () => Promise<string | undefined> {
  return async () => {
    const root = path.join(homeDir, ".claude", "projects");
    let projects: string[];
    try {
      projects = await nodeFs.readdir(root);
    } catch {
      return undefined;
    }
    let best: { full: string; mtimeMs: number } | undefined;
    for (const proj of projects) {
      let files: string[];
      try {
        files = await nodeFs.readdir(path.join(root, proj));
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        const full = path.join(root, proj, f);
        try {
          const s = await nodeFs.stat(full);
          if (!best || s.mtimeMs > best.mtimeMs) {
            best = { full, mtimeMs: s.mtimeMs };
          }
        } catch {
          /* skip */
        }
      }
    }
    return best?.full;
  };
}

function toRel(cwd: string, abs: string): string {
  const rel = path.relative(cwd, abs).replace(/\\/g, "/");
  return rel.length > 0 ? rel : path.basename(abs);
}
