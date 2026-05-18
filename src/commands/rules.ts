/**
 * `sipcode rules` — install/inspect/switch/uninstall the Output
 * Compression rule pack inside CLAUDE.md.
 *
 * Flags:
 *   --install            add Output Compression block (idempotent)
 *   --mode <m>           switch / install at mode (default | strict | verbose)
 *   --uninstall          remove the block
 *   --diff               show what would change without writing
 *   (no flags)           inspect: show currently active rules + mode
 */
import path from "node:path";
import { promises as nodeFs } from "node:fs";
import { MESSAGES } from "../lib/messages.js";
import { installRules, uninstallRules } from "../modules/rules/install.js";
import { inspectRules } from "../modules/rules/inspect.js";
import { computeDiff } from "../modules/rules/diff.js";
import { isRulesMode, type RulesMode } from "../modules/rules/types.js";

export interface RulesOptions {
  install?: boolean;
  uninstall?: boolean;
  diff?: boolean;
  mode?: string;
}

export interface RulesDeps {
  cwd?: string;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  readFile?: (absPath: string) => Promise<string | undefined>;
  writeFile?: (absPath: string, content: string) => Promise<void>;
}

export interface RulesResult {
  readonly exitCode: 0 | 1;
}

export async function runRules(
  opts: RulesOptions = {},
  deps: RulesDeps = {},
): Promise<RulesResult> {
  const cwd = deps.cwd ?? process.cwd();
  const stdout =
    deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const stderr =
    deps.stderr ?? ((s: string) => process.stderr.write(s + "\n"));
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

  const claudeMdPath = path.join(cwd, "CLAUDE.md");
  const claudeMdRel = "CLAUDE.md";
  const existing = (await readFile(claudeMdPath)) ?? "";

  // Validate --mode early.
  let mode: RulesMode = "default";
  if (opts.mode !== undefined) {
    if (!isRulesMode(opts.mode)) {
      stderr(
        `unknown mode "${opts.mode}". valid modes: default, strict, verbose.`,
      );
      return { exitCode: 1 };
    }
    mode = opts.mode;
  }

  // --uninstall --
  if (opts.uninstall) {
    const result = uninstallRules(existing);
    if (!result.ok) {
      for (const i of result.error) {
        if (i.code === "E005") stderr(MESSAGES.claudeMdUnsafe(claudeMdRel));
        else stderr(`[${i.code}] ${i.message}`);
      }
      return { exitCode: 1 };
    }
    if (result.value === existing) {
      stdout(MESSAGES.rulesNotInstalled);
      return { exitCode: 0 };
    }
    if (opts.diff) {
      const d = computeDiff(existing, result.value);
      stdout(`would uninstall — ${d.summary}`);
      stdout(d.hunk);
      return { exitCode: 0 };
    }
    await writeFile(claudeMdPath, result.value);
    stdout(MESSAGES.rulesUninstalled(claudeMdRel));
    return { exitCode: 0 };
  }

  // --install / --mode (--install is implicit when --mode is passed) --
  const installRequested =
    opts.install === true || opts.mode !== undefined;
  if (installRequested) {
    const targetMode: RulesMode = mode;
    const result = installRules(existing, targetMode);
    if (!result.ok) {
      for (const i of result.error) {
        if (i.code === "E005") stderr(MESSAGES.claudeMdUnsafe(claudeMdRel));
        else stderr(`[${i.code}] ${i.message}`);
      }
      return { exitCode: 1 };
    }

    if (opts.diff) {
      const d = computeDiff(existing, result.value);
      if (d.identical) {
        stdout(MESSAGES.rulesDiffIdentical);
      } else {
        stdout(`would install ${targetMode} mode — ${d.summary}`);
        stdout(d.hunk);
      }
      return { exitCode: 0 };
    }

    if (result.value === existing) {
      stdout(MESSAGES.rulesAlreadyInstalled(targetMode));
      return { exitCode: 0 };
    }

    const before = inspectRules(existing);
    await writeFile(claudeMdPath, result.value);
    if (before.installed && before.mode !== undefined && before.mode !== targetMode) {
      stdout(
        MESSAGES.rulesSwitchedMode(before.mode, targetMode, claudeMdRel),
      );
    } else {
      stdout(MESSAGES.rulesInstalledAt(targetMode, claudeMdRel));
    }
    return { exitCode: 0 };
  }

  // --diff alone (without --install / --mode / --uninstall) -> diff against
  // the recommended default install on whatever currently exists.
  if (opts.diff) {
    const result = installRules(existing, mode);
    if (!result.ok) {
      for (const i of result.error) {
        if (i.code === "E005") stderr(MESSAGES.claudeMdUnsafe(claudeMdRel));
        else stderr(`[${i.code}] ${i.message}`);
      }
      return { exitCode: 1 };
    }
    const d = computeDiff(existing, result.value);
    if (d.identical) {
      stdout(MESSAGES.rulesDiffIdentical);
    } else {
      stdout(`would install ${mode} mode — ${d.summary}`);
      stdout(d.hunk);
    }
    return { exitCode: 0 };
  }

  // No flags -> inspect.
  const state = inspectRules(existing);
  if (!state.installed) {
    stdout(MESSAGES.rulesNotInstalled);
    return { exitCode: 0 };
  }
  stdout(MESSAGES.rulesActive(state.mode ?? "unknown"));
  return { exitCode: 0 };
}
