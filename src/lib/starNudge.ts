/**
 * One-time "star us on GitHub" nudge.
 *
 * Shown once per machine, ever, at a moment of demonstrated value (after
 * `sipcode proxy --stats` reports real savings). Gated on a marker file under
 * ~/.sipcode so it never repeats and never blocks. Makes NO network call: it
 * only decides whether to print a line and writes a local marker.
 */
import path from "node:path";

export interface StarNudgeIO {
  /** True if the nudge has already been shown (marker exists). */
  hasMarker(absPath: string): Promise<boolean>;
  /** Write the marker so the nudge never shows again. */
  writeMarker(absPath: string, content: string): Promise<void>;
}

const MARKER_CONTENT = "sipcode-star-nudge/1";

/** Path to the one-time marker under the user's ~/.sipcode directory. */
export function starNudgeMarkerPath(homeDir: string): string {
  return path.join(homeDir, ".sipcode", ".star-nudge");
}

/**
 * Returns true the first time it is called for a machine, then false forever
 * after. Writing the marker is best-effort: if the write fails we still return
 * true this once (a rare repeat beats crashing a stats command).
 */
export async function shouldShowStarNudge(
  io: StarNudgeIO,
  homeDir: string,
): Promise<boolean> {
  const marker = starNudgeMarkerPath(homeDir);
  if (await io.hasMarker(marker)) return false;
  try {
    await io.writeMarker(marker, MARKER_CONTENT);
  } catch {
    /* best-effort: still nudge once even if the marker write fails */
  }
  return true;
}
