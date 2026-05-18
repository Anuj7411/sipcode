/**
 * Textual diff for `sipcode rules --diff`. We don't pull a real diff
 * library — this is a small two-pane summary plus a unified-ish hunk so
 * the user can see what would change.
 */

export interface RulesDiff {
  readonly identical: boolean;
  readonly summary: string;
  readonly hunk: string;
}

export function computeDiff(before: string, after: string): RulesDiff {
  if (before === after) {
    return {
      identical: true,
      summary: "no changes — already at target state.",
      hunk: "",
    };
  }

  const beforeLines = before.length === 0 ? [] : before.split("\n");
  const afterLines = after.length === 0 ? [] : after.split("\n");

  // Find common prefix/suffix to keep the hunk small.
  let prefix = 0;
  const maxPrefix = Math.min(beforeLines.length, afterLines.length);
  while (prefix < maxPrefix && beforeLines[prefix] === afterLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] ===
      afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const removed = beforeLines.slice(prefix, beforeLines.length - suffix);
  const added = afterLines.slice(prefix, afterLines.length - suffix);

  const summary =
    `${added.length} line(s) added, ${removed.length} line(s) removed.`;

  const contextStart = Math.max(0, prefix - 2);
  const contextEnd = Math.min(beforeLines.length, beforeLines.length - suffix + 2);
  const contextBefore = beforeLines.slice(contextStart, prefix);
  const contextAfter = beforeLines.slice(beforeLines.length - suffix, contextEnd);

  const hunkLines: string[] = [];
  hunkLines.push(`@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`);
  for (const l of contextBefore) hunkLines.push(`  ${l}`);
  for (const l of removed) hunkLines.push(`- ${l}`);
  for (const l of added) hunkLines.push(`+ ${l}`);
  for (const l of contextAfter) hunkLines.push(`  ${l}`);

  return {
    identical: false,
    summary,
    hunk: hunkLines.join("\n"),
  };
}
