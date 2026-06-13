/**
 * Sipcode-only isolation for the live benchmark runner.
 *
 * Problem: the cleanest cross-process toggle is `--setting-sources project,local`
 * which skips ALL user settings — including unrelated hooks like claude-mem.
 * That entangles the off/on delta with everything else the user has installed,
 * which makes the launch claim ("Sipcode tokens vs unoptimized") unverifiable.
 *
 * Fix: for the off condition we temporarily edit `~/.claude/settings.json` to
 * remove ONLY the Sipcode proxy hook entry, run the spawn, then atomically
 * restore the original bytes. Other hooks (claude-mem, etc.) keep firing in
 * both conditions, so the delta is Sipcode-attributable.
 *
 * Safety:
 *   - We snapshot the EXACT original bytes (not the re-serialized JSON) so a
 *     restore round-trip preserves user whitespace/comments-as-trailing-text.
 *   - A `finally` block restores even on thrown errors.
 *   - SIGINT/SIGTERM listeners attempt a sync restore so Ctrl+C never leaves
 *     the user with a stripped settings file.
 *   - If the original file doesn't exist (no user settings), we no-op.
 */
import { promises as fs, writeFileSync, existsSync, renameSync } from "node:fs";
import path from "node:path";
import { removeSipcodeHooks } from "../hygiene/settingsJson.js";
import { HOOK_PROXY_ID } from "../hygiene/types.js";

// settingsJson.ts uses a local JsonObj alias; mirror the shape here.
type JsonObj = { [k: string]: unknown };

export interface IsolationIO {
  read(p: string): Promise<string | null>;
  write(p: string, content: string): Promise<void>;
  /** Sync write used by the signal handler — async would never finish during a SIGINT. */
  writeSync(p: string, content: string): void;
}

export const realIsolationIO: IsolationIO = {
  async read(p) {
    try {
      return await fs.readFile(p, "utf-8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw err;
    }
  },
  async write(p, content) {
    // F2: atomic write via tmp + rename. POSIX guarantees rename is atomic;
    // on Windows it's atomic within the same volume in practice. Eliminates
    // the "mid-write crash leaves truncated settings.json" risk.
    await fs.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.sipcode-tmp-${process.pid}`;
    await fs.writeFile(tmp, content, "utf-8");
    await fs.rename(tmp, p);
  },
  writeSync(p, content) {
    // Sync path used by the SIGINT handler. Same tmp+rename idiom.
    const tmp = `${p}.sipcode-tmp-${process.pid}-sync`;
    writeFileSync(tmp, content, "utf-8");
    renameSync(tmp, p);
  },
};

export function settingsJsonPath(homeDir: string): string {
  return path.join(homeDir, ".claude", "settings.json");
}

/**
 * Compute the stripped JSON string. Pure. Returns null when nothing needs
 * to change (no settings file, or no Sipcode proxy hook present).
 */
export function strippedSettingsText(originalText: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(originalText);
  } catch {
    // Malformed settings — don't touch it.
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const before = parsed as JsonObj;
  const after = removeSipcodeHooks(before, [HOOK_PROXY_ID]);
  if (after === before) return null; // no Sipcode hook was present
  return JSON.stringify(after, null, 2) + "\n";
}

/**
 * Run `fn` with the Sipcode hook temporarily removed from user settings.
 * Always restores, including on throw or process signal.
 */
export async function withSipcodeStripped<T>(
  homeDir: string,
  fn: () => Promise<T>,
  io: IsolationIO = realIsolationIO,
): Promise<T> {
  const settingsPath = settingsJsonPath(homeDir);
  const original = await io.read(settingsPath);
  if (original === null) {
    // No user settings file — nothing to strip; run as-is.
    return await fn();
  }
  const stripped = strippedSettingsText(original);
  if (stripped === null) {
    // No Sipcode hook present; run as-is.
    return await fn();
  }

  // Install a signal handler that restores synchronously. Don't replace any
  // existing handlers — chain through.
  const onSignal = () => {
    try {
      // Re-check the file exists before writing back; user might have
      // moved it. The sync write avoids the "process exits before promise
      // resolves" trap.
      if (existsSync(settingsPath)) {
        io.writeSync(settingsPath, original);
      }
    } catch {
      // last-resort silent fail; we tried.
    }
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    await io.write(settingsPath, stripped);
    return await fn();
  } finally {
    try {
      await io.write(settingsPath, original);
    } catch {
      // sync attempt as last resort
      try {
        io.writeSync(settingsPath, original);
      } catch {
        /* nothing more we can do */
      }
    }
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
