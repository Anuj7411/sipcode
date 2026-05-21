/**
 * Install-state seam — reads/writes `.sipcode/install-state.json` next to
 * the user's project root.
 *
 * Recorded when the user runs `sipcode rules --install` or
 * `sipcode hygiene --install`. Used by `sipcode impact` to pivot the
 * before/after bucket boundary.
 *
 * Privacy: this file lives ENTIRELY on the user's disk. Nothing leaves
 * the machine. Listed in the standard .sipcode/.gitignore template.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const FILENAME = "install-state.json";
const SUBDIR = ".sipcode";

export interface InstallState {
  /** ISO timestamp of the most recent `sipcode rules --install` run. */
  rulesInstalledAt?: string;
  /** ISO timestamp of the most recent `sipcode hygiene --install` run. */
  hygieneInstalledAt?: string;
  /** Free-text mode string (e.g. "default" / "strict" / "verbose"). */
  rulesMode?: string;
  /** Schema-version for forward-compat. */
  schemaVersion: "sipcode-install-state/1";
}

export function emptyInstallState(): InstallState {
  return { schemaVersion: "sipcode-install-state/1" };
}

function statePath(cwd: string): string {
  return path.join(cwd, SUBDIR, FILENAME);
}

/**
 * Read the install state at `cwd`. Returns `null` if no file exists.
 * Silently returns `null` on parse errors so impact can fall back to
 * the --since flag instead of crashing.
 */
export async function readInstallState(cwd: string): Promise<InstallState | null> {
  const p = statePath(cwd);
  try {
    const raw = await fs.readFile(p, "utf-8");
    const parsed = JSON.parse(raw) as Partial<InstallState>;
    if (parsed.schemaVersion !== "sipcode-install-state/1") return null;
    return parsed as InstallState;
  } catch {
    return null;
  }
}

/**
 * Merge a patch into the install state, creating the file if absent.
 */
export async function writeInstallState(
  cwd: string,
  patch: Partial<InstallState>,
): Promise<InstallState> {
  const existing = (await readInstallState(cwd)) ?? emptyInstallState();
  const next: InstallState = {
    ...existing,
    ...patch,
    schemaVersion: "sipcode-install-state/1",
  };
  const p = statePath(cwd);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

/**
 * Resolve which marker to use as the impact pivot. Preference order:
 *   1. rulesInstalledAt — the "active optimizer" install
 *   2. hygieneInstalledAt — the "hook" install
 *
 * Returns `null` if neither is present.
 */
export interface ResolvedMarker {
  readonly iso: string;
  readonly source: "install-state.json (rules)" | "install-state.json (hygiene)";
}

export function pickMarker(state: InstallState | null): ResolvedMarker | null {
  if (!state) return null;
  if (state.rulesInstalledAt) {
    return {
      iso: state.rulesInstalledAt,
      source: "install-state.json (rules)",
    };
  }
  if (state.hygieneInstalledAt) {
    return {
      iso: state.hygieneInstalledAt,
      source: "install-state.json (hygiene)",
    };
  }
  return null;
}
