/**
 * Standalone HTML receipt — pure: ReceiptModel → HTML string.
 *
 * Open in any browser, screenshot it, done. No external CSS, no fonts loaded
 * over the network (system stack is fine — the PNG path is where vendored
 * fonts apply). 1200×630 OG-image proportions; inline styles only.
 *
 * Lowercase hex throughout (snapshotted).
 */
import type { ReceiptModel } from "./types.js";

const BG = "#0b0e0e";
const PAPER = "#e8e1d4";
const MINT = "#3ddc97";
const MUTED = "#9b9690";
const RED = "#ff6b6b";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatHtml(model: ReceiptModel): string {
  const accent = model.variant === "post-install" ? MINT : RED;
  const leaksHtml = model.leaks
    .map(
      (leak) => `
        <li style="display:flex; justify-content:space-between; align-items:baseline; padding:8px 0; border-bottom:1px solid #1a1d1d;">
          <span style="color:${PAPER}; font-size:24px; font-weight:400;">${escapeHtml(leak.rank.toString())}. ${escapeHtml(leak.title)}</span>
          <span style="color:${PAPER}; font-family:'JetBrains Mono','Menlo','Consolas',monospace; font-weight:500; font-size:22px;">${escapeHtml(leak.tokensDisplay)}</span>
        </li>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>sipcode receipt — ${escapeHtml(model.header.sessionIdShort)}</title>
  <meta name="viewport" content="width=1200, initial-scale=1" />
  <style>
    html, body { margin:0; padding:0; background:${BG}; color:${PAPER}; font-family:'Inter','Helvetica Neue',system-ui,sans-serif; }
    .receipt {
      box-sizing:border-box;
      width:1200px; height:630px;
      padding:56px 64px;
      display:flex; flex-direction:column; justify-content:space-between;
    }
    .top { display:flex; justify-content:space-between; align-items:baseline; }
    .wordmark { font-size:28px; font-weight:700; letter-spacing:-0.02em; color:${PAPER}; }
    .meta { font-size:22px; color:${MUTED}; }
    .divider { height:1px; background:#1a1d1d; margin:18px 0 28px; }
    .hero { display:flex; flex-direction:column; gap:6px; }
    .hero-number {
      font-family:'Inter Tight','Inter','Helvetica Neue',system-ui,sans-serif;
      font-weight:700;
      font-size:160px;
      line-height:1;
      letter-spacing:-0.04em;
      color:${accent};
    }
    .hero-sub { font-size:28px; color:${PAPER}; }
    .hero-foot { font-size:18px; color:${MUTED}; }
    .leaks-title { font-size:18px; color:${MUTED}; text-transform:uppercase; letter-spacing:0.18em; margin-bottom:8px; }
    .leaks { list-style:none; padding:0; margin:0; }
    .bottom { display:flex; justify-content:space-between; align-items:baseline; }
    .tagline { font-size:22px; color:${MUTED}; }
    .url { font-size:22px; color:${PAPER}; font-weight:700; letter-spacing:-0.01em; }
  </style>
</head>
<body>
  <div class="receipt">
    <div>
      <div class="top">
        <div class="wordmark">sipcode</div>
        <div class="meta">${escapeHtml(model.header.durationDisplay)} · ${escapeHtml(model.header.dateDisplay)}</div>
      </div>
      <div class="divider"></div>
      <div class="hero">
        <div class="hero-number">${escapeHtml(model.hero.tokensDisplay)}</div>
        <div class="hero-sub">${escapeHtml(model.hero.sublabel)}</div>
        <div class="hero-foot">≈ ${escapeHtml(model.hero.dollarDisplay)} · prices as of ${escapeHtml(model.hero.pricingAsOf)}</div>
      </div>
    </div>
    <div>
      <div class="leaks-title">what we caught</div>
      <ul class="leaks">${leaksHtml}
      </ul>
    </div>
    <div class="bottom">
      <div class="tagline">${escapeHtml(model.footer.tagline)}</div>
      <div class="url">${escapeHtml(model.footer.url)}</div>
    </div>
  </div>
</body>
</html>
`;
}
