/**
 * Standalone single-file HTML formatter for sipcode score.
 *
 * Pure. Zero external assets. Idempotent: identical ScoreReport → identical
 * HTML. Brand palette matches receipts and stats.
 */
import { tierColor, tierStars } from "./tier.js";
import type { CategoryScore, ScoreReport } from "./types.js";

const PALETTE = {
  ink: "#0B0E0E",
  paper: "#E8E1D4",
  mint: "#3DDC97",
  stone: "#9B9690",
  salmon: "#FF6B6B",
  warmOrange: "#FF9F45",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function categoryBarsSvg(cats: ReadonlyArray<CategoryScore>): string {
  const width = 640;
  const rowH = 36;
  const labelW = 220;
  const valueW = 70;
  const trackX = labelW + 8;
  const trackW = width - trackX - valueW - 8;
  const height = cats.length * rowH + 8;
  const rows: string[] = [];
  for (let i = 0; i < cats.length; i++) {
    const cat = cats[i]!;
    const y = i * rowH + 4;
    const pct = cat.max > 0 ? cat.score / cat.max : 0;
    const w = Math.max(2, pct * trackW);
    const fill = pct >= 0.9 ? PALETTE.mint : pct >= 0.6 ? PALETTE.paper : pct >= 0.4 ? PALETTE.warmOrange : PALETTE.salmon;
    rows.push(
      `<text x="${labelW}" y="${y + 22}" text-anchor="end" fill="${PALETTE.paper}" font-size="13" font-family="ui-monospace,Menlo,monospace">${escapeHtml(cat.id + ". " + cat.name)}</text>`,
      `<rect x="${trackX}" y="${y + 10}" width="${trackW}" height="16" fill="rgba(232,225,212,0.12)" />`,
      `<rect x="${trackX}" y="${y + 10}" width="${w.toFixed(2)}" height="16" fill="${fill}" />`,
      `<text x="${trackX + trackW + 6}" y="${y + 22}" fill="${PALETTE.stone}" font-size="12" font-family="ui-monospace,Menlo,monospace">${cat.score} / ${cat.max}</text>`,
    );
  }
  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="category scores">${rows.join("")}</svg>`;
}

function checkRow(c: ScoreReport["checks"][number]): string {
  const cls = c.passed ? "pass" : "fail";
  const symbol = c.passed ? "●" : "○";
  const detail = c.details ? `<div class="detail">${escapeHtml(c.details)}</div>` : "";
  return `<li class="check ${cls}"><div class="check-head"><span class="dot">${symbol}</span><span class="id">${escapeHtml(c.id)}</span><span class="label">${escapeHtml(c.label)}</span><span class="pts">${c.points} / ${c.maxPoints}</span></div>${detail}</li>`;
}

export function formatHtml(report: ScoreReport): string {
  const css = [
    `body{margin:0;background:${PALETTE.ink};color:${PALETTE.paper};font-family:ui-monospace,Menlo,Consolas,monospace;padding:32px;line-height:1.5;}`,
    `.wrap{max-width:760px;margin:0 auto;}`,
    `h1{font-size:24px;margin:0 0 4px;color:${PALETTE.paper};letter-spacing:-0.02em;}`,
    `.subtitle{color:${PALETTE.stone};font-size:13px;margin-bottom:24px;}`,
    `.hero{display:flex;align-items:baseline;gap:16px;margin-bottom:8px;}`,
    `.score-num{font-size:72px;font-weight:700;letter-spacing:-0.04em;line-height:1;}`,
    `.score-out{color:${PALETTE.stone};font-size:18px;}`,
    `.tier{font-size:14px;text-transform:uppercase;letter-spacing:0.10em;padding:4px 10px;border-radius:4px;font-weight:600;}`,
    `section{margin-bottom:32px;}`,
    `section h2{font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:${PALETTE.mint};margin:0 0 12px;font-weight:600;}`,
    `svg{display:block;max-width:100%;height:auto;}`,
    `details{background:rgba(232,225,212,0.04);border:1px solid rgba(232,225,212,0.10);border-radius:6px;padding:12px 16px;margin-bottom:8px;}`,
    `details summary{cursor:pointer;font-weight:600;color:${PALETTE.paper};}`,
    `ul.checks{list-style:none;padding:0;margin:12px 0 0;}`,
    `li.check{padding:8px 0;border-bottom:1px solid rgba(232,225,212,0.08);}`,
    `li.check:last-child{border-bottom:none;}`,
    `.check-head{display:flex;gap:10px;align-items:center;font-size:13px;}`,
    `.check-head .dot{font-size:16px;width:18px;text-align:center;}`,
    `.check.pass .dot{color:${PALETTE.mint};}`,
    `.check.fail .dot{color:${PALETTE.salmon};}`,
    `.check-head .id{color:${PALETTE.stone};font-weight:600;width:60px;}`,
    `.check-head .label{flex:1;color:${PALETTE.paper};}`,
    `.check-head .pts{color:${PALETTE.stone};font-variant-numeric:tabular-nums;font-size:12px;}`,
    `.detail{color:${PALETTE.warmOrange};font-size:12px;margin-top:4px;padding-left:28px;}`,
    `.recs{list-style:none;padding:0;margin:0;}`,
    `.recs li{padding:8px 0;border-bottom:1px solid rgba(232,225,212,0.08);color:${PALETTE.paper};font-size:13px;}`,
    `.recs li:last-child{border-bottom:none;}`,
    `footer{margin-top:32px;padding-top:16px;border-top:1px solid rgba(232,225,212,0.10);color:${PALETTE.stone};font-size:12px;display:flex;justify-content:space-between;align-items:center;}`,
    `footer a{color:${PALETTE.mint};text-decoration:none;}`,
  ].join("");

  const tierClr = tierColor(report.tier);
  const tierBg = report.tier === "needs-work" ? PALETTE.salmon : tierClr;
  const tierFg = report.tier === "silver" ? PALETTE.ink : PALETTE.ink;

  const recList =
    report.recommendations.length === 0
      ? `<p style="color:${PALETTE.mint};">nothing to fix — every check passing.</p>`
      : `<ul class="recs">${report.recommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`;

  // Group checks by category for collapsible sections.
  const grouped: Record<string, string[]> = { A: [], B: [], C: [], D: [], E: [] };
  for (const c of report.checks) grouped[c.category]?.push(checkRow(c));

  const detailsHtml = report.categories
    .map((cat) => {
      const passedN = report.checks.filter((c) => c.category === cat.id && c.passed).length;
      const totalN = report.checks.filter((c) => c.category === cat.id).length;
      const open = cat.score < cat.max ? " open" : "";
      return `<details${open}><summary>${escapeHtml(cat.id + ". " + cat.name)} — ${cat.score} / ${cat.max} (${passedN} / ${totalN} checks)</summary><ul class="checks">${grouped[cat.id]?.join("") ?? ""}</ul></details>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>sipcode score · ${escapeHtml(report.project.name)}</title>
<style>${css}</style>
</head>
<body>
<div class="wrap">
<h1>sipcode score</h1>
<div class="subtitle">${escapeHtml(report.project.name)} · ${report.project.filesScanned} files</div>

<section>
<div class="hero">
<div class="score-num" style="color:${tierClr};">${report.score}</div>
<div class="score-out">/ 100</div>
<div class="tier" style="background:${tierBg};color:${tierFg};">${escapeHtml(report.tier)} ${tierStars(report.tier)}</div>
</div>
</section>

<section>
<h2>by category</h2>
${categoryBarsSvg(report.categories)}
</section>

<section>
<h2>what would push you up</h2>
${recList}
</section>

<section>
<h2>all checks</h2>
${detailsHtml}
</section>

<footer>
<span>generated by sipcode · sip your tokens. don't gulp them.</span>
<a href="https://sipcode.dev">sipcode.dev</a>
</footer>
</div>
</body>
</html>`;
}
