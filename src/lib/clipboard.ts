/**
 * Clipboard seam — copies an image (PNG) onto the system clipboard.
 *
 * This is the ONLY place (besides `lib/git.ts`) in `src/` allowed to import
 * `node:child_process`. All invocations use `execFile` (never shell) with
 * proper arg arrays — argv injection is impossible.
 *
 * Clipboard copy is a *best-effort* nicety. Callers must wrap with
 * try/catch (or rely on the `Result`-style return below) and never let
 * clipboard failure fail the surrounding command.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as nodeFs from "node:fs";
import type { ProcessEnv } from "./process.js";

const execFileP = promisify(execFile);

export type ClipboardStrategy =
  | "windows"
  | "wsl"
  | "macos"
  | "linux-wayland"
  | "linux-x11"
  | "unsupported";

export interface ClipboardResult {
  readonly ok: boolean;
  readonly strategy: ClipboardStrategy;
  /** Set when ok = false. Short, brand-voice friendly message. */
  readonly reason?: string;
}

export interface Clipboard {
  /** Copy a PNG file (by absolute path) onto the system clipboard as an image. */
  copyPng(absPath: string): Promise<ClipboardResult>;
  /** Returns which strategy would be used on this host, for diagnostics/tests. */
  detect(): ClipboardStrategy;
}

/** True iff this Node process is running inside WSL. */
function detectWsl(env: ProcessEnv): boolean {
  if (env.platform() !== "linux") return false;
  try {
    const v = nodeFs.readFileSync("/proc/version", "utf-8");
    return /microsoft/i.test(v);
  } catch {
    return false;
  }
}

function detectStrategy(env: ProcessEnv): ClipboardStrategy {
  const p = env.platform();
  if (p === "win32") return "windows";
  if (p === "darwin") return "macos";
  if (p === "linux") {
    if (detectWsl(env)) return "wsl";
    if (env.get("WAYLAND_DISPLAY")) return "linux-wayland";
    if (env.get("DISPLAY")) return "linux-x11";
    return "linux-x11";
  }
  return "unsupported";
}

export class RealClipboard implements Clipboard {
  constructor(private readonly env: ProcessEnv) {}

  detect(): ClipboardStrategy {
    return detectStrategy(this.env);
  }

  async copyPng(absPath: string): Promise<ClipboardResult> {
    const strategy = this.detect();
    try {
      switch (strategy) {
        case "windows":
        case "wsl": {
          // PowerShell: read file as image and Set-Clipboard.
          // Single-quoted PS string with escaped single quotes for safety.
          const escaped = absPath.replace(/'/g, "''");
          const psCmd = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $img=[System.Drawing.Image]::FromFile('${escaped}'); [System.Windows.Forms.Clipboard]::SetImage($img); $img.Dispose()`;
          await execFileP(
            "powershell",
            ["-NoProfile", "-STA", "-Command", psCmd],
            { windowsHide: true, timeout: 8000 },
          );
          return { ok: true, strategy };
        }
        case "macos": {
          const escaped = absPath.replace(/"/g, '\\"');
          const osa = `set the clipboard to (read (POSIX file "${escaped}") as «class PNGf»)`;
          await execFileP("osascript", ["-e", osa], { timeout: 8000 });
          return { ok: true, strategy };
        }
        case "linux-wayland": {
          await runFileToStdin("wl-copy", ["--type", "image/png"], absPath);
          return { ok: true, strategy };
        }
        case "linux-x11": {
          await execFileP(
            "xclip",
            ["-selection", "clipboard", "-t", "image/png", "-i", absPath],
            { timeout: 8000 },
          );
          return { ok: true, strategy };
        }
        case "unsupported":
        default:
          return {
            ok: false,
            strategy: "unsupported",
            reason:
              "clipboard copy not supported on this platform — use the file:// link above.",
          };
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        strategy,
        reason: `clipboard tool failed: ${truncate(msg, 160)}`,
      };
    }
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/** Pipe a file into a stdin-fed binary (no shell). */
function runFileToStdin(
  bin: string,
  args: readonly string[],
  file: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // execFile spawns a child; pipe the file content into its stdin manually.
    // We use the underlying child_process.spawn via execFile's sibling API
    // to keep this surface tiny. We import lazily to avoid leaking a second
    // child_process import elsewhere.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { spawn } = require("node:child_process") as typeof import("node:child_process");
    const child = spawn(bin, [...args], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(`${bin} exited with ${code}: ${stderr.trim()}`));
    });
    nodeFs.createReadStream(file).on("error", reject).pipe(child.stdin!);
  });
}

/** Test double — records what was copied without touching the real clipboard. */
export class FakeClipboard implements Clipboard {
  public readonly copies: string[] = [];
  constructor(
    private readonly options: {
      strategy?: ClipboardStrategy;
      fail?: boolean;
      failReason?: string;
    } = {},
  ) {}

  detect(): ClipboardStrategy {
    return this.options.strategy ?? "linux-x11";
  }

  async copyPng(absPath: string): Promise<ClipboardResult> {
    this.copies.push(absPath);
    if (this.options.fail) {
      return {
        ok: false,
        strategy: this.detect(),
        reason: this.options.failReason ?? "clipboard tool failed: forced failure",
      };
    }
    return { ok: true, strategy: this.detect() };
  }
}
