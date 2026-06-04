#!/usr/bin/env node
/**
 * Sipcode CLI entry point.
 *
 * Sip your tokens. Don't gulp them.
 */
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
) as { version: string };

const program = new Command();

program
  .name("sipcode")
  .description("Sip your tokens. Don't gulp them.")
  .version(pkg.version);

program
  .command("why")
  .description("Audit past Claude Code sessions and show where tokens died.")
  .option("--session <id>", "audit a specific session")
  .option("--list", "list available sessions instead of auditing")
  .option("--here", "scope to sessions for the current working directory")
  .option("--all-projects", "scan across all project hashes (default)")
  .option("--json", "machine-readable output")
  .option("--verbose", "show full token totals breakdown")
  .option("--agent <id>", "which agent to source transcripts from: claude-code | cursor | auto")
  .action(async (opts) => {
    const { runWhy } = await import("./commands/why.js");
    const result = await runWhy(opts);
    if (result?.exitCode) process.exit(result.exitCode);
  });

program
  .command("init")
  .description("Set up Sipcode in the current project.")
  .option("--yes", "accept all defaults (non-interactive)")
  .option("--tighten", "default budget mode to tighten")
  .option("--no-claude-md", "skip CLAUDE.md injection")
  .option(
    "--rules-mode <mode>",
    "output-compression rules mode: default | strict | verbose | skip",
  )
  .option("--agent <id>", "which agent to target: claude-code | cursor | auto")
  .action(async (opts) => {
    const { runInit } = await import("./commands/init.js");
    const r = await runInit(opts);
    if (r?.exitCode) process.exit(r.exitCode);
  });

program
  .command("manifest")
  .description("Generate or refresh the project manifest.")
  .option("--no-budget", "skip the 2k-token budget check")
  .option("--tighten", "drop low-signal sections to fit the budget")
  .option("--delta", "emit only changes since last manifest (v1.1+, stubbed)")
  .option("--explain <file>", "show parse error for a specific file (v1.1+, stubbed)")
  .option("--agent <id>", "which agent to target: claude-code | cursor | auto")
  .action(async (opts) => {
    const { runManifest } = await import("./commands/manifest.js");
    const r = await runManifest(opts);
    if (r?.exitCode) process.exit(r.exitCode);
  });

program
  .command("receipt")
  .description("Generate a shareable receipt for a session.")
  .argument("[session-id]", "session to render (defaults to latest)")
  .option("--html-only", "skip PNG (faster, no native render needed)")
  .option("--no-share", "skip clipboard + tweet intent URL")
  .option("--here", "scope to sessions for the current working directory")
  .option("--json", "machine-readable output")
  .option("--agent <id>", "which agent to source transcripts from: claude-code | cursor | auto")
  .action(async (sessionId, opts) => {
    const { runReceipt } = await import("./commands/receipt.js");
    const result = await runReceipt({ ...opts, session: sessionId });
    if (result?.exitCode) process.exit(result.exitCode);
  });

program
  .command("rules")
  .description("Install, switch, or inspect Sipcode output-compression rules in CLAUDE.md.")
  .option("--install", "add the output-compression block to CLAUDE.md (idempotent)")
  .option("--uninstall", "remove the output-compression block from CLAUDE.md")
  .option("--mode <mode>", "install/switch to mode: default | strict | verbose")
  .option("--diff", "show what would change without writing")
  .option("--agent <id>", "which agent to target: claude-code | cursor | auto")
  .action(async (opts) => {
    const { runRules } = await import("./commands/rules.js");
    const r = await runRules(opts);
    if (r?.exitCode) process.exit(r.exitCode);
  });

program
  .command("estimate")
  .description("Predict what a coding task will cost across models before you run it.")
  .argument("<task>", "the task description, in quotes")
  .option("--repo <path>", "path to the repo to use as context (defaults to cwd)")
  .option("--json", "machine-readable output")
  .option("--no-anchors", "skip historical session lookup (faster, less accurate)")
  .option("--model <model>", "show only one model's row: opus | sonnet | haiku")
  .option("--agent <id>", "which agent to source historical anchors from: claude-code | cursor | auto")
  .action(async (task, opts) => {
    const { runEstimate } = await import("./commands/estimate.js");
    const r = await runEstimate({ ...opts, task });
    if (r?.exitCode) process.exit(r.exitCode);
  });

program
  .command("stats")
  .description("Show cumulative token savings across sessions.")
  .option("--since <window>", "time window: 7d | 30d | 90d | all | yyyy-mm-dd", "30d")
  .option("--here", "scope to sessions for the current working directory")
  .option("--html", "also write .sipcode/stats.html (standalone)")
  .option("--json", "machine-readable output")
  .option("--group-by <how>", "group totals: none | project", "none")
  .option("--top <n>", "show top N most expensive sessions", "5")
  .option("--agent <id>", "which agent to source transcripts from: claude-code | cursor | auto")
  .action(async (opts) => {
    const { runStats } = await import("./commands/stats.js");
    const r = await runStats(opts);
    if (r?.exitCode) process.exit(r.exitCode);
  });

program
  .command("score")
  .description("Audit how agent-friendly this codebase is (0-100, tiered badge).")
  .option("--json", "machine-readable output")
  .option("--no-html", "skip writing .sipcode/score.html")
  .option("--badge", "also write .sipcode/badge.json (shields.io endpoint)")
  .option("--threshold <n>", "exit 1 if score below N (for CI gating)")
  .action(async (opts) => {
    const { runScoreCmd } = await import("./commands/score.js");
    const r = await runScoreCmd(opts);
    if (r?.exitCode) process.exit(r.exitCode);
  });

program
  .command("hygiene")
  .description("Install Sipcode Session Hygiene: read-once rules + context-pressure hooks.")
  .option("--install", "install the hygiene block + register PreToolUse/PostToolUse hooks (idempotent)")
  .option("--uninstall", "remove the block + hook entries from settings.json")
  .option("--diff", "show what would change without writing")
  .option("--check", "dry-run: classify pressure band against the latest transcript")
  .action(async (opts) => {
    const { runHygiene } = await import("./commands/hygiene.js");
    const r = await runHygiene(opts);
    if (r?.exitCode) process.exit(r.exitCode);
  });

program
  .command("proxy")
  .description("Install the Sipcode runtime proxy — rewrites tool inputs to produce naturally-compact outputs (matches RTK's mechanic).")
  .option("--install", "write the hook script + register the PreToolUse hook (idempotent)")
  .option("--uninstall", "remove the hook entry + delete the hook script")
  .option("--diff", "show what would change without writing")
  .option("--stats", "show accumulated rewrite stats")
  .option("--json", "machine-readable output (with --stats)")
  .action(async (opts) => {
    const { runProxy } = await import("./commands/proxy.js");
    const r = await runProxy(opts);
    if (r?.exitCode) process.exit(r.exitCode);
  });

program
  .command("benchmark")
  .description("Reproducible token-savings benchmark over a locked 20-task corpus.")
  .option("--task <id>", "run a single task (BT001-BT020)")
  .option("--list", "list available tasks instead of running")
  .option("--quick", "smoke test: run only the 3 fastest tasks")
  .option("--hardest", "scope to the Hardest Tasks subset (BT011-BT020) — the canonical waste-maximizing corpus")
  .option("--html", "also write .sipcode/benchmark.html (or .sipcode/benchmark-hardest.html with --hardest)")
  .option("--json", "machine-readable output")
  .option("--corpus <dir>", "override the corpus directory (default: <repo>/benchmark/corpus)")
  .option("--vs-rtk", "heuristic proxy preview: replay rewriters over corpus tool calls (no re-execution)")
  .action(async (opts) => {
    const { runBenchmark } = await import("./commands/benchmark.js");
    const r = await runBenchmark(opts);
    if (r?.exitCode) process.exit(r.exitCode);
  });

program
  .command("impact")
  .description("A/B compare your token spend before vs after Sipcode was installed — on your own sessions.")
  .option("--since <YYYY-MM-DD>", "override the install date (defaults to .sipcode/install-state.json)")
  .option("--json", "machine-readable output")
  .option("--agent <id>", "which agent to source transcripts from: claude-code | cursor | auto")
  .action(async (opts) => {
    const { runImpactCommand } = await import("./commands/impact.js");
    const r = await runImpactCommand(opts);
    if (r?.exitCode) process.exit(r.exitCode);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
