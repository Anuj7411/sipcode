import { describe, expect, it } from "vitest";
import { formatBugReport } from "../../../src/modules/regress/bug-report.js";
import { formatRegressJson } from "../../../src/modules/regress/format-json.js";
import { formatRegressTerminal } from "../../../src/modules/regress/format-terminal.js";
import { buildRegressReport, type BuildRegressInput } from "../../../src/modules/regress/report.js";
import type { ClaudeRow } from "../../../src/modules/regress/rows.js";
import { healthy, type Turn } from "../../integration/regress-fixtures.js";

const T0 = Date.parse("2026-03-01T09:00:00Z");

function file(version: string, turns: readonly Turn[], day = 0): ClaudeRow[] {
  let t = T0 + day * 86_400_000;
  return turns.map((x) => {
    t += (x.gap ?? 1) * 60_000;
    const c5 = x.c5 ?? 0;
    const c1 = x.c1 ?? 0;
    const inp = x.inp ?? 3;
    return { session: "sess0001", version, model: "claude-opus-4-8", entry: "cli", side: false, ts: t, inp, cr: x.cr, cw: c5 + c1, c5, c1, out: 400, ctx: inp + x.cr + c5 + c1, afterTool: true };
  });
}

const NO_ACCESS_ISSUES = { missingDirs: [], unreadableFiles: 0, unreadableFolders: 0, skippedCompressed: 0 };

function report(over: Partial<BuildRegressInput> = {}) {
  return buildRegressReport({
    minN: 20,
    claudeDir: "/h/.claude/projects",
    codexDir: "/h/.codex",
    claude: [file("2.1.60", healthy(30)), file("2.1.61", healthy(30), 1), file("2.1.100", healthy(30, { ttl: "5m" }), 2), file("2.1.62", healthy(30), 3), file("2.1.63", healthy(30), 4)],
    codex: null,
    access: NO_ACCESS_ISSUES,
    ...over,
  });
}

const OPTS = { bugReport: false, version: "1.7.2" };

describe("formatRegressTerminal", () => {
  it("Claude Code only: no Codex line; a known finding has no signal-not-proof line", () => {
    const out = formatRegressTerminal(report(), OPTS);
    expect(out).not.toContain("Codex:");
    expect(out).toContain("● Main-conversation cache written with the 5-minute TTL instead of 1-hour  [ttl-5m]  Claude Code 2.1.100  = known R4");
    expect(out).not.toContain("signal worth reporting");
  });

  it("Codex only: no Claude Code or known-windows line", () => {
    const out = formatRegressTerminal(report({ claude: null, codex: { readings: [], requests: [] } }), OPTS);
    expect(out.split("\n").slice(0, 3)).toEqual([
      "sipcode regress · local only, no network",
      "Codex: no readable requests in /h/.codex",
      "",
    ]);
  });

  it("names compressed logs it skipped", () => {
    const out = formatRegressTerminal(report({ access: { ...NO_ACCESS_ISSUES, skippedCompressed: 2 } }), OPTS);
    expect(out).toContain("note: 2 compressed Codex log(s) (.jsonl.zst) skipped: Sipcode cannot read compressed logs yet.");
  });
});

describe("formatRegressJson", () => {
  it("has the schema, agents, coverage, access, findings and per-check tables", () => {
    const j = JSON.parse(formatRegressJson(report(), OPTS));
    expect(Object.keys(j)).toEqual(["schemaVersion", "agents", "minN", "coverage", "access", "comparable", "comparableByAgent", "findings", "checks"]);
    expect(j.schemaVersion).toBe("sipcode-regress/1");
    expect(j.agents).toEqual(["claude-code"]);
    expect(j.coverage.codex).toBeNull();
    expect(j.findings[0]).toEqual({
      id: "ttl-5m",
      agent: "claude-code",
      title: "Main-conversation cache written with the 5-minute TTL instead of 1-hour",
      from: "2.1.100",
      to: "2.1.100",
      known: [{ id: "R4", what: "1-hour prompt cache TTL silently downgraded to 5 minutes", ref: "anthropics/claude-code#46829, CHANGELOG 2.1.108 + 2.1.129", fixed: "2.1.129" }],
      evidence: ["v2.1.100: 100.0% of cache writes were 5-minute over 30 turns (other versions: 0.0%)  [matches known R4]"],
      examples: [],
      note: "If you use an API key, cloud provider or usage credits, 5-minute TTL is expected, not a bug.",
    });
    expect(Object.keys(j.checks.claudeCode)).toEqual(["warmCacheMiss", "postIdleCold", "ttl5m", "uncachedInput", "hourlyRebuild"]);
  });
});

describe("formatBugReport", () => {
  it("null without findings; otherwise token counts, versions and the catalog match", () => {
    expect(formatBugReport(report({ claude: [file("2.1.60", healthy(30))] }), "1.7.2")).toBeNull();
    const b = formatBugReport(report(), "1.7.2")!;
    expect(b.split("\n").slice(0, 5)).toEqual([
      "### Main-conversation cache written with the 5-minute TTL instead of 1-hour",
      "",
      "**Detected by** sipcode regress 1.7.2 from local logs only (no data left the machine).",
      "**Affected Claude Code versions (from my logs):** 2.1.100",
      "**My data:** 150 requests, 5 sessions, 2026-03-01 to 2026-03-05",
    ]);
    expect(b).toContain("**Matches known issue:** R4 1-hour prompt cache TTL silently downgraded to 5 minutes (anthropics/claude-code#46829, CHANGELOG 2.1.108 + 2.1.129, fixed in 2.1.129)");
    expect(b).not.toContain("/h/");
  });
});
