/**
 * snapshot — build a CodebaseSnapshot from a project root.
 *
 * The ONLY I/O step in the score pipeline. Every check is pure over the
 * snapshot. Reuses modules/manifest/ for file scanning, parsing, framework
 * detection, and pattern inference.
 */
import path from "node:path";
import type { FileSystem } from "../../lib/fs.js";
import { scanFiles } from "../manifest/scanFiles.js";
import { parseFile } from "../manifest/parseFile.js";
import { detectFramework } from "../manifest/framework.js";
import { detectPatterns } from "../manifest/patterns.js";
import type {
  ParsedFile,
  ScannedFile,
} from "../manifest/types.js";
import type { CodebaseSnapshot } from "./types.js";

export interface BuildSnapshotInput {
  readonly fs: FileSystem;
  readonly projectRoot: string;
}

/** Files we conditionally read in full for content-aware checks. */
const FINGERPRINT_FILES = [
  "CLAUDE.md",
  "README.md",
  "README",
  "README.markdown",
  "AGENTS.md",
  ".cursorrules",
  ".sipcode/manifest.md",
  "package.json",
  "pyproject.toml",
  "go.mod",
] as const;

/** Source-file extensions we walk for LOC / first-line-comment data. */
const SOURCE_EXTS = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "go",
]);

export async function buildSnapshot(
  input: BuildSnapshotInput,
): Promise<CodebaseSnapshot> {
  const { fs, projectRoot } = input;

  // 1. Scan.
  const scanned = await scanFiles(fs, projectRoot);
  const fileIndex = new Map<string, ScannedFile>();
  for (const s of scanned) fileIndex.set(s.path, s);
  const hasFile = (rel: string): boolean => fileIndex.has(rel);

  // 2. Read fingerprint files (best-effort).
  const reads = await readFingerprints(fs, projectRoot);

  // 3. Determine project name.
  let projectName = path.basename(projectRoot);
  if (reads.packageJson && typeof reads.packageJson === "object") {
    const n = (reads.packageJson as { name?: unknown }).name;
    if (typeof n === "string" && n.length > 0) projectName = n;
  }

  // 4. Parse source files (regex extractor — no AST native deps).
  const parsed: ParsedFile[] = [];
  for (const s of scanned) {
    if (s.language === "other") continue;
    let content: string;
    try {
      content = await fs.readFile(path.join(projectRoot, s.path));
    } catch {
      continue;
    }
    const r = await parseFile({
      relPath: s.path,
      content,
      language: s.language,
    });
    if (r.ok) parsed.push(r.value);
  }

  // 5. Patterns + framework.
  const framework = detectFramework({
    packageJson: reads.packageJson,
    hasFile,
    scanned,
  });
  const patterns = detectPatterns({
    parsed,
    scanned,
    packageJson: reads.packageJson,
    hasFile,
  });

  // 6. LOC + first-line-of-file comments for source files.
  const lineCounts = new Map<string, number>();
  const firstLineComment = new Map<string, string | undefined>();
  for (const s of scanned) {
    if (!SOURCE_EXTS.has(s.ext)) continue;
    let content: string;
    try {
      content = await fs.readFile(path.join(projectRoot, s.path));
    } catch {
      continue;
    }
    lineCounts.set(s.path, countLines(content));
    firstLineComment.set(s.path, firstNonBlankComment(content, s.ext));
  }

  return {
    projectRoot,
    projectName,
    scanned,
    fileIndex,
    hasFile,
    claudeMd: reads.claudeMd,
    readme: reads.readme,
    agentsMd: reads.agentsMd,
    cursorRules: reads.cursorRules,
    sipcodeManifest: reads.sipcodeManifest,
    packageJson: reads.packageJson,
    pyprojectToml: reads.pyprojectToml,
    goMod: reads.goMod,
    parsed,
    patterns,
    framework,
    lineCounts,
    firstLineComment,
  };
}

interface FingerprintReads {
  claudeMd?: string;
  readme?: string;
  agentsMd?: string;
  cursorRules?: string;
  sipcodeManifest?: string;
  packageJson?: unknown;
  pyprojectToml?: string;
  goMod?: string;
}

async function readFingerprints(
  fs: FileSystem,
  root: string,
): Promise<FingerprintReads> {
  const out: FingerprintReads = {};
  for (const f of FINGERPRINT_FILES) {
    const abs = path.join(root, f);
    if (!(await fs.exists(abs))) continue;
    let content: string;
    try {
      content = await fs.readFile(abs);
    } catch {
      continue;
    }
    switch (f) {
      case "CLAUDE.md":
        out.claudeMd = content;
        break;
      case "README.md":
      case "README":
      case "README.markdown":
        if (out.readme === undefined) out.readme = content;
        break;
      case "AGENTS.md":
        out.agentsMd = content;
        break;
      case ".cursorrules":
        out.cursorRules = content;
        break;
      case ".sipcode/manifest.md":
        out.sipcodeManifest = content;
        break;
      case "package.json":
        try {
          out.packageJson = JSON.parse(content);
        } catch {
          out.packageJson = undefined;
        }
        break;
      case "pyproject.toml":
        out.pyprojectToml = content;
        break;
      case "go.mod":
        out.goMod = content;
        break;
    }
  }
  return out;
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) n++;
  }
  return n;
}

/**
 * Return the first non-blank line if it's a comment, else undefined. Used by
 * SC032 to detect whether a file declares its purpose without being read in
 * full.
 */
function firstNonBlankComment(
  content: string,
  ext: string,
): string | undefined {
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (ext === "py") {
      if (line.startsWith("#") && !line.startsWith("#!")) return line;
      if (line.startsWith('"""') || line.startsWith("'''")) return line;
      return undefined;
    }
    if (ext === "go") {
      if (line.startsWith("//")) return line;
      if (line.startsWith("/*")) return line;
      return undefined;
    }
    // JS/TS family.
    if (line.startsWith("//")) return line;
    if (line.startsWith("/*")) return line;
    return undefined;
  }
  return undefined;
}
