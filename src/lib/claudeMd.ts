/**
 * CLAUDE.md injection — idempotent block between stable markers.
 *
 * v=2 layout: the outer markers wrap zero-or-more NAMED sub-blocks.
 * The v=1 layout (anonymous body under v=1 markers) is migrated to v=2
 * transparently: the body becomes a single named sub-block "manifest".
 */
import { err, ok, type Result } from "./result.js";
import { issue, type SipcodeIssue } from "./errors.js";

export const MARKER_START_V1 = "<!-- sipcode:start v=1 -->";
export const MARKER_START_V2 = "<!-- sipcode:start v=2 -->";
export const MARKER_END = "<!-- sipcode:end -->";

/** Default current-version start marker. */
export const MARKER_START = MARKER_START_V2;

const SUB_OPEN_RE =
  /<!--\s*sipcode:block\s+name="([^"]+)"(?:\s+mode="([^"]+)")?\s*-->/g;
const SUB_CLOSE = "<!-- /sipcode:block -->";

export interface SubBlock {
  readonly name: string;
  readonly mode?: string;
  readonly body: string;
}

export interface ExtractedClaudeMd {
  readonly before: string;
  readonly sipcode: string | undefined;
  readonly after: string;
  readonly version?: 1 | 2;
}

export function extractExisting(content: string): ExtractedClaudeMd | null {
  if (content.length === 0) return null;

  const found = findOuterMarkers(content);
  if (!found) {
    return { before: content, sipcode: undefined, after: "" };
  }

  if (!found.valid) {
    return { before: content, sipcode: undefined, after: "" };
  }

  return {
    before: content.slice(0, found.startIdx),
    sipcode: content.slice(found.bodyStart, found.bodyEnd),
    after: content.slice(found.endIdx + MARKER_END.length),
    version: found.version,
  };
}

interface OuterMatch {
  readonly valid: boolean;
  readonly version: 1 | 2;
  readonly startIdx: number;
  readonly bodyStart: number;
  readonly bodyEnd: number;
  readonly endIdx: number;
}

function findOuterMarkers(content: string): OuterMatch | null {
  const v2Start = content.indexOf(MARKER_START_V2);
  const v1Start = content.indexOf(MARKER_START_V1);

  let version: 1 | 2;
  let marker: string;
  let startIdx: number;

  if (v2Start !== -1) {
    version = 2;
    marker = MARKER_START_V2;
    startIdx = v2Start;
  } else if (v1Start !== -1) {
    version = 1;
    marker = MARKER_START_V1;
    startIdx = v1Start;
  } else {
    return null;
  }

  const endIdx = content.indexOf(MARKER_END);
  if (endIdx === -1 || endIdx < startIdx) {
    return {
      valid: false,
      version,
      startIdx,
      bodyStart: startIdx + marker.length,
      bodyEnd: endIdx === -1 ? startIdx + marker.length : endIdx,
      endIdx: endIdx === -1 ? content.length : endIdx,
    };
  }

  const startCount =
    countMatches(content, MARKER_START_V1) +
    countMatches(content, MARKER_START_V2);
  const endCount = countMatches(content, MARKER_END);
  if (startCount !== 1 || endCount !== 1) {
    return {
      valid: false,
      version,
      startIdx,
      bodyStart: startIdx + marker.length,
      bodyEnd: endIdx,
      endIdx,
    };
  }

  return {
    valid: true,
    version,
    startIdx,
    bodyStart: startIdx + marker.length,
    bodyEnd: endIdx,
    endIdx,
  };
}

function countMatches(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count += 1;
    from = idx + needle.length;
  }
  return count;
}

export function parseSubBlocks(body: string): SubBlock[] | null {
  if (!body.includes("<!-- sipcode:block")) {
    return [{ name: "manifest", body }];
  }

  const blocks: SubBlock[] = [];
  let cursor = 0;
  while (true) {
    SUB_OPEN_RE.lastIndex = cursor;
    const match = SUB_OPEN_RE.exec(body);
    if (!match) break;
    const openEnd = match.index + match[0].length;
    const closeIdx = body.indexOf(SUB_CLOSE, openEnd);
    if (closeIdx === -1) return null;
    const name = match[1]!;
    const mode = match[2];
    const innerBody = body.slice(openEnd, closeIdx);
    blocks.push(
      mode !== undefined ? { name, mode, body: innerBody } : { name, body: innerBody },
    );
    cursor = closeIdx + SUB_CLOSE.length;
  }
  return blocks;
}

export function renderSubBlocks(blocks: ReadonlyArray<SubBlock>): string {
  if (blocks.length === 0) return "\n";
  // Canonical shape: outer markers each on their own line; sub-block
  // open/close markers each on their own line; body sits between with
  // no inserted whitespace (body is responsible for its own newlines).
  let out = "\n";
  for (const b of blocks) {
    const attr = b.mode !== undefined ? ` mode="${b.mode}"` : "";
    out += `<!-- sipcode:block name="${b.name}"${attr} -->`;
    out += b.body;
    out += `${SUB_CLOSE}\n\n`;
  }
  return out;
}

export function renderSipcodeBlock(opts: {
  manifestPath: string;
  generatedAt: string;
}): string {
  return renderManifestSubBlockBody(opts);
}

export function renderManifestSubBlockBody(opts: {
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

export function injectSection(
  currentContent: string,
  block: string,
): Result<string, SipcodeIssue[]> {
  return upsertSubBlock(currentContent, { name: "manifest", body: block });
}

export function upsertSubBlock(
  currentContent: string,
  next: SubBlock,
): Result<string, SipcodeIssue[]> {
  if (currentContent.length === 0) {
    return ok(`${buildWrapped([next])}\n`);
  }

  const parsed = extractExisting(currentContent);
  if (!parsed) {
    return ok(`${buildWrapped([next])}\n`);
  }

  if (parsed.sipcode === undefined) {
    if (
      !currentContent.includes(MARKER_START_V1) &&
      !currentContent.includes(MARKER_START_V2) &&
      !currentContent.includes(MARKER_END)
    ) {
      const sep = currentContent.endsWith("\n") ? "" : "\n";
      return ok(`${currentContent}${sep}\n${buildWrapped([next])}\n`);
    }
    return err([
      issue(
        "E005",
        "claude.md has sipcode markers that look hand-edited or duplicated. refusing to overwrite.",
        { path: "CLAUDE.md" },
      ),
    ]);
  }

  const subs = parseSubBlocks(parsed.sipcode);
  if (subs === null) {
    return err([
      issue(
        "E005",
        "claude.md has an unclosed sipcode:block marker. refusing to overwrite.",
        { path: "CLAUDE.md" },
      ),
    ]);
  }

  const existingSameName = subs.find((s) => s.name === next.name);
  if (existingSameName && !subBlockLooksOurs(existingSameName)) {
    return err([
      issue(
        "E005",
        `claude.md has hand-edited content inside the sipcode "${next.name}" sub-block. refusing to overwrite.`,
        { path: "CLAUDE.md" },
      ),
    ]);
  }

  let replaced = false;
  const merged: SubBlock[] = subs.map((s) => {
    if (s.name === next.name) {
      replaced = true;
      return next;
    }
    return s;
  });
  if (!replaced) merged.push(next);

  return ok(`${parsed.before}${buildWrapped(merged)}${parsed.after}`);
}

export function removeSubBlock(
  currentContent: string,
  name: string,
): Result<string, SipcodeIssue[]> {
  if (currentContent.length === 0) return ok(currentContent);
  const parsed = extractExisting(currentContent);
  if (!parsed || parsed.sipcode === undefined) return ok(currentContent);

  const subs = parseSubBlocks(parsed.sipcode);
  if (subs === null) {
    return err([
      issue(
        "E005",
        "claude.md has an unclosed sipcode:block marker. refusing to modify.",
        { path: "CLAUDE.md" },
      ),
    ]);
  }

  const filtered = subs.filter((s) => s.name !== name);
  if (filtered.length === subs.length) return ok(currentContent);

  if (filtered.length === 0) {
    const before = parsed.before.replace(/\n+$/, "\n");
    const after = parsed.after.replace(/^\n+/, "");
    if (before.length === 0 && after.length === 0) return ok("");
    if (before.length === 0) return ok(after);
    if (after.length === 0) return ok(before);
    return ok(`${before}\n${after}`);
  }
  return ok(`${parsed.before}${buildWrapped(filtered)}${parsed.after}`);
}

export function listSubBlocks(currentContent: string): SubBlock[] | null {
  if (currentContent.length === 0) return [];
  const parsed = extractExisting(currentContent);
  if (!parsed || parsed.sipcode === undefined) return [];
  return parseSubBlocks(parsed.sipcode);
}

function buildWrapped(blocks: ReadonlyArray<SubBlock>): string {
  return `${MARKER_START_V2}${renderSubBlocks(blocks)}${MARKER_END}`;
}

function subBlockLooksOurs(s: SubBlock): boolean {
  const trimmed = s.body.trim();
  if (trimmed.length === 0) return true;
  if (s.name === "manifest") return s.body.includes("## Sipcode");
  if (s.name === "output-compression")
    return s.body.includes("Sipcode Output Compression");
  if (s.name === "session-hygiene")
    return s.body.includes("Sipcode Session Hygiene");
  return true;
}
