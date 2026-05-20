/**
 * Textual diff for `sipcode hygiene --diff`.
 *
 * We diff TWO files: CLAUDE.md and settings.json. Output is a single
 * combined hunk view so the user sees everything that would change.
 */
import { computeDiff, type RulesDiff } from "../rules/diff.js";

export interface HygieneDiff {
  readonly identical: boolean;
  readonly summary: string;
  readonly claudeMd: RulesDiff;
  readonly settings: RulesDiff;
  readonly hunk: string;
}

export function computeHygieneDiff(
  beforeClaudeMd: string,
  afterClaudeMd: string,
  beforeSettings: string,
  afterSettings: string,
): HygieneDiff {
  const claudeMd = computeDiff(beforeClaudeMd, afterClaudeMd);
  const settings = computeDiff(beforeSettings, afterSettings);
  const identical = claudeMd.identical && settings.identical;
  const parts: string[] = [];
  if (!claudeMd.identical) {
    parts.push(`--- CLAUDE.md`, claudeMd.hunk);
  }
  if (!settings.identical) {
    parts.push(`--- settings.json`, settings.hunk);
  }
  const summary = identical
    ? "no changes — hygiene already in target state."
    : [
        claudeMd.identical ? "CLAUDE.md unchanged" : `CLAUDE.md: ${claudeMd.summary}`,
        settings.identical ? "settings.json unchanged" : `settings.json: ${settings.summary}`,
      ].join("; ");
  return {
    identical,
    summary,
    claudeMd,
    settings,
    hunk: parts.join("\n"),
  };
}
