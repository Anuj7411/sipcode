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

  stdout("");
  stdout("done. sip your tokens.");

  return {
    exitCode: 0,
    rulesMode,
    ...(manifestResult.manifestPath !== undefined
      ? { manifestPath: manifestResult.manifestPath }
      : {}),
    ...(claudeMdPath !== undefined ? { claudeMdPath } : {}),
  };
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
