/**
 * `sipcode update` — shows how to update Sipcode to the latest version.
 *
 * Sipcode never checks for updates on its own: that would require a network
 * call, and zero-network-in-normal-use is a guaranteed property of this
 * codebase (enforced by tests/privacy/no-network.test.ts). So this command
 * just PRINTS the npm command by default. With --run, it executes
 * `npm i -g sipcode@latest` locally on the user's behalf — the user's own npm
 * talks to the registry, Sipcode itself still phones nothing home.
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import { spawnSync } from "node:child_process";

export interface UpdateOptions {
  /** Execute the update instead of just printing it. */
  run?: boolean;
}

export interface UpdateDeps {
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  /** Current installed version, injected from cli.ts (reads package.json). */
  version?: string;
  /**
   * Injectable npm runner. Tests pass a fake so no real process spawns.
   * Returns the child's exit status (null if it was killed by a signal).
   */
  runNpm?: (args: readonly string[]) => { status: number | null };
}

export interface UpdateResult {
  exitCode: 0 | 1;
}

const UPDATE_CMD = "npm i -g sipcode@latest";
const CHANGELOG_URL =
  "https://github.com/Anuj7411/sipcode/blob/main/CHANGELOG.md";

/** Default npm runner. Resolves npm.cmd on Windows (no shell — DEP0190 safe). */
function defaultRunNpm(args: readonly string[]): { status: number | null } {
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  const res = spawnSync(npmBin, [...args], { stdio: "inherit" });
  return { status: res.status };
}

export async function runUpdate(
  opts: UpdateOptions,
  deps: UpdateDeps = {},
): Promise<UpdateResult> {
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s + "\n"));
  const version = deps.version ?? "unknown";

  if (!opts.run) {
    stdout(`sipcode is currently v${version}.`);
    stdout("");
    stdout("to update to the latest version, run:");
    stdout(`  ${UPDATE_CMD}`);
    stdout("");
    stdout("sipcode never checks for updates on its own (zero network calls).");
    stdout(`see what changed: ${CHANGELOG_URL}`);
    stdout("or re-run with --run to update now.");
    return { exitCode: 0 };
  }

  const runNpm = deps.runNpm ?? defaultRunNpm;
  stdout(`updating sipcode from v${version} to latest...`);
  const result = runNpm(["i", "-g", "sipcode@latest"]);
  if (result.status === 0) {
    stdout("done. run `sipcode --version` to confirm.");
    stdout(`see what changed: ${CHANGELOG_URL}`);
    return { exitCode: 0 };
  }
  stderr("update failed. try running it manually:");
  stderr(`  ${UPDATE_CMD}`);
  stderr(`on macOS/Linux you may need: sudo ${UPDATE_CMD}`);
  return { exitCode: 1 };
}
