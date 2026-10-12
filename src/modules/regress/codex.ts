/**
 * codex-limit-burn: how much of a Codex usage limit each Codex version used
 * per 1M uncached input + output tokens, compared with the user's other
 * versions on the same plan and limit window. Pure.
 *
 * Built on the limits module, not on per-file deltas: every reading of every
 * file goes into one account-wide series per limit window (buildPeriods), and
 * each rise of a period's percent is shared by the local requests made since
 * the previous rise, in proportion to their tokens (attribute). So a rise
 * seen by two concurrent sessions is counted once, and a rise with no request
 * on this computer (Codex on another device or in the cloud) is left out.
 * Requests after a period's last rise have not been charged yet and are left
 * out too.
 *
 * Group = Codex version (line 1 of the file, pre-release suffix dropped) +
 * model + plan (the period's newest reading) + limit id + window length. A
 * group counts with >= 200,000 work tokens. It is flagged when its percent
 * per 1M work tokens is >= 2x the median of the other counted groups with the
 * same plan, limit id and window length (any model, like the prototype; the
 * note says when no other group ran the same model).
 */
import type { LimitReading } from "../agents/codex/rateLimits.js";
import { attribute, type LimitRequest } from "../limits/attribute.js";
import { buildPeriods } from "../limits/periods.js";
import { windowLabel } from "../limits/report.js";
import { vcmp } from "./catalog.js";
import { isoTime, upperMedian } from "./helpers.js";
import type { CodexRequest } from "./rows.js";
import type { Finding } from "./types.js";

export const MIN_WORK_TOKENS = 200_000;
export const BURN_RATIO = 2;

export interface CodexBurnRow {
  readonly version: string;
  readonly model: string;
  readonly plan: string;
  readonly limitId: string;
  readonly windowMinutes: number;
  /** Requests charged with part of a rise. */
  readonly requests: number;
  /** Percent of the limit those requests used. */
  readonly percent: number;
  readonly workTokens: number;
  /** percent ÷ (workTokens / 1,000,000). */
  readonly percentPerMillion: number;
}

export interface CodexCoverage {
  /** Codex requests read (every request with tokens). */
  readonly requests: number;
  readonly sessions: number;
  readonly versions: number;
  readonly firstVersion: string | null;
  readonly lastVersion: string | null;
  readonly from: string | null;
  readonly to: string | null;
  /** Limit readings found in the logs. */
  readonly readings: number;
  /** Version / model groups with enough limit data (the table's rows). */
  readonly groups: number;
}

export interface CodexResult {
  readonly findings: readonly Finding[];
  readonly coverage: CodexCoverage;
  readonly table: readonly CodexBurnRow[];
  /** At least one counted group has another on the same plan, limit and window. */
  readonly comparable: boolean;
}

const CAVEAT =
  "Limits are shared with Codex on your other devices and in the cloud. A limit change on your plan at the same time as the update would look the same: run `sipcode limits` to see whether a limit may have shrunk.";

const sameWindow = (a: CodexBurnRow, b: CodexBurnRow): boolean =>
  a.plan === b.plan && a.limitId === b.limitId && a.windowMinutes === b.windowMinutes;

export function burnTable(readings: readonly LimitReading[], requests: readonly CodexRequest[]): CodexBurnRow[] {
  const byRef = new Map<LimitRequest, CodexRequest>(requests.map((r) => [r, r]));
  const groups = new Map<string, { row: Omit<CodexBurnRow, "requests" | "percent" | "workTokens" | "percentPerMillion">; requests: number; percent: number; work: number }>();
  for (const w of buildPeriods(readings)) {
    for (const period of w.periods) {
      let lastRise = Number.NEGATIVE_INFINITY;
      let max = 0;
      for (const p of period.points) {
        if (p.usedPercent > max) {
          max = p.usedPercent;
          lastRise = p.at;
        }
      }
      const plan = period.planType ?? "?";
      for (const share of attribute(period, requests).shares) {
        if (share.request.at > lastRise) continue;
        const r = byRef.get(share.request);
        if (!r) continue;
        const model = r.model ?? "?";
        const key = [r.version, model, plan, w.limitId, w.windowMinutes].join("\u0000");
        let g = groups.get(key);
        if (!g) {
          g = { row: { version: r.version, model, plan, limitId: w.limitId, windowMinutes: w.windowMinutes }, requests: 0, percent: 0, work: 0 };
          groups.set(key, g);
        }
        g.requests++;
        g.percent += share.percent;
        g.work += r.work;
      }
    }
  }
  return [...groups.values()]
    .filter((g) => g.work >= MIN_WORK_TOKENS)
    .map((g) => ({
      ...g.row,
      requests: g.requests,
      percent: g.percent,
      workTokens: g.work,
      percentPerMillion: g.percent / (g.work / 1e6),
    }))
    .sort(
      (a, b) =>
        vcmp(a.version, b.version) ||
        (a.model < b.model ? -1 : a.model > b.model ? 1 : 0) ||
        a.windowMinutes - b.windowMinutes ||
        (a.limitId < b.limitId ? -1 : a.limitId > b.limitId ? 1 : 0),
    );
}

function windowName(r: CodexBurnRow): string {
  const label = windowLabel(r.windowMinutes).toLowerCase();
  return r.limitId === "codex" ? `${label} window` : `${r.limitId} ${label} window`;
}

export function detectCodex(readings: readonly LimitReading[], requests: readonly CodexRequest[]): CodexResult {
  const table = burnTable(readings, requests);
  const findings: Finding[] = [];
  for (const r of table) {
    const peers = table.filter((o) => o !== r && sameWindow(o, r));
    if (peers.length === 0) continue;
    const base = upperMedian(peers.map((o) => o.percentPerMillion));
    if (!(base > 0 && r.percentPerMillion >= BURN_RATIO * base)) continue;
    const notes = [CAVEAT];
    if (table.some((o) => o.plan === r.plan && o.windowMinutes !== r.windowMinutes)) {
      notes.push("Your plan's limit window changed during this period; only same-window versions were compared.");
    }
    if (!peers.some((o) => o.model === r.model)) {
      notes.push("This version ran a different model than your other versions; the model may explain the difference.");
    }
    findings.push({
      id: "codex-limit-burn",
      agent: "codex",
      title: "Codex rate limit drains faster per token",
      from: r.version,
      to: r.version,
      known: [],
      evidence: [
        `v${r.version} ${r.model} (${r.plan}, ${windowName(r)}): ${r.percentPerMillion.toFixed(2)}% of the limit per 1M uncached+output tokens vs ${base.toFixed(2)}% on your other versions (${(r.percentPerMillion / base).toFixed(1)}x)`,
      ],
      examples: [],
      note: notes.join(" "),
    });
  }
  const versions = [...new Set(requests.map((r) => r.version))].sort(vcmp);
  const times = requests.map((r) => r.at).sort((a, b) => a - b);
  return {
    findings,
    coverage: {
      requests: requests.length,
      sessions: new Set(requests.map((r) => r.sessionId)).size,
      versions: versions.length,
      firstVersion: versions[0] ?? null,
      lastVersion: versions[versions.length - 1] ?? null,
      from: times.length ? isoTime(times[0]!).slice(0, 10) : null,
      to: times.length ? isoTime(times[times.length - 1]!).slice(0, 10) : null,
      readings: readings.length,
      groups: table.length,
    },
    table,
    comparable: table.some((r) => table.some((o) => o !== r && sameWindow(o, r))),
  };
}
