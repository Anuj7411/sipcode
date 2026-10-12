/**
 * JSON renderer for `sipcode regress --json`. Pure. `checks` carries every
 * check's per-version table (scripts/verify-counts.mjs compares them);
 * `bugReport` is present only with --bug-report (null when no findings).
 */
import { formatBugReport } from "./bug-report.js";
import type { RegressReport } from "./report.js";

export function formatRegressJson(
  report: RegressReport,
  opts: { readonly bugReport: boolean; readonly version: string },
): string {
  return JSON.stringify(
    {
      schemaVersion: "sipcode-regress/1",
      agents: report.agents,
      minN: report.minN,
      coverage: {
        claudeCode: report.claude ? report.claude.coverage : null,
        codex: report.codex ? report.codex.coverage : null,
      },
      access: report.access,
      comparable: report.comparable,
      comparableByAgent: {
        claudeCode: report.claude ? report.claude.comparable : null,
        codex: report.codex ? report.codex.comparable : null,
      },
      findings: report.findings.map((f) => ({
        id: f.id,
        agent: f.agent,
        title: f.title,
        from: f.from,
        to: f.to,
        known: f.known.map((k) => ({ id: k.id, what: k.what, ref: k.ref, fixed: k.fixed })),
        evidence: f.evidence,
        examples: f.examples,
        note: f.note,
      })),
      checks: {
        claudeCode: report.claude ? report.claude.tables : null,
        codex: report.codex ? report.codex.table : null,
      },
      ...(opts.bugReport ? { bugReport: formatBugReport(report, opts.version) } : {}),
    },
    null,
    2,
  );
}
