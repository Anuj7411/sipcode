# Social Templates — spec (Figma substitute)

A real `.figma` file can't be generated here, so this folder ships a **working, editable equivalent**: `social-templates.html`. Open it, click any text to edit it, and screenshot the card to export a finished post. Every measurement maps to `04-brand/BRAND.md`.

All cards are **1200 × 675 px (16:9)** — the universal size that downsizes cleanly to Twitter/X, LinkedIn, and Discord.

## Shared structure
- **Mark, top-left:** horizontal lockup, icon 64px + `sipcode` wordmark (Space Grotesk 600). On dark cards the accent is Violet Light `#7A6FE3`.
- **Padding:** 72px top/bottom, 80px left/right (the clear-space rule, scaled).
- **Type:** Space Grotesk for display, Inter for supporting copy, JetBrains Mono for numbers/labels.

## The three templates

**1 · Release announcement** — Paper `#F8F8F6` background.
Mono kicker (version + "shipped") in Sip Violet → large Space Grotesk 700 headline → up to 3 bulleted changes (violet square bullets).

**2 · Milestone** — Ink `#0A0A0A` background.
Oversized Space Grotesk number (200px) with the unit (★, downloads, %) in Violet Light → one line of Inter caption in muted grey.

**3 · Benchmark result** — White background.
Headline → two horizontal bars: `before` (grey, full width, labelled "gulp") and `after` (Sip Violet, proportional width, labelled "sip") → a violet delta line (e.g. "−38% tokens, same result.").

## To rebuild as native Figma
1. Frame 1200×675, fill per template.
2. Place `02-wordmark/wordmark-horizontal.svg` top-left at 64px icon height; set clear space to 72/80.
3. Text styles: Display = Space Grotesk 700; Body = Inter 400–600; Mono = JetBrains Mono 500.
4. Colors = the BRAND.md tokens. Save the three frames as Components for reuse.
