/**
 * Variant detection — was Sipcode active during the session being audited?
 *
 * Pure: takes a FileSystem (seam), the project root, and the session's start
 * timestamp. Returns "post-install" or "pre-install".
 *
 * Rule (kept deliberately simple for v0.1.0-alpha.3):
 *   - If we cannot locate a project root → default to "post-install" (optimistic).
 *   - If `<projectRoot>/.sipcode/manifest.md` exists → "post-install".
 *   - Otherwise → "pre-install".
 *
 * Note: the brief mentions matching `HEAD@<sha>` to a git ref older than the
 * session's earliest timestamp. Per the brief's own "keep simple" guidance and
 * because git refs aren't always present, v0.1.0-alpha.3 ships the manifest-
 * existence check. Timestamp comparison is left for v1.1.
 */
import path from "node:path";
import type { FileSystem } from "../../lib/fs.js";
import type { ReceiptVariant } from "./types.js";

export interface DetectVariantInput {
  /**
   * Absolute path to the project root we believe the session ran in. May be
   * undefined if discovery couldn't recover the cwd from the transcript.
   */
  readonly projectRoot: string | undefined;
  /** ISO timestamp of the session's earliest assistant turn. */
  readonly sessionStartedAt: string | undefined;
}

export async function detectVariant(
  fs: FileSystem,
  input: DetectVariantInput,
): Promise<ReceiptVariant> {
  // Default to the optimistic frame when we can't be sure.
  if (!input.projectRoot) return "post-install";

  const manifestPath = path.join(input.projectRoot, ".sipcode", "manifest.md");
  const hasManifest = await fs.exists(manifestPath);
  return hasManifest ? "post-install" : "pre-install";
}
