/**
 * Standalone HTML formatter for sipcode benchmark.
 * Pure. Zero external assets. Idempotent: same input → byte-identical HTML.
 *
 * Brand palette: ink #0B0E0E, paper #E8E1D4, mint #3DDC97, stone #9B9690,
 * salmon #FF6B6B.
 */
import type { RenderedBenchmark, RenderedTaskRow } from "./render.js";

const PALETTE = {
  ink: "#0B0E0E",
  paper: "#E8E1D4",
  mint: "#3DDC97",
  stone: "#9B9690",
  salmon: "#FF6B6B",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtUSD(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function bigCard(label: string, value: string, sub?: string): string {
  return `<div class="card"><div class="card-label">${escapeHtml(label)}</div><div class="card-value">${escapeHtml(value)}</div>${sub ? `<div class="card-sub">${escapeHtml(sub)}</div>` : ""}</div>`;
}

function taskRow(t: RenderedTaskRow): string {
  const pct = Math.max(0, Math.min(100, t.savingsPct));
  const barW = pct.toFixed(1);
  return [
    `<tr>`,
    `<td><code>${escapeHtml(t.id)}</code></td>`,
    `<td>${escapeHtml(t.title)}</td>`,
    `<td><span class="cat">${escapeHtml(t.category)}</span></td>`,
    `<td class="num">${fmtNum(t.baselineTokens)}</td>`,
    `<td class="num">${fmtNum(t.optimizedTokens)}</td>`,
    `<td class="num"><div class="bar-wrap"><div class="bar" style="width:${barW}%"></div><span class="bar-label">${fmtPct(t.savingsPct)}</span></div></td>`,
    `<td class="num">${fmtUSD(t.savingsUSD)}</td>`,
    `</tr>`,
  ].join("");
}

export function formatHtml(report: RenderedBenchmark): string {
  const css = [
    `body{margin:0;background:${PALETTE.ink};color:${PALETTE.paper};font-family:ui-monospace,Menlo,Consolas,monospace;padding:32px;line-height:1.5;}`,
    `.wrap{max-width:860px;margin:0 auto;}`,
    `h1{font-size:24px;margin:0 0 4px;letter-spacing:-0.02em;}`,
    `.subtitle{color:${PALETTE.stone};font-size:13px;margin-bottom:24px;}`,
    `.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px;}`,
    `.card{background:rgba(232,225,212,0.04);border:1px solid rgba(232,225,212,0.10);padding:14px;border-radius:6px;}`,
    `.card-label{color:${PALETTE.stone};font-size:11px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;}`,
    `.card-value{font-size:22px;font-weight:600;letter-spacing:-0.02em;}`,
    `.card-sub{color:${PALETTE.stone};font-size:12px;margin-top:4px;}`,
    `section{margin-bottom:28px;}`,
    `section h2{font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:${PALETTE.mint};margin:0 0 12px;font-weight:600;}`,
    `table{width:100%;border-collapse:collapse;font-size:13px;}`,
    `table th,table td{text-align:left;padding:8px 10px;border-bottom:1px solid rgba(232,225,212,0.08);}`,
    `td.num{text-align:right;font-variant-numeric:tabular-nums;}`,
    `.cat{color:${PALETTE.stone};font-size:11px;text-transform:uppercase;letter-spacing:0.04em;}`,
    `.bar-wrap{position:relative;background:rgba(232,225,212,0.10);height:18px;border-radius:3px;overflow:hidden;width:140px;display:inline-block;}`,
    `.bar{background:${PALETTE.mint};height:100%;}`,
    `.bar-label{position:absolute;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:${PALETTE.ink};font-weight:600;}`,
    `.attr{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}`,
    `.foot{color:${PALETTE.stone};font-size:12px;margin-top:24px;}`,
  ].join("");

  const cards = [
    bigCard(
      "median savings",
      fmtPct(report.headline.medianSavingsPct),
      `range ${fmtPct(report.headline.minSavingsPct)} – ${fmtPct(report.headline.maxSavingsPct)}`,
    ),
    bigCard(
      "tokens saved",
      fmtNum(report.headline.totalSavingsTokens),
      `across ${report.taskCount} tasks`,
    ),
    bigCard(
      "dollars saved",
      fmtUSD(report.headline.totalSavingsUSD),
      `at ${report.metaPricing.asOf} rates`,
    ),
  ].join("");

  const attrCards = [
    bigCard(
      "S001 manifest",
      fmtPct(report.attribution.s001_manifest.pct),
      `${fmtNum(report.attribution.s001_manifest.tokens)} tokens`,
    ),
    bigCard(
      "S021 output",
      fmtPct(report.attribution.s021_outputCompression.pct),
      `${fmtNum(report.attribution.s021_outputCompression.tokens)} tokens`,
    ),
    bigCard(
      "S030 read-once",
      fmtPct(report.attribution.s030_readOnceCache.pct),
      `${fmtNum(report.attribution.s030_readOnceCache.tokens)} tokens`,
    ),
  ].join("");

  const rows = report.tasks.map(taskRow).join("");

  const warningBlock =
    report.warnings.length > 0
      ? `<section><h2>warnings</h2><ul>${report.warnings
          .map(
            (w) =>
              `<li><code>${escapeHtml(w.code)}</code> ${escapeHtml(w.message)}</li>`,
          )
          .join("")}</ul></section>`
      : "";

  return [
    `<!doctype html>`,
    `<html lang="en"><head><meta charset="utf-8"><title>sipcode benchmark</title><style>${css}</style></head>`,
    `<body><div class="wrap">`,
    `<h1>sipcode benchmark</h1>`,
    `<div class="subtitle">${escapeHtml(report.headline.oneLiner)} corpus v${escapeHtml(report.corpusVersion)} · ${report.taskCount} tasks</div>`,
    `<div class="cards">${cards}</div>`,
    `<section><h2>per-task results</h2>`,
    `<table><thead><tr><th>id</th><th>task</th><th>category</th><th class="num">baseline</th><th class="num">optimized</th><th class="num">savings</th><th class="num">$</th></tr></thead>`,
    `<tbody>${rows}</tbody></table></section>`,
    `<section><h2>where the savings came from</h2><div class="attr">${attrCards}</div></section>`,
    warningBlock,
    `<div class="foot">prices from ${escapeHtml(report.metaPricing.asOf)} (${report.metaPricing.ageDays} days old). methodology: benchmark/METHODOLOGY.md. reproduce locally: <code>npx sipcode benchmark</code>.</div>`,
    `</div></body></html>`,
  ].join("");
}
