/** Terminal renderer for `sipcode regress`. Pure. */
import { MESSAGES } from "../../lib/messages.js";
import { compressedSkippedMessage } from "../agents/loadSessions.js";
import { formatBugReport } from "./bug-report.js";
import { fmtN } from "./helpers.js";
import { notCompared, type RegressReport } from "./report.js";
import type { Finding } from "./types.js";

function claudeLine(report: RegressReport): string {
  const c = report.claude!.coverage;
  if (c.requests === 0) {
    return c.excludedAutomated > 0
      ? `Claude Code: no interactive requests in ${report.claudeDir} (${fmtN(c.excludedAutomated)} subagent and Agent SDK requests left out of the comparison)`
      : `Claude Code: no readable interactive requests in ${report.claudeDir}`;
  }
  return (
    `Claude Code: ${fmtN(c.requests)} interactive requests in ${fmtN(c.sessions)} sessions ` +
    `(${fmtN(c.excludedAutomated)} subagent and Agent SDK requests left out of the comparison), ` +
    `${c.from} to ${c.to}, versions ${c.firstVersion} to ${c.lastVersion}`
  );
}

function codexLine(report: RegressReport): string {
  const c = report.codex!.coverage;
  if (c.requests === 0) return `Codex: no readable requests in ${report.codexDir}`;
  return (
    `Codex: ${fmtN(c.requests)} requests in ${fmtN(c.sessions)} sessions, ${c.from} to ${c.to}, ` +
    `versions ${c.firstVersion} to ${c.lastVersion}, ${fmtN(c.groups)} version/model groups with enough limit data`
  );
}

function findingLines(f: Finding): string[] {
  const tool = f.agent === "claude-code" ? "Claude Code" : "Codex";
  const range = f.to !== f.from ? `${f.from} to ${f.to}` : f.from;
  const known = f.known.length ? `  = known ${f.known.map((k) => k.id).join(", ")}` : "  (not in the known-issue catalog)";
  return [
    `● ${f.title}  [${f.id}]  ${tool} ${range}${known}`,
    ...f.evidence.map((e) => `    ${e}`),
    ...f.examples.map((e) => `    e.g. ${e}`),
    ...(f.note ? [`    note: ${f.note}`] : []),
  ];
}

export function formatRegressTerminal(
  report: RegressReport,
  opts: {
    readonly bugReport: boolean;
    readonly version: string;
    /**
     * Per-tool warnings about logs that could not be read (unreadWarnings),
     * printed first. They name the skipped compressed logs, so the note below
     * the coverage lines is then left out.
     */
    readonly unreadWarnings?: readonly string[];
  },
): string {
  const top = opts.unreadWarnings ?? [];
  const lines = [...top, ...(top.length > 0 ? [""] : []), ...body(report, opts, top.length > 0)];
  // --bug-report with nothing to report still answers the flag: a run that only
  // repeated the plain result read as "no output" to Codex.
  if (opts.bugReport && report.findings.length === 0) lines.push("", MESSAGES.regressNoBugReport);
  return lines.join("\n");
}

function body(
  report: RegressReport,
  opts: { readonly bugReport: boolean; readonly version: string },
  warnedAbove: boolean,
): string[] {
  const lines = ["sipcode regress · local only, no network"];
  if (report.claude) {
    lines.push(claudeLine(report));
    const k = report.claude.coverage.knownWindowsCovered;
    lines.push(`Known-regression windows your logs cover: ${k.length ? k.join(", ") : "none"}`);
  }
  if (report.codex) lines.push(codexLine(report));
  const a = report.access;
  for (const d of a.missingDirs) lines.push(`Not found or not readable: ${d}`);
  const unreadable = a.unreadableFiles + a.unreadableFolders;
  // Only the folders this run read (the other one is "" with --agent).
  const dirs = [report.claudeDir, report.codexDir].filter((d) => d !== "");
  if (unreadable > 0) lines.push(MESSAGES.regressUnreadable(unreadable, dirs));
  if (a.skippedCompressed > 0 && !warnedAbove) lines.push(`note: ${compressedSkippedMessage(a.skippedCompressed)}`);
  lines.push("");
  if (a.nothingRead) {
    lines.push(MESSAGES.regressNothingToAnalyse);
    return lines;
  }
  if (report.findings.length === 0 && !report.comparable) {
    lines.push(MESSAGES.regressNotEnoughData(report.minN, report.agents));
    return lines;
  }
  if (report.findings.length === 0) lines.push(MESSAGES.regressNoFindings);
  for (const f of report.findings) lines.push(...findingLines(f));
  // A tool that was read but had no versions to compare must not pass for a clean result.
  for (const agent of notCompared(report)) lines.push(MESSAGES.regressAgentNotEnoughData(agent, report.minN));
  if (report.findings.some((f) => f.known.length === 0)) lines.push("", MESSAGES.regressSignalNotProof);
  if (opts.bugReport && report.findings.length > 0) {
    lines.push("", "---- paste into a GitHub issue (review it first) ----", "", formatBugReport(report, opts.version)!);
  }
  return lines;
}
