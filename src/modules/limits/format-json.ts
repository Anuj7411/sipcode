/**
 * JSON renderer for `sipcode limits --json` and the get_codex_limits MCP
 * tool. Pure. Times are ISO 8601 (UTC); `project` is a folder name, never a
 * path. `usedBy` lists every session of the newest period that --here keeps,
 * then codex-auto-review as one entry; with `unattributedPercent` it adds up
 * to `usedPercent` (without --here). `periodCount` is how many periods the
 * logs show for the window (the independent checker compares it).
 */
import { AUTO_REVIEW_MODEL } from "./attribute.js";
import type { LimitsReport } from "./report.js";

const iso = (ms: number): string => new Date(ms).toISOString();

export function formatLimitsJson(report: LimitsReport | null): string {
  if (report === null) {
    return JSON.stringify({ agent: "codex", planType: null, asOf: null, windows: [] }, null, 2);
  }
  return JSON.stringify(
    {
      agent: "codex",
      planType: report.planType,
      asOf: iso(report.asOf),
      windows: report.windows.map((w) => ({
        limitId: w.limitId,
        windowMinutes: w.windowMinutes,
        label: w.label,
        usedPercent: w.period.usedPercent,
        resetsAt: iso(w.period.resetsAt),
        projection: w.projection.kind === "runs-out" ? { kind: "runs-out", at: iso(w.projection.at) } : { kind: w.projection.kind },
        usedBy: [
          ...w.usedBy.map((s) => ({ sessionId: s.sessionId, project: s.project, percent: s.percent, tokens: s.tokens })),
          ...(w.autoReview
            ? [{ sessionId: AUTO_REVIEW_MODEL, project: null, percent: w.autoReview.percent, tokens: w.autoReview.tokens }]
            : []),
        ],
        unattributedPercent: w.unattributedPercent,
        tokensPerPercent: w.shrink.points.map((p) => ({
          model: p.model,
          periodStart: iso(p.periodStart),
          tokensPerPercent: Math.round(p.tokensPerPercent),
        })),
        possibleCut: w.shrink.possibleCut
          ? { at: iso(w.shrink.possibleCut.periodStart).slice(0, 10), factor: w.shrink.possibleCut.factor }
          : null,
        periodCount: w.periodCount,
      })),
    },
    null,
    2,
  );
}
