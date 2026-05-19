/**
 * repoContext — I/O wrapper.
 *
 * Reads `.sipcode/manifest.md` if present and pulls out file count, framework,
 * and a token-count proxy. If absent, falls back to a quick scan of the cwd
 * using the manifest module's scanFiles (cheap — no AST work).
 *
 * Pure functions live below — they take a string blob and parse it.
 */
import path from "node:path";
import type { FileSystem } from "../../lib/fs.js";
import { approxTokenCount } from "../../lib/tokenizer.js";
import { scanFiles } from "../manifest/scanFiles.js";
import type { RepoContext } from "./types.js";

const MANIFEST_REL_PATH = ".sipcode/manifest.md";

export interface RepoContextOptions {
  /** When true, never fall back — return zeroed context if manifest absent. */
  readonly manifestOnly?: boolean;
}

/** Parse the manifest header for `- files-scanned: N`. Returns 0 if missing. */
export function parseFilesScannedFromManifest(content: string): number {
  const m = content.match(/^- files-scanned:\s*(\d+)\s*$/m);
  if (!m || !m[1]) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 0;
}

/** Parse `- framework: <label>` out of the `## Framework` section. */
export function parseFrameworkFromManifest(content: string): string {
  const m = content.match(/^- framework:\s*([\w-]+)\s*$/m);
  if (!m || !m[1]) return "unknown";
  return m[1];
}

/** Approx-token-count the manifest itself — proxy for "context the agent loads". */
export function manifestTokensFor(content: string): number {
  return approxTokenCount(content);
}

export async function loadRepoContext(
  fs: FileSystem,
  cwd: string,
  opts: RepoContextOptions = {},
): Promise<RepoContext> {
  const manifestAbs = path.join(cwd, MANIFEST_REL_PATH);
  if (await fs.exists(manifestAbs)) {
    try {
      const content = await fs.readFile(manifestAbs);
      const fileCount = parseFilesScannedFromManifest(content);
      const framework = parseFrameworkFromManifest(content);
      const manifestTokens = manifestTokensFor(content);
      return {
        fileCount,
        framework,
        manifestPresent: true,
        manifestTokens,
        fallbackNote: "",
      };
    } catch {
      // Fall through to quick scan.
    }
  }

  if (opts.manifestOnly) {
    return {
      fileCount: 0,
      framework: "unknown",
      manifestPresent: false,
      manifestTokens: 0,
      fallbackNote: "no manifest found — repo size unknown",
    };
  }

  // Fallback: quick scan, file count only.
  let fileCount = 0;
  try {
    const files = await scanFiles(fs, cwd);
    fileCount = files.length;
  } catch {
    fileCount = 0;
  }
  return {
    fileCount,
    framework: "unknown",
    manifestPresent: false,
    manifestTokens: 0,
    fallbackNote:
      "no manifest — using quick scan; run `sipcode init` for sharper estimates",
  };
}
