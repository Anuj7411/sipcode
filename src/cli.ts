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
  .option("--no-proxy", "skip the proxy hook install step (v1.6.15)")
  .option("--no-marker", "skip the install marker for sipcode impact (v1.6.15)")
  .option("--no-verify-mcp", "skip the MCP tool count verification (v1.6.15)")
  .action(async (opts) => {
    const { runInit } = await import("./commands/init.js");
    const { homedir } = await import("node:os");
    const r = await runInit(opts, { homeDir: homedir() });
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
  .command("today")
  .description("Daily dashboard: spend so far + vs your N-day median (adaptive 30/14/7/3).")
  .option("--json", "machine-readable output")
  .option("--agent <id>", "claude-code | cursor | auto")
  .action(async (opts) => {
    const { runTodayCmd } = await import("./commands/today.js");
    const r = await runTodayCmd(opts);
    if (r?.exitCode) process.exit(r.exitCode);
  });

program
  .command("forecast")
  .description("Projected month-end spend with confidence band + last-month comparison.")
  .option("--json", "machine-readable output")
  .option("--agent <id>", "claude-code | cursor | auto")
  .action(async (opts) => {
    const { runForecastCmd } = await import("./commands/forecast.js");
    const r = await runForecastCmd(opts);
    if (r?.exitCode) process.exit(r.exitCode);
  });

program
  .command("trend")
  .description("Track ONE metric over time (output ratio, cost/session, recoverable tokens) — answers 'is this getting better?'.")
  .option("--metric <name>", "output-ratio | cost-per-session | recoverable-tokens-per-session", "output-ratio")
  .option("--since <window>", "time window: NNd | NNw | NNm (e.g. 30d, 4w, 3m)", "30d")
  .option("--json", "machine-readable output")
  .option("--agent <id>", "which agent to source transcripts from: claude-code | cursor | auto")
  .action(async (opts) => {
    const { runTrend } = await import("./commands/trend.js");
    const r = await runTrend(opts);
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
  .command("drift")
  .description("Detect context/cost drift — flags when recent sessions get more expensive or context-bloated vs your baseline. Silent unless something regressed.")
  .option("--json", "machine-readable output")
  .option("--no-cache", "bypass the persistent baseline cache (parses every transcript fresh)")
  .action(async (opts) => {
    const { runDriftCommand } = await import("./commands/drift.js");
    // Commander maps `--no-cache` to `opts.cache: false`; translate to noCache.
    const r = await runDriftCommand({
      json: !!opts.json,
      noCache: opts.cache === false,
    });
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
  .option("--live", "with --vs-rtk: actually spawn `claude --print` twice per task (off vs on) and measure real token usage (opt-in, costs real API credit)")
  .option("--model <name>", "with --live: pin the model the runner asks claude to use")
  .option("--max-budget-usd <amount>", "with --live: safety cap per spawn (default 1.00)")
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

// v1.6.16 F-CACHE-DEFER: before any command (except `init`, which manages
// its own pending state), check for a deferred install and auto-apply it
// when there is no active Claude Code session. Silent unless the apply
// actually changes something on disk.
program.hook("preAction", async (_thisCommand, actionCommand) => {
  if (actionCommand.name() === "init") return; // init has its own gate

  try {
    const { homedir } = await import("node:os");
    const { promises: fsp } = await import("node:fs");
    const { detectActiveClaudeSessions } = await import(
      "./modules/init/sessionDetection.js"
    );
    const { maybeApplyPendingInstall } = await import(
      "./modules/init/pendingInstall.js"
    );
    const { generateProxyHookScript } = await import(
      "./modules/proxy/proxyHookScript.js"
    );
    const {
      runRewriterModuleUrl,
      hookReadDedupModuleUrl,
      hookAstReadModuleUrl,
    } = await import("./modules/proxy/install.js");

    const home = homedir();

    await maybeApplyPendingInstall({
      homeDir: home,
      async detectActiveSessions(homeDir) {
        return detectActiveClaudeSessions({
          homeDir,
          io: {
            async listDir(p) {
              return fsp.readdir(p);
            },
            async stat(p) {
              try {
                const s = await fsp.stat(p);
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
      },
      pendingIO: {
        async readFile(p) {
          try {
            return await fsp.readFile(p, "utf-8");
          } catch {
            return null;
          }
        },
        async writeFile(p, content) {
          await fsp.mkdir(
            (await import("node:path")).dirname(p),
            { recursive: true },
          );
          await fsp.writeFile(p, content, "utf-8");
        },
        async deleteFile(p) {
          try {
            await fsp.unlink(p);
          } catch {
            // missing is fine
          }
        },
        now() {
          return new Date();
        },
      },
      generateScript() {
        return generateProxyHookScript(
          runRewriterModuleUrl(),
          hookReadDedupModuleUrl(),
          hookAstReadModuleUrl(),
        );
      },
      log(message) {
        process.stderr.write(message + "\n");
      },
    });
  } catch {
    // The preAction hook is a pure ergonomic nicety. Any failure here must
    // NEVER stop the user's actual command. Swallow and let the real action
    // proceed.
  }
});

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
