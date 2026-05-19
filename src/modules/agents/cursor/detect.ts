/**
 * Cursor detection — does Cursor look configured for this cwd or globally?
 *
 * We check the cheap signals only — directory existence — never read content.
 */
import path from "node:path";
import type { FileSystem } from "../../../lib/fs.js";
import type { ProcessEnv } from "../../../lib/process.js";

export interface CursorPresence {
  /** `<cwd>/.cursor/` directory exists. */
  readonly cwdConfigDir: boolean;
  /** `<cwd>/.cursorrules` file exists (legacy single-file rules). */
  readonly cwdLegacyRules: boolean;
  /** `~/.cursor/` directory exists (global install signal). */
  readonly globalConfigDir: boolean;
}

export async function detectCursor(
  fs: FileSystem,
  env: ProcessEnv,
  cwd: string,
): Promise<CursorPresence> {
  const cwdConfigDir = await fs.exists(path.join(cwd, ".cursor"));
  const cwdLegacyRules = await fs.exists(path.join(cwd, ".cursorrules"));
  const globalConfigDir = await fs.exists(path.join(env.homeDir(), ".cursor"));
  return { cwdConfigDir, cwdLegacyRules, globalConfigDir };
}

export function cursorLooksInstalled(p: CursorPresence): boolean {
  return p.cwdConfigDir || p.cwdLegacyRules || p.globalConfigDir;
}
