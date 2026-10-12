/**
 * The `--bug-report` block: one GitHub-issue-ready section per finding.
 * Token counts, versions, dates and short session ids only; never prompts,
 * code, paths or commands. Pure.
 */
import { fmtN } from "./helpers.js";
import type { RegressReport } from "./report.js";
import type { Finding } from "./types.js";

function myData(f: Finding, report: RegressReport): string {
  if (f.agent === "claude-code") {
    const c = report.claude?.coverage;
    return c ? `${fmtN(c.requests)} requests, ${fmtN(c.sessions)} sessions, ${c.from} to ${c.to}` : "Claude Code sessions";
  }
  const c = report.codex?.coverage;
  return c ? `${fmtN(c.requests)} Codex requests, ${fmtN(c.sessions)} sessions, ${c.from} to ${c.to}` : "Codex sessions";
}

function section(f: Finding, report: RegressReport, version: string): string {
  const tool = f.agent === "claude-code" ? "Claude Code" : "Codex";
  return [
    `### ${f.title}`,
    "",
    `**Detected by** sipcode regress ${version} from local logs only (no data left the machine).`,
    `**Affected ${tool} versions (from my logs):** ${f.from}${f.to !== f.from ? ` to ${f.to}` : ""}`,
    `**My data:** ${myData(f, report)}`,
    "",
    "**Evidence**",
    ...f.evidence.map((e) => `- ${e}`),
    ...(f.examples.length ? ["", "**Sample requests (token counts only)**", ...f.examples.map((e) => `- ${e}`)] : []),
    ...(f.known.length
      ? ["", `**Matches known issue:** ${f.known.map((k) => `${k.id} ${k.what} (${k.ref}, fixed in ${k.fixed})`).join("; ")}`]
      : []),
    ...(f.note ? ["", `_Note: ${f.note}_`] : []),
    "",
  ].join("\n");
}

/** The block, or null when there are no findings. */
export function formatBugReport(report: RegressReport, version: string): string | null {
  if (report.findings.length === 0) return null;
  return report.findings.map((f) => section(f, report, version)).join("\n");
}
