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
  .action(async (opts) => {
    const { runWhy } = await import("./commands/why.js");
    const result = await runWhy(opts);
    if (result?.exitCode) process.exit(result.exitCode);
  });

program
  .command("init")
  .description("Set up Sipcode in the current project.")
  .action(async () => {
    const { runInit } = await import("./commands/init.js");
    await runInit();
  });

program
  .command("manifest")
  .description("Generate or refresh the project manifest.")
  .option("--no-budget", "skip the 2k-token budget check")
  .option("--delta", "emit only changes since last manifest")
  .action(async (opts) => {
    const { runManifest } = await import("./commands/manifest.js");
    await runManifest(opts);
  });

program
  .command("receipt")
  .description("Generate a shareable receipt for a session.")
  .argument("[session-id]", "session to render (defaults to latest)")
  .option("--png", "also emit a PNG receipt")
  .option("--html", "emit HTML receipt (default true)")
  .action(async (sessionId, opts) => {
    const { runReceipt } = await import("./commands/receipt.js");
    await runReceipt(sessionId, opts);
  });

program
  .command("stats")
  .description("Show cumulative token savings across sessions.")
  .action(async () => {
    const { runStats } = await import("./commands/stats.js");
    await runStats();
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
