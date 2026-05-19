/**
 * Cursor rules file — path resolution + marker injection.
 *
 * Cursor supports two rules conventions:
 *   1. (preferred) `.cursor/rules/sipcode.mdc` — per-rule files with optional
 *      YAML frontmatter for glob scoping. Each .mdc file is one rule pack.
 *   2. (legacy)    `.cursorrules` — single-file rules at repo root.
 *
 * We reuse the existing marker logic from lib/claudeMd.ts so the cursor file
 * carries the same `<!-- sipcode:start v=2 -->` / `<!-- sipcode:end -->`
 * wrapper with named sub-blocks. Anything outside our markers is the user's
 * (or Cursor's own) territory and we never touch it.
 *
 * .mdc files may include a frontmatter block (--- ... ---) above our content.
 * On write we preserve any existing frontmatter; if none exists, we add the
 * canonical sipcode frontmatter once. The frontmatter sits BEFORE the sipcode
 * markers, so the marker logic in claudeMd.ts works unchanged.
 */
import path from "node:path";
import {
  removeSubBlock,
  upsertSubBlock,
} from "../../../lib/claudeMd.js";
import type { Result } from "../../../lib/result.js";
import type { SipcodeIssue } from "../../../lib/errors.js";
import type { FileSystem } from "../../../lib/fs.js";

export const MDC_PATH_SEGMENTS = [".cursor", "rules", "sipcode.mdc"] as const;
export const LEGACY_PATH_SEGMENT = ".cursorrules";

export const SIPCODE_MDC_FRONTMATTER = [
  "---",
  "description: Sipcode-managed instructions for AI coding",
  "alwaysApply: true",
  "---",
  "",
].join("\n");

/** A frontmatter block at the very top of the file: --- ... --- */
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

export interface ResolvedRulesPath {
  /** Absolute path the rules file lives at (or would live at on first write). */
  readonly path: string;
  /** Whether this is the .mdc form (true) or legacy .cursorrules (false). */
  readonly isMdc: boolean;
  /** Whether the path currently exists on disk. */
  readonly exists: boolean;
}

/**
 * Resolve where Cursor rules live in this cwd. Preference order:
 *   1. Existing `.cursor/rules/sipcode.mdc`
 *   2. Existing `.cursorrules`
 *   3. New `.cursor/rules/sipcode.mdc` (if `.cursor/` directory exists)
 *   4. New `.cursor/rules/sipcode.mdc` (default; we'll create the dir)
 *
 * `preferLegacy` flips the preference toward `.cursorrules` when no rules file
 * exists yet.
 */
export async function resolveCursorRulesPath(
  fs: FileSystem,
  cwd: string,
  preferLegacy = false,
): Promise<ResolvedRulesPath> {
  const mdcPath = path.join(cwd, ...MDC_PATH_SEGMENTS);
  const legacyPath = path.join(cwd, LEGACY_PATH_SEGMENT);

  const mdcExists = await fs.exists(mdcPath);
  if (mdcExists) return { path: mdcPath, isMdc: true, exists: true };

  const legacyExists = await fs.exists(legacyPath);
  if (legacyExists) return { path: legacyPath, isMdc: false, exists: true };

  if (preferLegacy) {
    return { path: legacyPath, isMdc: false, exists: false };
  }
  return { path: mdcPath, isMdc: true, exists: false };
}

/** Split frontmatter from body. Returns `{frontmatter: "", body: full}` if none. */
export function splitFrontmatter(content: string): {
  frontmatter: string;
  body: string;
} {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: "", body: content };
  return { frontmatter: m[0], body: content.slice(m[0].length) };
}

/** Build the on-disk content for an .mdc rules file from an injected body. */
export function buildMdcContent(args: {
  existing: string;
  injectedBody: string;
  /** When true, add canonical sipcode frontmatter if none exists. */
  ensureFrontmatter: boolean;
}): string {
  const { frontmatter } = splitFrontmatter(args.existing);
  if (frontmatter.length > 0) return frontmatter + args.injectedBody;
  if (args.ensureFrontmatter) {
    return SIPCODE_MDC_FRONTMATTER + args.injectedBody;
  }
  return args.injectedBody;
}

/**
 * Upsert a sub-block into the cursor rules file content. Delegates to the
 * marker logic in lib/claudeMd.ts so format and idempotence match exactly.
 *
 * For .mdc files: frontmatter is stripped before the marker logic runs and
 * re-prepended after, so the marker invariants (e.g. "exactly one start
 * marker") apply only to the body.
 */
export function upsertCursorBlock(
  existing: string,
  block: { name: string; mode?: string; body: string },
  isMdc: boolean,
): Result<string, SipcodeIssue[]> {
  if (!isMdc) {
    return upsertSubBlock(existing, {
      name: block.name,
      ...(block.mode !== undefined ? { mode: block.mode } : {}),
      body: block.body,
    });
  }

  const split = splitFrontmatter(existing);
  const next = upsertSubBlock(split.body, {
    name: block.name,
    ...(block.mode !== undefined ? { mode: block.mode } : {}),
    body: block.body,
  });
  if (!next.ok) return next;

  if (split.frontmatter.length > 0) {
    return { ok: true, value: split.frontmatter + next.value };
  }
  return { ok: true, value: SIPCODE_MDC_FRONTMATTER + next.value };
}

/** Remove a named sub-block from cursor rules content. */
export function removeCursorBlock(
  existing: string,
  blockName: string,
  isMdc: boolean,
): Result<string, SipcodeIssue[]> {
  if (!isMdc) return removeSubBlock(existing, blockName);

  const split = splitFrontmatter(existing);
  const next = removeSubBlock(split.body, blockName);
  if (!next.ok) return next;
  return { ok: true, value: split.frontmatter + next.value };
}
