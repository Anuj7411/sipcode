/**
 * Standalone HTML formatter for sipcode stats.
 * Pure. Zero external assets. Idempotent: same StatsResult → byte-identical
 * HTML.
 *
 * Brand palette: ink #0B0E0E, paper #E8E1D4, mint #3DDC97, stone #9B9690,
 * salmon #FF6B6B.
 */
import type { StatsResult, TrendDay } from "./types.js";

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

function windowLabel(raw: string): string {
  if (raw === "all") return "all time";
  if (/^\d+d$/.test(raw)) return `last ${raw.replace("d", " days")}`;
  return `since ${raw}`;
}

/**
 * Render a sparkline SVG. Bars are 0..maxBarHeight tall, evenly spaced.
 */
function trendSvg(trend: ReadonlyArray<TrendDay>): string {
  const width = 600;
  const height = 120;
  const padX = 8;
  const padY = 16;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  if (trend.length === 0) {
    return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="empty trend"></svg>`;
  }
  let max = 0;
  for (const d of trend) if (d.tokens > max) max = d.tokens;
  const barW = innerW / trend.length;
  const bars: string[] = [];
  for (let i = 0; i < trend.length; i++) {
    const d = trend[i]!;
    const ratio = max > 0 ? d.tokens / max : 0;
    const h = Math.max(1, ratio * innerH);
    const x = padX + i * barW;
    const y = height - padY - h;
    bars.push(
      `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(barW - 1).toFixed(2)}" height="${h.toFixed(2)}" fill="${PALETTE.mint}" />`,
    );
  }
  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="token spend per day"><rect width="${width}" height="${height}" fill="${PALETTE.ink}" />${bars.join("")}</svg>`;
}

function projectBarsSvg(
  projects: ReadonlyArray<{ name: string; pctOfSpend: number; estCostUSD: number }>,
): string {
  if (projects.length === 0) return "";
  const width = 600;
  const rowH = 28;
  const labelW = 140;
  const valueW = 90;
  const trackX = labelW + 8;
  const trackW = width - trackX - valueW - 8;
  const height = projects.length * rowH + 8;
  const rows: string[] = [];
  for (let i = 0; i < projects.length; i++) {
    const p = projects[i]!;
    const y = i * rowH + 4;
    const w = Math.max(2, (Math.min(100, p.pctOfSpend) / 100) * trackW);
    rows.push(
      `<text x="${labelW}" y="${y + 17}" text-anchor="end" fill="${PALETTE.paper}" font-size="13" font-family="ui-monospace,Menlo,monospace">${escapeHtml(p.name)}</text>`,
      `<rect x="${trackX}" y="${y + 6}" width="${trackW}" height="14" fill="rgba(232,225,212,0.12)" />`,
      `<rect x="${trackX}" y="${y + 6}" width="${w.toFixed(2)}" height="14" fill="${PALETTE.mint}" />`,
      `<text x="${trackX + trackW + 6}" y="${y + 17}" fill="${PALETTE.stone}" font-size="12" font-family="ui-monospace,Menlo,monospace">${fmtUSD(p.estCostUSD)} (${fmtPct(p.pctOfSpend)})</text>`,
    );
  }
  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="spend by project">${rows.join("")}</svg>`;
}

function bigCard(label: string, value: string, sub?: string): string {
  return `<div class="card"><div class="card-label">${escapeHtml(label)}</div><div class="card-value">${escapeHtml(value)}</div>${sub ? `<div class="card-sub">${escapeHtml(sub)}</div>` : ""}</div>`;
}

function escapeJson(s: string): string {
  // Safe to embed inside <script> — escape </ to avoid early-close.
  return s.replace(/<\/(script)/gi, "<\\/$1");
}

const TABLE_SORT_JS = `(function(){
  function parseCell(td){var d=td.getAttribute('data-sort');if(d!==null){var n=parseFloat(d);return isNaN(n)?d:n;}return td.textContent.trim();}
  function sortBy(table,idx,dir){var tb=table.tBodies[0];var rows=Array.prototype.slice.call(tb.rows);rows.sort(function(a,b){var x=parseCell(a.cells[idx]);var y=parseCell(b.cells[idx]);if(x<y)return -1*dir;if(x>y)return 1*dir;return 0;});rows.forEach(function(r){tb.appendChild(r);});}
  document.querySelectorAll('table.sortable th').forEach(function(th,idx){th.style.cursor='pointer';var dir=1;th.addEventListener('click',function(){sortBy(th.closest('table'),idx,dir);dir*=-1;});});
})();`;

export function formatHtml(report: StatsResult): string {
  const css = [
    `body{margin:0;background:${PALETTE.ink};color:${PALETTE.paper};font-family:ui-monospace,Menlo,Consolas,monospace;padding:32px;line-height:1.5;}`,
    `.wrap{max-width:760px;margin:0 auto;}`,
    `h1{font-size:24px;margin:0 0 4px;color:${PALETTE.paper};letter-spacing:-0.02em;}`,
    `.subtitle{color:${PALETTE.stone};font-size:13px;margin-bottom:24px;}`,
    `.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px;}`,
    `.card{background:rgba(232,225,212,0.04);border:1px solid rgba(232,225,212,0.10);padding:14px;border-radius:6px;}`,
    `.card-label{color:${PALETTE.stone};font-size:11px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;}`,
    `.card-value{color:${PALETTE.paper};font-size:22px;font-weight:600;letter-spacing:-0.02em;}`,
    `.card-sub{color:${PALETTE.stone};font-size:12px;margin-top:4px;}`,
    `section{margin-bottom:28px;}`,
    `section h2{font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:${PALETTE.mint};margin:0 0 12px;font-weight:600;}`,
    `table{width:100%;border-collapse:collapse;font-size:13px;}`,
    `table th,table td{text-align:left;padding:8px 10px;border-bottom:1px solid rgba(232,225,212,0.08);}`,
    `table th{color:${PALETTE.stone};font-weight:500;text-transform:uppercase;font-size:11px;letter-spacing:0.06em;}`,
    `table td.num,table th.num{text-align:right;font-variant-numeric:tabular-nums;}`,
    `.dim{color:${PALETTE.stone};}`,
    `.warn{color:${PALETTE.salmon};}`,
    `footer{margin-top:32px;padding-top:16px;border-top:1px solid rgba(232,225,212,0.10);color:${PALETTE.stone};font-size:12px;display:flex;justify-content:space-between;align-items:center;}`,
    `footer a{color:${PALETTE.mint};text-decoration:none;}`,
    `svg{display:block;max-width:100%;height:auto;}`,
  ].join("");

  const cards = [
    bigCard("total tokens", fmtNum(report.totals.totalTokens)),
    bigCard("output ratio", fmtPct(report.totals.outputRatioPct), "code vs exploration"),
    bigCard("est. cost", fmtUSD(report.totals.estCostUSD), `${report.sessionCount} sessions`),
  ].join("");

  const savingsRows = [
    {
      label: "duplicate file reads",
      tokens: report.savings.duplicateReadsTokens,
      usd: report.savings.duplicateReadsUSD,
    },
    {
      label: "idle context",
      tokens: report.savings.idleContextTokens,
      usd: report.savings.idleContextUSD,
    },
    {
      label: "cache-creation overhead",
      tokens: report.savings.cacheCreationTokens,
      usd: report.savings.cacheCreationUSD,
    },
  ]
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.label)}</td><td class="num" data-sort="${r.tokens}">${fmtNum(r.tokens)}</td><td class="num" data-sort="${r.usd}">${fmtUSD(r.usd)}</td></tr>`,
    )
    .join("");

  const topRows = report.topExpensive
    .map((t, i) => {
      const date = t.startedAt.slice(0, 10);
      const lbl = t.label ? ` · ${escapeHtml(t.label)}` : "";
      return `<tr><td class="num" data-sort="${i}">${i + 1}</td><td>${date}</td><td>${escapeHtml(t.sessionIdShort)}</td><td>${escapeHtml(t.project)}</td><td>${escapeHtml(t.durationHuman)}</td><td class="num" data-sort="${t.tokens}">${fmtNum(t.tokens)}</td><td class="num" data-sort="${t.estCostUSD}">${fmtUSD(t.estCostUSD)}</td><td>${lbl ? lbl.replace(/^ · /, "") : '<span class="dim">—</span>'}</td></tr>`;
    })
    .join("");

  const warnings =
    report.warnings.length > 0
      ? `<section><h2>warnings</h2><ul>${report.warnings
          .slice(0, 10)
          .map(
            (w) =>
              `<li class="warn">[${escapeHtml(w.code)}] ${escapeHtml(w.message.split("\n")[0] ?? "")}</li>`,
          )
          .join("")}</ul></section>`
      : "";

  const projectBars = projectBarsSvg(report.byProject.slice(0, 8));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>sipcode stats · ${escapeHtml(windowLabel(report.window.raw))}</title>
<style>${css}</style>
</head>
<body>
<div class="wrap">
<h1>sipcode stats</h1>
<div class="subtitle">${escapeHtml(windowLabel(report.window.raw))} · ${escapeHtml(`${report.sessionCount} sessions`)} · ${escapeHtml(report.primaryModel)} · agent: ${escapeHtml(report.agent)}</div>

<section class="cards">${cards}</section>

<section>
<h2>trend · token spend per day</h2>
${trendSvg(report.trendDaily)}
</section>

<section>
<h2>estimated waste</h2>
<table><thead><tr><th>pattern</th><th class="num">tokens</th><th class="num">est. cost</th></tr></thead>
<tbody>${savingsRows}</tbody></table>
</section>

${
  report.topExpensive.length > 0
    ? `<section>
<h2>top ${report.topExpensive.length} most expensive sessions</h2>
<table class="sortable"><thead><tr><th class="num">#</th><th>date</th><th>id</th><th>project</th><th>duration</th><th class="num">tokens</th><th class="num">cost</th><th>label</th></tr></thead>
<tbody>${topRows}</tbody></table>
</section>`
    : ""
}

${
  report.byProject.length > 0
    ? `<section>
<h2>spend by project</h2>
${projectBars}
</section>`
    : ""
}

${warnings}

<footer>
<span>sip your tokens. don't gulp them.</span>
<a href="https://sipcode.dev">sipcode.dev</a>
</footer>
</div>
<script>${escapeJson(TABLE_SORT_JS)}</script>
</body>
</html>`;
}
