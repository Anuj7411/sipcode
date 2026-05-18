/**
 * `sipcode manifest` — generate or refresh `.sipcode/manifest.md`.
 *
 * Thin orchestrator: scan → parse → analyze → render → enforce budget →
 * write. All I/O goes through the FileSystem + Git seams.
 */
import path from "node:path";
import { promises as nodeFs } from "node:fs";
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import { RealGit, type Git } from "../lib/git.js";
import { MESSAGES } from "../lib/messages.js";
import { scanFiles } from "../modules/manifest/scanFiles.js";
import { parseFile } from "../modules/manifest/parseFile.js";
import { buildImportGraph } from "../modules/manifest/importGraph.js";
import { detectPatterns } from "../modules/manifest/patterns.js";
import { detectFramework } from "../modules/manifest/framework.js";
import { computeHotFiles } from "../modules/manifest/hotFiles.js";
import {
  DEFAULT_BUDGET_TOKENS,
  renderWithBudget,
} from "../modules/manifest/budget.js";
import type {
  ParsedFile,
  ScannedFile,
  ManifestInputs,
} from "../modules/manifest/types.js";
import type { SipcodeIssue } from "../lib/errors.js";

export interface ManifestOptions {
  /** When false, --no-budget. Default: true (enforce S006). */
  budget?: boolean;
  /** Stub: --delta isn't implemented in v0.1.0-alpha.2. */
  delta?: boolean;
  /** Drop low-signal sections to fit budget. */
  tighten?: boolean;
  /** Print parse-error explanation for a single file. (Stub.) */
  explain?: string;
}

export interface ManifestDeps {
  fs?: FileSystem;
  clock?: Clock;
  env?: ProcessEnv;
  git?: Git;
  cwd?: string;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  /** Write the manifest to disk. Default: node:fs writeFile through cwd. */
  writeFile?: (absPath: string, content: string) => Promise<void>;
}

export interface ManifestResult {
  readonly exitCode: 0 | 1;
  readonly manifestPath?: string;
  readonly tokenCount?: number;
}

export async function runManifest(
  opts: ManifestOptions,
  deps: ManifestDeps = {},
): Promise<ManifestResult> {
  const fs = deps.fs ?? new RealFileSystem();
  const clock = deps.clock ?? new RealClock();
  const env = deps.env ?? new RealProcessEnv();
  const git = deps.git ?? new RealGit();
  const cwd = deps.cwd ?? process.cwd();
  const stdout =
    deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const stderr =
    deps.stderr ?? ((s: string) => process.stderr.write(s + "\n"));
  const writeFile =
    deps.writeFile ?? (async (p, c) => {
      await nodeFs.mkdir(path.dirname(p), { recursive: true });
      await nodeFs.writeFile(p, c, "utf-8");
    });

  // Stubs first.
  if (opts.delta) {
    stdout(MESSAGES.manifestDeltaNotImplemented);
    return { exitCode: 0 };
  }
  if (opts.explain) {
    stdout(MESSAGES.manifestExplainNotImplemented(opts.explain));
    return { exitCode: 0 };
  }

  // 1. Scan.
  const scanned = await scanFiles(fs, cwd);

  // 2. Load package.json (best-effort).
  const pkgPath = path.join(cwd, "package.json");
  let pkgJson: unknown | undefined;
  if (await fs.exists(pkgPath)) {
    try {
      pkgJson = JSON.parse(await fs.readFile(pkgPath));
    } catch {
      pkgJson = undefined;
    }
  }

  // 3. Parse source files (only supported langs; "other" -> skipped).
  const parsed: ParsedFile[] = [];
  const issues: SipcodeIssue[] = [];
  for (const f of scanned) {
    if (f.language === "other") continue;
    let content: string;
    try {
      content = await fs.readFile(path.join(cwd, f.path));
    } catch {
      continue;
    }
    const res = await parseFile({
      relPath: f.path,
      content,
      language: f.language,
    });
    if (res.ok) parsed.push(res.value);
    else issues.push(...res.error);
  }

  // 4. Import graph.
  const importGraph = buildImportGraph(parsed);

  // 5. Patterns + framework.
  const hasFile = (rel: string): boolean =>
    scanned.some((s) => s.path === rel);
  const patterns = detectPatterns({
    parsed,
    scanned,
    packageJson: pkgJson,
    hasFile,
  });
  const framework = detectFramework({
    packageJson: pkgJson,
    hasFile,
    scanned,
  });

  // 6. Hot files via git.
  const knownFiles = new Set(scanned.map((s) => s.path));
  const hotRes = await computeHotFiles({
    git,
    projectRoot: cwd,
    knownFiles,
  });
  const hotFiles = hotRes.ok ? hotRes.value : [];
  if (!hotRes.ok) issues.push(...hotRes.error);

  // 7. Header bits.
  const headShort = (await git.headShort(cwd)) ?? undefined;
  const projectName = projectNameFromPkg(pkgJson, cwd);
  const generatedAt = isoDate(clock.now(), headShort);

  const inputs: ManifestInputs = {
    projectName,
    projectRoot: cwd,
    headShort,
    generatedAt,
    files: scanned,
    parsed,
    importGraph,
    hotFiles,
    patterns,
    framework,
    issues,
  };

  // 8. Render with budget.
  const budget = DEFAULT_BUDGET_TOKENS;
  const enforce = opts.budget ?? true;
  const result = renderWithBudget(inputs, {
    budget,
    enforce,
    tighten: opts.tighten ?? false,
  });

  if (!result.ok) {
    for (const i of result.error) {
      if (i.code === "E001") {
        stderr(
          MESSAGES.manifestOverBudget(
            extractActualTokens(i.message) ?? -1,
            budget,
          ),
        );
      } else {
        stderr(`[${i.code}] ${i.message}`);
      }
    }
    return { exitCode: 1 };
  }

  const { rendered } = result.value;
  for (const w of result.value.warnings) {
    stderr(MESSAGES.manifestBudgetWarn(rendered.tokenCount, budget));
    void w; // already surfaced via the rendered message
  }

  // 9. Write file.
  const outPath = path.join(cwd, ".sipcode", "manifest.md");
  await writeFile(outPath, rendered.content);

  stdout(`wrote ${toPosix(path.relative(cwd, outPath))} (${rendered.tokenCount} tokens)`);

  // Surface E002 / E006 / E007 as informational lines.
  for (const i of issues) {
    if (i.code === "E006") stderr(MESSAGES.gitUnavailable);
    // E002 / E007 stay silent unless --verbose (out of scope here)
    void i;
  }

  void env;

  return {
    exitCode: 0,
    manifestPath: outPath,
    tokenCount: rendered.tokenCount,
  };
}

function projectNameFromPkg(pkg: unknown, cwd: string): string {
  if (
    typeof pkg === "object" &&
    pkg !== null &&
    "name" in pkg &&
    typeof (pkg as { name?: unknown }).name === "string"
  ) {
    return (pkg as { name: string }).name;
  }
  return path.basename(cwd);
}

function isoDate(d: Date, headShort: string | undefined): string {
  // Idempotence-friendly: if we have a git head, prefer "HEAD@<sha>" so the
  // timestamp doesn't change every second on unchanged trees.
  if (headShort) return `HEAD@${headShort}`;
  return d.toISOString();
}

function extractActualTokens(msg: string): number | undefined {
  const m = msg.match(/(\d+)\s+tokens/);
  return m ? Number(m[1]) : undefined;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}
