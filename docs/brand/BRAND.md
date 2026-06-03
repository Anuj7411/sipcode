# Sipcode — Brand Guidelines v1.0

**Sip your tokens. Don't gulp them.**

A token-economy observatory for Claude Code. The identity is engineered, honest, and measured — a monoline vessel filled to a deliberate level, with headroom left on purpose. Restraint is the whole idea: never let an asset get louder than the product.

---

## 1 · Logo

The identity has two elements that are always drawn from the same source files:

- **The icon** — a continuous **superellipse (squircle)** "vessel," outlined in pure black, filled at the lower **40%** with blue-violet. The surface is a real concave **meniscus** (a slight downward curve), not a flat line. The empty space above the fill is intentional negative space and must never be filled, cropped, or decorated.
- **The wordmark** — lowercase `sipcode` set in **Space Grotesk Medium**, slightly tracked tighter than default. `sip` is pure black; `code` is blue-violet (the same value as the icon fill).

### Primary lockup
Horizontal: icon left, wordmark right. The wordmark's cap-height block is optically centered on the icon's vertical center. Use this everywhere space allows.

### Lockup geometry (reproducible spec)
Working in a coordinate system where the icon's full square = **100 units**:

| Property | Value |
|---|---|
| Icon square | 100 × 100 (visible vessel inset 15 on all sides → vessel = 70) |
| Wordmark cap-height | 42 units (= 0.60 × vessel height) |
| Gap (vessel right edge → first letter) | 22 units (≈ 0.31 × vessel height) |
| Vertical alignment | wordmark cap-block centered on icon center; baseline sits 21 units below center |
| Wordmark tracking | −0.03 em |

---

## 2 · Color

The palette is **final**. Two brand colors do all the work; everything else is a background or a dark-mode safety value.

| Token | Hex | RGB | HSL | Use |
|---|---|---|---|---|
| **Ink** (primary black) | `#0A0A0A` | `10, 10, 10` | `0°, 0%, 4%` | Icon outline, `sip`, body text |
| **Sip Violet** (accent) | `#5B4FCF` | `91, 79, 207` | `246°, 57%, 56%` | Icon fill, `code`, primary accent |
| **Violet Light** (dark-mode accent) | `#7A6FE3` | `122, 111, 227` | `246°, 67%, 66%` | Accent **only on dark backgrounds**, so it doesn't crush against black |
| **Paper** (warm off-white) | `#F8F8F6` | `248, 248, 246` | `60°, 11%, 97%` | Default light background |
| **White** | `#FFFFFF` | `255, 255, 255` | `0°, 0%, 100%` | Alternate light background, reversed mark |
| **Ink** (dark background) | `#0A0A0A` | `10, 10, 10` | `0°, 0%, 4%` | Default dark background |
| **Charcoal** (support text) | `#2D3142` | `45, 49, 66` | `228°, 19%, 22%` | Taglines & secondary copy on light |

**Rules**
- Never recolor the mark to any value outside this palette.
- On light backgrounds, accent = Sip Violet `#5B4FCF`. On dark backgrounds, accent = Violet Light `#7A6FE3`.
- The icon is only ever: full-color, solid Ink (mono), solid White (reverse), or Violet-on-Ink (dark social). No other combinations.

---

## 3 · Typography

| Role | Typeface | Weight | Notes |
|---|---|---|---|
| **Wordmark** | Space Grotesk | Medium (500) | Lowercase, tracking −0.03em. Open angular counters give it engineered character. The shipped logo files are **outlined to vector** — no font needed to use them. |
| **Headlines / UI** | Space Grotesk | 500–700 | Pairs natively with the wordmark. |
| **Body text** | Inter | 400–600 | Neutral, highly legible at small sizes for docs, CLI output tables, and the website. |
| **Code / metrics** | JetBrains Mono | 400–500 | Token counts, costs, anything tabular. |

Recommended pairing: **Space Grotesk** for display + **Inter** for body. Both are open-source (SIL OFL).

---

## 4 · Clear space & minimum sizes

**Clear space.** Keep a margin equal to **25% of the icon's height** clear on all sides of the icon or the full lockup. Nothing — text, edges, other logos — enters this zone.

**Minimum sizes.**

| Asset | Minimum |
|---|---|
| Icon | **16 px** (below 20px the meniscus flattens to a straight fill line — see `favicon-16.png`) |
| Full horizontal lockup | **120 px** wide |
| Wordmark only | **80 px** wide |

At 32px and above, always use the concave meniscus. Only the 16px favicon uses the flat fill.

---

## 5 · Do not

- ❌ **Don't stretch or squish.** Scale the mark proportionally, always.
- ❌ **Don't recolor** to any value outside the palette (no "brand-adjacent" greens, yellows, or gradients).
- ❌ **Don't add effects** — no drop shadows, glows, gradients, inner highlights, bevels, or 3D.
- ❌ **Don't fill the headroom.** The empty space above the level is the concept.
- ❌ **Don't place the mark on a busy background** or low-contrast color. Use Paper, White, or Ink.
- ❌ **Don't misalign the lockup** — the wordmark stays optically centered on the icon; never baseline-drop or top-align it.
- ❌ **Don't rotate, outline-the-fill, or swap the two-tone** (`sip` is always Ink, `code` is always Violet).
- ❌ **Don't substitute the font** in the wordmark — use the supplied vector files.

---

## 6 · File index & naming

```
sipcode-brand-kit-v1.0/
├── 01-icon/        the solo mark
├── 02-wordmark/    icon + "sipcode" lockups
├── 03-social/      ready-to-upload marketing images
├── 04-brand/       this document
└── 05-optional/    animated mark + social templates
```

**Naming convention:** `<group>-<variant>-<treatment>.<ext>`
e.g. `icon-mono-black.png`, `wordmark-reverse-white.png`, `favicon-16.png`.

- `mono` = single-color (outline only, no fill)
- `reverse` = for dark backgrounds (white)
- `color` = full brand color
- numeric suffix = pixel size

SVGs are the source of truth; PNGs are exported at the sizes named. All PNGs have transparent backgrounds unless the name says otherwise (`*-dark`, social images on Paper).

---

*Sipcode is local-only, MIT-licensed. Brand kit v1.0.*
