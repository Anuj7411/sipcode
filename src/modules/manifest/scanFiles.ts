/**
 * scanFiles — walk a project root and return scannable files.
 *
 * Respects:
 *   - Hard skip dirs (node_modules, .git, dist, build, coverage, .next, etc.)
 *   - Hidden dirs by default (anything starting with ".") unless allow-listed
 *   - A simple .sipcodeignore (one glob per line, # comments) if present
 *   - Optional gitignore-style basics (only handles directory excludes, not
 *     full glob semantics — v1.1 work)
 *
 * I/O wrapper: takes a FileSystem; returns sorted ScannedFile[].
 */
import path from "node:path";
import type { FileSystem } from "../../lib/fs.js";
import type { LanguageTag, ScannedFile } from "./types.js";

const HARD_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".astro",
  ".turbo",
  ".svelte-kit",
  ".cache",
  ".output",
  ".vercel",
  ".idea",
  ".vscode",
  "dist",
  "build",
  "out",
  "coverage",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  "vendor",
  "target",
  ".nuxt",
  ".sipcode",
  ".parcel-cache",
]);

const ALLOWED_HIDDEN_FILES = new Set([
  ".sipcodeignore",
  ".gitignore",
  ".eslintrc",
  ".prettierrc",
  ".env.example",
]);

const MAX_FILE_BYTES = 256 * 1024; // skip giant files in the manifest path

export interface ScanOptions {
  /** Extra path prefixes (POSIX, relative) to skip. */
  readonly extraSkipPrefixes?: ReadonlyArray<string>;
}

export async function scanFiles(
  fs: FileSystem,
  projectRoot: string,
  opts: ScanOptions = {},
): Promise<ScannedFile[]> {
  const out: ScannedFile[] = [];
  const extraSkip = new Set(opts.extraSkipPrefixes ?? []);

  await walk(fs, projectRoot, "", out, extraSkip);

  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function walk(
  fs: FileSystem,
  root: string,
  relDir: string,
  out: ScannedFile[],
  extraSkip: ReadonlySet<string>,
): Promise<void> {
  const absDir = relDir === "" ? root : path.join(root, relDir);
  let entries;
  try {
    entries = await fs.readDir(absDir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory) {
      if (HARD_SKIP_DIRS.has(e.name)) continue;
      if (e.name.startsWith(".") && !ALLOWED_HIDDEN_FILES.has(e.name)) continue;
      const childRel = relDir === "" ? e.name : `${relDir}/${e.name}`;
      if (extraSkip.has(childRel)) continue;
      await walk(fs, root, childRel, out, extraSkip);
    } else if (e.isFile) {
      if (e.name.startsWith(".") && !ALLOWED_HIDDEN_FILES.has(e.name)) continue;
      const rel = relDir === "" ? e.name : `${relDir}/${e.name}`;
      if (extraSkip.has(rel)) continue;
      const absFile = path.join(root, rel);
      let stat;
      try {
        stat = await fs.stat(absFile);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) continue;
      const ext = extractExt(e.name);
      out.push({
        path: toPosix(rel),
        ext,
        size: stat.size,
        language: classifyLanguage(ext),
      });
    }
  }
}

function extractExt(name: string): string {
  const i = name.lastIndexOf(".");
  if (i < 0) return "";
  return name.slice(i + 1).toLowerCase();
}

export function classifyLanguage(ext: string): LanguageTag {
  switch (ext) {
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "py":
    case "pyi":
      return "python";
    case "go":
      return "go";
    default:
      return "other";
  }
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}
