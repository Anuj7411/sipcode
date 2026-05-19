/**
 * `sipcode score` — static-analysis audit of how agent-friendly a codebase
 * is. Outputs a 0-100 score, a tier badge, optional HTML report, optional
 * Shields.io-compatible badge JSON, and supports CI gating via --threshold.
 *
 * Thin orchestrator: buildSnapshot → runScore → format → print/write.
 */
import path from "node:path";
import { promises as nodeFs } from "node:fs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { MESSAGES } from "../lib/messages.js";
import { buildSnapshot } from "../modules/score/snapshot.js";
import { runScore } from "../modules/score/run.js";
import { formatTerminal } from "../modules/score/format-terminal.js";
import { formatJson } from "../modules/score/format-json.js";
import { formatHtml } from "../modules/score/format-html.js";
import { formatBadge } from "../modules/score/format-badge.js";

export interface ScoreOptions {
  json?: boolean;
  html?: boolean; // default true; --no-html disables
  badge?: boolean;
  threshold?: string | number;
  cwd?: string;
}

export interface ScoreDeps {
  fs?: FileSystem;
  clock?: Clock;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  writeFile?: (absPath: string, content: string) => Promise<void>;
  /** Override the version string in the report (tests). */
  version?: string;
}

export interface ScoreResult {
  exitCode: 0 | 1;
}

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      readFileSync(join(here, "..", "..", "package.json"), "utf-8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function defaultWriteFile(p: string, c: string): Promise<void> {
  await nodeFs.mkdir(path.dirname(p), { recursive: true });
  await nodeFs.writeFile(p, c, "utf-8");
}

function parseThreshold(raw: string | number | undefined): number | undefined | { error: string } {
  if (raw === undefined || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return { error: MESSAGES.scoreBadThreshold(String(raw)) };
  }
  return Math.floor(n);
}

export async function runScoreCmd(
  opts: ScoreOptions = {},
  deps: ScoreDeps = {},
): Promise<ScoreResult> {
  const fs = deps.fs ?? new RealFileSystem();
  const clock = deps.clock ?? new RealClock();
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s + "\n"));
  const writeFile = deps.writeFile ?? defaultWriteFile;
  const cwd = opts.cwd ?? process.cwd();
  const version = deps.version ?? readVersion();
  const htmlEnabled = opts.html !== false; // default true

  const threshold = parseThreshold(opts.threshold);
  if (threshold !== undefined && typeof threshold === "object") {
    stderr(threshold.error);
    return { exitCode: 1 };
  }

  // Build snapshot + run pipeline.
  const snapshot = await buildSnapshot({ fs, projectRoot: cwd });
  const report = runScore(snapshot, {
    version,
    asOf: clock.now().toISOString(),
  });

  // Emit primary format.
  if (opts.json) {
    stdout(formatJson(report));
  } else {
    const useColor =
      typeof process !== "undefined" &&
      process.env?.NO_COLOR === undefined &&
      (process.stdout?.isTTY ?? false);
    stdout(formatTerminal(report, { useColor }));
  }

  // Additive outputs.
  if (htmlEnabled && !opts.json) {
    const htmlPath = path.join(cwd, ".sipcode", "score.html");
    await writeFile(htmlPath, formatHtml(report));
    stdout("");
    stdout(MESSAGES.scoreHtmlWrote(htmlPath));
  }

  if (opts.badge) {
    const badgePath = path.join(cwd, ".sipcode", "badge.json");
    await writeFile(badgePath, formatBadge(report));
    if (!opts.json) {
      stdout(MESSAGES.scoreBadgeWrote(badgePath));
    }
  }

  // Threshold gating: exit 1 if score below.
  if (typeof threshold === "number" && report.score < threshold) {
    if (!opts.json) {
      stderr("");
      stderr(MESSAGES.scoreBelowThreshold(report.score, threshold));
    }
    return { exitCode: 1 };
  }

  return { exitCode: 0 };
}
