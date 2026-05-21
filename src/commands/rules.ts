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
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import path from "node:path";
import { promises as nodeFs } from "node:fs";
import { MESSAGES } from "../lib/messages.js";
import { installRules, uninstallRules } from "../modules/rules/install.js";
import { inspectRules } from "../modules/rules/inspect.js";
import { computeDiff } from "../modules/rules/diff.js";
import { isRulesMode, type RulesMode } from "../modules/rules/types.js";
import { resolveAgentFromOpts } from "../modules/agents/cli.js";
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import { renderRulesBlock } from "../modules/rules/blocks.js";
import { OUTPUT_COMPRESSION_BLOCK_NAME } from "../modules/rules/types.js";

export interface RulesOptions {
  install?: boolean;
  uninstall?: boolean;
  diff?: boolean;
  mode?: string;
  /** Which agent to target: "claude-code" | "cursor" | "auto" (default). */
  agent?: string;
}

export interface RulesDeps {
  cwd?: string;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  readFile?: (absPath: string) => Promise<string | undefined>;
  writeFile?: (absPath: string, content: string) => Promise<void>;
  fs?: FileSystem;
  env?: ProcessEnv;
  clock?: Clock;
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

  const fs = deps.fs ?? new RealFileSystem();
  const env = deps.env ?? new RealProcessEnv();
  const clock = deps.clock ?? new RealClock();

  // Resolve which agent the user is targeting. When --agent is omitted, this
  // auto-detects; the claude-code adapter mirrors the legacy CLAUDE.md path.
  const resolvedAgent = await resolveAgentFromOpts({
    agent: opts.agent,
    fs,
    env,
    cwd,
    stdout,
    stderr,
  });
  if (!resolvedAgent.ok) return { exitCode: 1 };
  const agent = resolvedAgent.agent;

  // Use the agent's first preferred rules path as the target. For claude-code
  // this is `<cwd>/CLAUDE.md` (legacy behavior). For cursor we read whatever
  // exists (or default to .cursor/rules/sipcode.mdc).
  const agentRead = await agent.readRulesFile({ fs, env, clock }, cwd);
  const targetPath =
    agentRead?.path ?? agent.rulesPathCandidates(cwd)[0]!;
  // Backward-compat: when no agent-read returned content and the file is
  // CLAUDE.md, try the readFile seam (existing tests rely on this).
  let existing = agentRead?.content;
  if (existing === undefined) {
    existing = (await readFile(targetPath)) ?? "";
  }
  const claudeMdPath = targetPath;
  const claudeMdRel = toRel(cwd, targetPath);

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
    const nextContent = await computeUninstall(agent, existing, {
      fs,
      env,
      clock,
      cwd,
    });
    if (!nextContent.ok) {
      for (const i of nextContent.error) {
        if (i.code === "E005") stderr(MESSAGES.claudeMdUnsafe(claudeMdRel));
        else stderr(`[${i.code}] ${i.message}`);
      }
      return { exitCode: 1 };
    }
    if (nextContent.value === existing) {
      stdout(MESSAGES.rulesNotInstalled);
      return { exitCode: 0 };
    }
    if (opts.diff) {
      const d = computeDiff(existing, nextContent.value);
      stdout(`would uninstall — ${d.summary}`);
      stdout(d.hunk);
      return { exitCode: 0 };
    }
    await writeFile(claudeMdPath, nextContent.value);
    stdout(MESSAGES.rulesUninstalled(claudeMdRel));
    return { exitCode: 0 };
  }

  // --install / --mode (--install is implicit when --mode is passed) --
  const installRequested =
    opts.install === true || opts.mode !== undefined;
  if (installRequested) {
    const targetMode: RulesMode = mode;
    const result = await computeInstall(agent, existing, targetMode, {
      fs,
      env,
      clock,
      cwd,
    });
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

    // Record install timestamp for `sipcode impact` to use as the
    // before/after pivot. Best-effort — never fail the install over it.
    try {
      const { writeInstallState } = await import("../lib/install-state.js");
      await writeInstallState(cwd, {
        rulesInstalledAt: clock.now().toISOString(),
        rulesMode: targetMode,
      });
    } catch {
      /* best-effort — impact will fall back to --since if this fails */
    }

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
    const result = await computeInstall(agent, existing, mode, {
      fs,
      env,
      clock,
      cwd,
    });
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
  const state = inspectRules(stripCursorFrontmatter(existing));
  if (!state.installed) {
    stdout(MESSAGES.rulesNotInstalled);
    return { exitCode: 0 };
  }
  stdout(MESSAGES.rulesActive(state.mode ?? "unknown"));
  return { exitCode: 0 };
}

/** Compute the next content with output-compression installed at `mode`. */
async function computeInstall(
  agent: import("../modules/agents/types.js").Agent,
  existing: string,
  mode: RulesMode,
  ctx: { fs: FileSystem; env: ProcessEnv; clock: Clock; cwd: string },
): Promise<import("../lib/result.js").Result<string, import("../lib/errors.js").SipcodeIssue[]>> {
  if (agent.id === "claude-code") {
    // Legacy byte-identical path.
    return installRules(existing, mode);
  }
  // Cursor: route through the agent so .mdc frontmatter is preserved.
  const body = renderRulesBlock(mode).body;
  let captured = "";
  const r = await agent.writeRulesBlock(
    { fs: ctx.fs, env: ctx.env, clock: ctx.clock },
    ctx.cwd,
    { name: OUTPUT_COMPRESSION_BLOCK_NAME, mode, body },
    async (_p, c) => {
      captured = c;
    },
    existing,
  );
  if (!r.ok) return r;
  return { ok: true, value: captured || r.value.content };
}

async function computeUninstall(
  agent: import("../modules/agents/types.js").Agent,
  existing: string,
  ctx: { fs: FileSystem; env: ProcessEnv; clock: Clock; cwd: string },
): Promise<import("../lib/result.js").Result<string, import("../lib/errors.js").SipcodeIssue[]>> {
  if (agent.id === "claude-code") {
    return uninstallRules(existing);
  }
  // Cursor route — but agent.removeRulesBlock reads from fs. We instead use
  // the pure helper on the stripped body.
  const { removeCursorBlock, splitFrontmatter } = await import(
    "../modules/agents/cursor/rules-file.js"
  );
  void splitFrontmatter; // re-exported for clarity
  return removeCursorBlock(existing, OUTPUT_COMPRESSION_BLOCK_NAME, true);
}

/** Strip a leading --- frontmatter --- block so inspectRules works on .mdc. */
function stripCursorFrontmatter(content: string): string {
  const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  return m ? content.slice(m[0].length) : content;
}

function toRel(cwd: string, abs: string): string {
  const rel = path.relative(cwd, abs).replace(/\\/g, "/");
  return rel.length > 0 ? rel : path.basename(abs);
}
