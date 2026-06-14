/**
 * Canonical file-path normalizer for "is this the same file?" checks.
 *
 * Used wherever we key a cache or count uniqueness by file path:
 *   - The drift analyzer (`duplicateReads.ts`) — counts cross-turn dupes.
 *   - The dedup orchestrator (`hookReadDedup.ts`) — refuses re-reads at
 *     PreToolUse time.
 *   - The heuristic walker (`vsRtk.ts`) — credits B5 dedup over recorded
 *     transcripts.
 *
 * Before v1.6.14 these used to disagree: drift normalized, dedup did not.
 * Result: drift would see ~25 dupes in a real session and dedup would catch
 * only 3 because Claude Code sometimes sends `C:\foo\bar.ts` and other turns
 * send `c:/foo/bar.ts` for the same on-disk file. The dedup cache key never
 * matched. This module is the single source of truth that closes the gap.
 *
 * Pure. No I/O.
 */
import path from "node:path";

export function normalizeFilePath(p: string): string {
  if (typeof p !== "string" || p.length === 0) return p;
  // 1. Backslashes → forward slashes (Windows paths look like POSIX after this).
  let s = p.replace(/\\/g, "/");
  // 2. Lowercase Windows drive letter (`C:` → `c:`).
  s = s.replace(/^([A-Z]):/, (_m, d: string) => d.toLowerCase() + ":");
  // 3. Collapse ./ and ../ where safe.
  try {
    s = path.posix.normalize(s);
  } catch {
    /* posix.normalize never throws on real input, but guard anyway */
  }
  return s;
}
