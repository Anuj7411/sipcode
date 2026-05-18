/**
 * CLAUDE.md injection — idempotent block between stable markers.
 *
 * We never blindly overwrite. If the user has hand-edited content inside
 * the markers, we refuse (E005) and let them sort it out.
 */
import { err, ok, type Result } from "./result.js";
import { issue, type SipcodeIssue } from "./errors.js";

export const MARKER_START = "<!-- sipcode:start v=1 -->";
export const MARKER_END = "<!-- sipcode:end -->";

export interface ExtractedClaudeMd {
  /** Content before the start marker (or full content if no markers). */
  readonly before: string;
  /** Content between markers, or undefined if no sipcode block. */
  readonly sipcode: string | undefined;
  /** Content after the end marker (empty if no markers). */
  readonly after: string;
}

/**
 * Pull apart an existing CLAUDE.md into (before, sipcode-block?, after).
 * Returns null if file is empty.
 *
 * Tolerates exactly one sipcode block. Two or more is E005-territory and
 * surfaces as `sipcode === undefined` from the caller's perspective via
 * `injectSection`.
 */
export function extractExisting(content: string): ExtractedClaudeMd | null {
  if (content.length === 0) return null;
  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);
  if (startIdx === -1 && endIdx === -1) {
    return { before: content, sipcode: undefined, after: "" };
  }
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return { before: content, sipcode: undefined, after: "" };
  }
  // Count markers — duplicates are a hand-edit hazard.
  const startCount = (content.match(new RegExp(escapeRe(MARKER_START), "g")) ?? [])
    .length;
  const endCount = (content.match(new RegExp(escapeRe(MARKER_END), "g")) ?? [])
    .length;
  if (startCount !== 1 || endCount !== 1) {
    return { before: content, sipcode: undefined, after: "" };
  }
  const before = content.slice(0, startIdx);
  const sipcode = content.slice(
    startIdx + MARKER_START.length,
    endIdx,
  );
  const after = content.slice(endIdx + MARKER_END.length);
  return { before, sipcode, after };
}

/**
 * Compose the sipcode block that goes between markers (without the markers
 * themselves). The shape is stable across runs so re-injection is idempotent.
 */
export function renderSipcodeBlock(opts: {
  manifestPath: string;
  generatedAt: string;
}): string {
  return [
    "",
    "## Sipcode",
    "",
    "This project is managed by Sipcode. See the project manifest for",
    "the file tree, hot files, import graph, and detected patterns:",
    "",
    `- Manifest: \`${opts.manifestPath}\` (re-generated with \`npx sipcode manifest\`)`,
    `- Generated: ${opts.generatedAt}`,
    "",
    "Read the manifest BEFORE exploring the codebase. It exists so you",
    "don't have to grep for context.",
    "",
  ].join("\n");
}

/**
 * Inject (or refresh) the sipcode block in CLAUDE.md.
 *
 * Rules:
 *  - No markers in existing content     -> append a clean block at the end.
 *  - Exactly one valid marker pair      -> replace the block between them.
 *  - Anything else (no end, dup markers, manual edits between markers that
 *    don't look like our render)        -> E005, return Issues, no write.
 *
 * The "looks like our render" check is loose: we accept any content that
 * starts with a blank line and contains "## Sipcode". Users adding extra
 * notes outside the marker pair (before/after) is fine and preserved.
 */
export function injectSection(
  currentContent: string,
  block: string,
): Result<string, SipcodeIssue[]> {
  if (currentContent.length === 0) {
    // Brand-new file.
    return ok(`${MARKER_START}${block}${MARKER_END}\n`);
  }

  const parsed = extractExisting(currentContent);
  if (!parsed) {
    return ok(`${MARKER_START}${block}${MARKER_END}\n`);
  }

  if (parsed.sipcode === undefined) {
    // No existing block. If markers are completely absent, append.
    if (
      !currentContent.includes(MARKER_START) &&
      !currentContent.includes(MARKER_END)
    ) {
      const sep = currentContent.endsWith("\n") ? "" : "\n";
      return ok(
        `${currentContent}${sep}\n${MARKER_START}${block}${MARKER_END}\n`,
      );
    }
    // Markers exist but are malformed / duplicated / hand-edited.
    return err([
      issue(
        "E005",
        "claude.md has sipcode markers that look hand-edited or duplicated. refusing to overwrite.",
        { path: "CLAUDE.md" },
      ),
    ]);
  }

  // Check the existing block "looks like" our render. If a user replaced
  // the body with their own prose, refuse.
  if (!isOurBlockShape(parsed.sipcode)) {
    return err([
      issue(
        "E005",
        "claude.md has hand-edited content inside the sipcode markers. refusing to overwrite.",
        { path: "CLAUDE.md" },
      ),
    ]);
  }

  return ok(
    `${parsed.before}${MARKER_START}${block}${MARKER_END}${parsed.after}`,
  );
}

function isOurBlockShape(body: string): boolean {
  // Accept empty (first-write race) or anything containing our heading.
  if (body.trim().length === 0) return true;
  return body.includes("## Sipcode");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
