/**
 * The five Claude Code checks. Pure.
 *
 * Each check compares one version's measure with the pooled measure of the
 * user's OTHER versions (their own baseline; no outside data). Only the
 * interactive main conversation is compared: subagent (sidechain) and Agent
 * SDK (entrypoint sdk-*) requests use a different cache policy by design and
 * would look like regressions. Rows of one file are one sequence, in time
 * order. Thresholds are the prototype's (prototypes/regress/regress.mjs on
 * the regress-prototype branch), unchanged:
 *
 * warm-cache-miss: back-to-back requests (0 to 5 min apart, context >= 30K
 *   and >= 60% of the previous one) where cache read < 30% of context. A
 *   version with >= minN such pairs is flagged when its miss rate is >= 25%
 *   and >= 3x max(rate of all other pairs, 1%).
 * post-idle-cold: a request >= 60 min after the previous one, followed by two
 *   back-to-back requests (<= 5 min apart, context >= 30K each); "cold" when
 *   both have cache read < 30% of context. Flagged at >= max(5, minN/4)
 *   returns when the cold rate is >= 50% and >= 3x max(other versions, 2%).
 * ttl-5m: share of cache-write tokens written with the 5-minute TTL, over
 *   requests that logged the split. Flagged at >= minN requests when the
 *   share is >= 50%, the request-weighted mean share of the other versions
 *   (each with >= minN requests) is <= 20%, and those have >= minN requests.
 * uncached-input: uncached input on requests right after a tool result with
 *   context >= 20K, per model and version. Flagged at >= max(5, minN/4)
 *   requests when the median is >= 500 tokens and the median of the same
 *   model's other versions' medians is < 100 (or there are none).
 * hourly-rebuild: "full rebuilds": back-to-back requests (<= 5 min) after a
 *   request with context >= 50K, keeping >= 60% of it, that read < 20% of
 *   the previous context from cache. Flagged when a version has >= 4 gaps
 *   between rebuilds of one file and >= half of them are 50 to 70 minutes.
 *
 * Adjacent flagged versions (in the check's version order) merge into one
 * finding.
 */
import { knownWindowsCovered, matchKnown, vcmp, type CheckId } from "./catalog.js";
import { fmtN, isoTime as iso, pct, upperMedian } from "./helpers.js";
import { isAutomated, type ClaudeRow } from "./rows.js";
import type { Finding } from "./types.js";

export const DEFAULT_MIN_N = 20;

export interface RateRow {
  readonly version: string;
  readonly n: number;
  readonly rate: number;
  /** Rate over every sample of the other versions (tabled or not). */
  readonly baseline: number;
  readonly baselineN: number;
}

export interface TtlRow {
  readonly version: string;
  readonly n: number;
  readonly share5m: number;
  /** Request-weighted mean share of the other tabled versions (0 when none). */
  readonly baseline: number;
}

export interface UncachedRow {
  readonly model: string;
  readonly version: string;
  readonly n: number;
  readonly median: number;
  /** Median of the same model's other versions' medians; null when there are none. */
  readonly baseline: number | null;
}

export interface HourlyRow {
  readonly version: string;
  /** Gaps between consecutive full rebuilds in one file. */
  readonly n: number;
  /** Gaps of 50 to 70 minutes. */
  readonly hourly: number;
}

export interface ClaudeTables {
  readonly warmCacheMiss: readonly RateRow[];
  readonly postIdleCold: readonly RateRow[];
  readonly ttl5m: readonly TtlRow[];
  readonly uncachedInput: readonly UncachedRow[];
  readonly hourlyRebuild: readonly HourlyRow[];
}

export interface ClaudeCoverage {
  /** Interactive main-conversation requests (the ones compared). */
  readonly requests: number;
  /** Subagent and Agent SDK requests left out. */
  readonly excludedAutomated: number;
  /** Session files with at least one interactive request. */
  readonly sessions: number;
  readonly versions: number;
  readonly firstVersion: string | null;
  readonly lastVersion: string | null;
  /** UTC dates (yyyy-mm-dd) of the first and last interactive request. */
  readonly from: string | null;
  readonly to: string | null;
  /** Catalog ids whose version range the logs include. */
  readonly knownWindowsCovered: readonly string[];
}

export interface ClaudeResult {
  readonly findings: readonly Finding[];
  readonly coverage: ClaudeCoverage;
  readonly tables: ClaudeTables;
  /** At least two versions have minN or more interactive requests. */
  readonly comparable: boolean;
}

interface Sample {
  readonly version: string;
  readonly value: boolean;
  readonly session: string;
  readonly ts: number;
  readonly cr: number;
  readonly cw: number;
  readonly ctx: number;
}

const MIN = 60_000;
function byVersion(samples: readonly Sample[]): Array<[string, Sample[]]> {
  const g = new Map<string, Sample[]>();
  for (const s of samples) {
    const list = g.get(s.version);
    if (list) list.push(s);
    else g.set(s.version, [s]);
  }
  return [...g.entries()].sort((a, b) => vcmp(a[0], b[0]));
}

interface RateRowWithExamples extends RateRow {
  readonly examples: readonly Sample[];
}

function rateTable(samples: readonly Sample[], minN: number): RateRowWithExamples[] {
  const total = samples.length;
  const hits = samples.filter((s) => s.value).length;
  return byVersion(samples)
    .filter(([, a]) => a.length >= minN)
    .map(([version, a]) => {
      const h = a.filter((s) => s.value).length;
      const restN = total - a.length;
      return {
        version,
        n: a.length,
        rate: h / a.length,
        baseline: restN ? (hits - h) / restN : 0,
        baselineN: restN,
        examples: a.filter((s) => s.value).slice(0, 3),
      };
    });
}

interface Range<T> {
  from: string;
  to: string;
  readonly rows: T[];
}

/** Flagged versions adjacent in `order` merge into one range. */
function mergeRanges<T extends { readonly version: string }>(rows: readonly T[], order: readonly string[]): Range<T>[] {
  const idx = new Map(order.map((v, i) => [v, i]));
  const out: Range<T>[] = [];
  for (const r of [...rows].sort((a, b) => vcmp(a.version, b.version))) {
    const last = out[out.length - 1];
    const at = idx.get(r.version);
    const lastAt = last ? idx.get(last.to) : undefined;
    if (last && at !== undefined && lastAt !== undefined && at === lastAt + 1) {
      last.to = r.version;
      last.rows.push(r);
    } else out.push({ from: r.version, to: r.version, rows: [r] });
  }
  return out;
}

function tag(check: CheckId, v: string): string {
  const k = matchKnown(check, v, v);
  return k.length ? `  [matches known ${k.map((x) => x.id).join(", ")}]` : "";
}

function finding(
  id: CheckId,
  title: string,
  rg: Range<unknown>,
  evidence: string[],
  examples: string[],
  note: string | null = null,
): Finding {
  return { id, agent: "claude-code", title, from: rg.from, to: rg.to, known: matchKnown(id, rg.from, rg.to), evidence, examples, note };
}

const strip = ({ version, n, rate, baseline, baselineN }: RateRowWithExamples): RateRow => ({
  version,
  n,
  rate,
  baseline,
  baselineN,
});

export function coverageOf(files: readonly (readonly ClaudeRow[])[]): ClaudeCoverage {
  const all = files.flat();
  const rows = all.filter((r) => !isAutomated(r));
  const versions = [...new Set(rows.map((r) => r.version))].sort(vcmp);
  const ts = rows.map((r) => r.ts).filter((t) => t > 0).sort((a, b) => a - b);
  return {
    requests: rows.length,
    excludedAutomated: all.length - rows.length,
    sessions: files.filter((f) => f.some((r) => !isAutomated(r))).length,
    versions: versions.length,
    firstVersion: versions[0] ?? null,
    lastVersion: versions[versions.length - 1] ?? null,
    from: ts.length ? iso(ts[0]!).slice(0, 10) : null,
    to: ts.length ? iso(ts[ts.length - 1]!).slice(0, 10) : null,
    knownWindowsCovered: knownWindowsCovered(versions),
  };
}

/** `files`: each session file's rows, in time order (claudeRows). */
export function detectClaude(files: readonly (readonly ClaudeRow[])[], minN = DEFAULT_MIN_N): ClaudeResult {
  const findings: Finding[] = [];
  const main = files.map((rows) => rows.filter((r) => !isAutomated(r))).filter((r) => r.length > 0);
  const smallN = Math.max(5, minN >> 2);

  // warm-cache-miss
  const warm: Sample[] = [];
  for (const rows of main) {
    for (let i = 1; i < rows.length; i++) {
      const p = rows[i - 1]!;
      const r = rows[i]!;
      const gapMin = (r.ts - p.ts) / MIN;
      if (gapMin < 0 || gapMin > 5 || r.ctx < 30e3 || r.ctx < 0.6 * p.ctx) continue;
      warm.push({ version: r.version, value: r.cr < 0.3 * r.ctx, session: r.session, ts: r.ts, cr: r.cr, cw: r.cw, ctx: r.ctx });
    }
  }
  const warmT = rateTable(warm, minN);
  const warmBad = warmT.filter((t) => t.rate >= 0.25 && t.rate >= 3 * Math.max(t.baseline, 0.01));
  for (const rg of mergeRanges(warmBad, warmT.map((t) => t.version))) {
    findings.push(
      finding(
        "warm-cache-miss",
        "Prompt cache missing on back-to-back turns",
        rg,
        rg.rows.map(
          (t) =>
            `v${t.version}: ${pct(t.rate)} of ${t.n} warm turns were cache misses (your other versions: ${pct(t.baseline)} of ${t.baselineN})` +
            tag("warm-cache-miss", t.version),
        ),
        rg.rows
          .flatMap((t) => t.examples)
          .slice(0, 3)
          .map((x) => `session ${x.session} ${iso(x.ts)} ctx=${fmtN(x.ctx)} cache_read=${fmtN(x.cr)} cache_write=${fmtN(x.cw)}`),
      ),
    );
  }

  // post-idle-cold
  const idle: Sample[] = [];
  for (const rows of main) {
    for (let i = 1; i + 2 < rows.length; i++) {
      if ((rows[i]!.ts - rows[i - 1]!.ts) / MIN < 60) continue;
      const a = rows[i + 1]!;
      const b = rows[i + 2]!;
      if ((a.ts - rows[i]!.ts) / MIN > 5 || (b.ts - a.ts) / MIN > 5 || a.ctx < 30e3 || b.ctx < 30e3) continue;
      idle.push({
        version: rows[i]!.version,
        value: a.cr < 0.3 * a.ctx && b.cr < 0.3 * b.ctx,
        session: rows[i]!.session,
        ts: rows[i]!.ts,
        cr: b.cr,
        cw: b.cw,
        ctx: b.ctx,
      });
    }
  }
  const idleT = rateTable(idle, smallN);
  const idleBad = idleT.filter((t) => t.rate >= 0.5 && t.rate >= 3 * Math.max(t.baseline, 0.02));
  for (const rg of mergeRanges(idleBad, idleT.map((t) => t.version))) {
    findings.push(
      finding(
        "post-idle-cold",
        "Cache stays cold for several turns after an idle break",
        rg,
        rg.rows.map(
          (t) =>
            `v${t.version}: ${pct(t.rate)} of ${t.n} idle returns stayed cold (other versions: ${pct(t.baseline)})` +
            tag("post-idle-cold", t.version),
        ),
        rg.rows
          .flatMap((t) => t.examples)
          .slice(0, 3)
          .map((x) => `session ${x.session} ${iso(x.ts)} 2 turns later cache_read=${fmtN(x.cr)} of ctx ${fmtN(x.ctx)}`),
      ),
    );
  }

  // ttl-5m
  const ttl = new Map<string, { c5: number; c1: number; n: number }>();
  for (const rows of main) {
    for (const r of rows) {
      if (r.c5 + r.c1 === 0) continue;
      const t = ttl.get(r.version) ?? { c5: 0, c1: 0, n: 0 };
      t.c5 += r.c5;
      t.c1 += r.c1;
      t.n++;
      ttl.set(r.version, t);
    }
  }
  const ttlBase = [...ttl.entries()]
    .sort((a, b) => vcmp(a[0], b[0]))
    .filter(([, t]) => t.n >= minN)
    .map(([version, t]) => ({ version, n: t.n, share5m: t.c5 / (t.c5 + t.c1) }));
  const all5 = ttlBase.reduce((a, r) => a + r.share5m * r.n, 0);
  const allN = ttlBase.reduce((a, r) => a + r.n, 0);
  const ttlRows: TtlRow[] = ttlBase.map((r) => {
    const restN = allN - r.n;
    return { ...r, baseline: restN ? (all5 - r.share5m * r.n) / restN : 0 };
  });
  const ttlBad = ttlRows.filter((r) => r.share5m >= 0.5 && r.baseline <= 0.2 && allN - r.n >= minN);
  for (const rg of mergeRanges(ttlBad, ttlRows.map((t) => t.version))) {
    findings.push(
      finding(
        "ttl-5m",
        "Main-conversation cache written with the 5-minute TTL instead of 1-hour",
        rg,
        rg.rows.map(
          (t) =>
            `v${t.version}: ${pct(t.share5m)} of cache writes were 5-minute over ${t.n} turns (other versions: ${pct(t.baseline)})` +
            tag("ttl-5m", t.version),
        ),
        [],
        "If you use an API key, cloud provider or usage credits, 5-minute TTL is expected, not a bug.",
      ),
    );
  }

  // uncached-input
  const unc = new Map<string, { model: string; version: string; rows: ClaudeRow[] }>();
  for (const rows of main) {
    for (const r of rows) {
      if (!r.afterTool || r.ctx < 20e3) continue;
      const k = `${r.model}\u0000${r.version}`;
      const g = unc.get(k) ?? { model: r.model, version: r.version, rows: [] };
      g.rows.push(r);
      unc.set(k, g);
    }
  }
  const uncGroups = [...unc.values()]
    .filter((g) => g.rows.length >= smallN)
    .map((g) => ({
      model: g.model,
      version: g.version,
      n: g.rows.length,
      median: upperMedian(g.rows.map((r) => r.inp)),
      ex: g.rows.filter((r) => r.inp > 500).slice(0, 3),
    }));
  const uncRows = uncGroups.map((g) => {
    const others = uncGroups.filter((o) => o.model === g.model && o.version !== g.version);
    return { ...g, baseline: others.length ? upperMedian(others.map((o) => o.median)) : null };
  });
  const uncBad = uncRows
    .filter((r) => r.median >= 500 && (r.baseline === null || r.baseline < 100))
    .sort((a, b) => vcmp(a.version, b.version));
  const uncOrder = [...new Set(uncRows.map((t) => t.version))].sort(vcmp);
  for (const rg of mergeRanges(uncBad, uncOrder)) {
    findings.push(
      finding(
        "uncached-input",
        "Large uncached input on tool-result turns (context not being cached)",
        rg,
        rg.rows.map(
          (t) =>
            `${t.model} v${t.version}: median uncached input ${fmtN(t.median)} tokens/turn over ${t.n} tool-result turns (same model, other versions: ${t.baseline === null ? "no data" : fmtN(t.baseline)})` +
            tag("uncached-input", t.version),
        ),
        rg.rows
          .flatMap((t) => t.ex)
          .slice(0, 3)
          .map((x) => `session ${x.session} ${iso(x.ts)} uncached_input=${fmtN(x.inp)} ctx=${fmtN(x.ctx)}`),
      ),
    );
  }

  // hourly-rebuild
  const hb = new Map<string, { iv: number[] }>();
  for (const rows of main) {
    let lastEv: number | null = null;
    for (let i = 1; i < rows.length; i++) {
      const p = rows[i - 1]!;
      const r = rows[i]!;
      if ((r.ts - p.ts) / MIN > 5 || p.ctx < 50e3 || r.ctx < 0.6 * p.ctx || r.cr >= 0.2 * p.ctx) continue;
      const g = hb.get(r.version) ?? { iv: [] };
      if (lastEv !== null) g.iv.push((r.ts - lastEv) / MIN);
      lastEv = r.ts;
      hb.set(r.version, g);
    }
  }
  const hbRows: HourlyRow[] = [...hb.entries()]
    .sort((a, b) => vcmp(a[0], b[0]))
    .map(([version, g]) => ({ version, n: g.iv.length, hourly: g.iv.filter((x) => x >= 50 && x <= 70).length }));
  const hbBad = hbRows.filter((r) => r.n >= 4 && r.hourly / r.n >= 0.5);
  for (const rg of mergeRanges(hbBad, hbRows.map((t) => t.version))) {
    findings.push(
      finding(
        "hourly-rebuild",
        "Whole prompt cache rebuilt about every hour",
        rg,
        rg.rows.map(
          (t) => `v${t.version}: ${t.hourly} of ${t.n} gaps between full rebuilds were 50 to 70 minutes` + tag("hourly-rebuild", t.version),
        ),
        [],
      ),
    );
  }

  const perVersion = new Map<string, number>();
  for (const rows of main) for (const r of rows) perVersion.set(r.version, (perVersion.get(r.version) ?? 0) + 1);
  return {
    findings,
    coverage: coverageOf(files),
    tables: {
      warmCacheMiss: warmT.map(strip),
      postIdleCold: idleT.map(strip),
      ttl5m: ttlRows,
      uncachedInput: uncRows.map(({ model, version, n, median, baseline }) => ({ model, version, n, median, baseline })),
      hourlyRebuild: hbRows,
    },
    comparable: [...perVersion.values()].filter((n) => n >= minN).length >= 2,
  };
}
