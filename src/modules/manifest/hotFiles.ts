/**
 * hotFiles — top files by git change frequency.
 *
 * Reads git log via the Git seam (no direct child_process). Returns a
 * stably-sorted top-N. If git isn't available, returns an E006 issue and
 * an empty list — the manifest renders without this section.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { issue, type SipcodeIssue } from "../../lib/errors.js";
import type { Git } from "../../lib/git.js";
import type { HotFile } from "./types.js";

const DEFAULT_SINCE_DAYS = 90;
const DEFAULT_TOP_N = 20;

export interface HotFilesInput {
  readonly git: Git;
  readonly projectRoot: string;
  readonly knownFiles: ReadonlySet<string>;
  readonly sinceDays?: number;
  readonly topN?: number;
}

export async function computeHotFiles(
  input: HotFilesInput,
): Promise<Result<ReadonlyArray<HotFile>, SipcodeIssue[]>> {
  if (!(await input.git.available(input.projectRoot))) {
    return err([issue("E006", "git not available; hot-files index disabled")]);
  }

  const log = await input.git.logSince(
    input.projectRoot,
    input.sinceDays ?? DEFAULT_SINCE_DAYS,
  );

  const counts = new Map<string, number>();
  for (const entry of log) {
    for (const f of entry.files) {
      const posix = f.replace(/\\/g, "/");
      // Only count files we actually scanned — drops renamed-away files etc.
      if (!input.knownFiles.has(posix)) continue;
      counts.set(posix, (counts.get(posix) ?? 0) + 1);
    }
  }

  const ranked: HotFile[] = [...counts.entries()]
    .map(([p, n]) => ({ path: p, changes: n }))
    .sort((a, b) => {
      if (b.changes !== a.changes) return b.changes - a.changes;
      return a.path.localeCompare(b.path);
    })
    .slice(0, input.topN ?? DEFAULT_TOP_N);

  return ok(ranked);
}
