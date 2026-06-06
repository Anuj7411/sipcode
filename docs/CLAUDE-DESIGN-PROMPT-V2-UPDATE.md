# Sipcode landing — direction lock + tech correction

> **For the human (Anuj):** paste everything below the line into claude.design.
> This is an *update* to the v2 brief, not a full restart. claude.design already has v2.

---

# Updates to the v2 brief — please apply both

## 1) TECH CORRECTION — Astro + Skiper UI are allowed (the earlier "no React" rule was wrong)

The v2 brief said "no frameworks, no React." That was overzealous. Replace those clauses with:

> **Build with Astro.** You may use **React components**, and component libraries like **Skiper UI** are encouraged where they save time (vessel animation, drag-to-compare scrubber, FAQ accordion, etc.). Every component must render to **static HTML at build time** — JS hydration is opt-in per component, only where interaction genuinely needs it. The vessel animation is the one place we knowingly allow client-side JS.
>
> **Hard gates that stay non-negotiable:**
> - Lighthouse ≥ 95 on Performance, Accessibility, Best Practices, SEO
> - Total page weight under 300KB (including hero mark and fonts)
> - Main content fully readable with JS disabled
> - No analytics, trackers, or cookies in v1
> - Mobile-responsive from 360px wide
>
> RTK's site is also Astro on GitHub Pages — same pattern, same constraints, same hosting target.

## 2) DIRECTION LOCKED — D1 (Editorial Lab) as the base, with two enhancements

After reviewing all six directions, we are locking **D1 — Editorial Lab** as the page's overall direction:
- Paper background, faint editorial grid, calm lab-measurement aesthetic
- Space Grotesk + Inter + JetBrains Mono per the brand kit
- **Light mode only for v1.** Document light-mode tokens; dark mode is a v2 nice-to-have.

The reason we are *not* picking D3: the dark + radial-purple-glow + giant-mono-numbers pattern is the standard 2026 AI-startup template (OpenAI/Anthropic/Vercel/Linear/half of YC). D1's calm editorial restraint is more on-brand for Sipcode ("calm over loud" is a core brand value) and is the distinctive choice in this category.

But D1 as shipped is too quiet — the vessel ends up ornamental. Two enhancements to fix that:

### Enhancement A — the vessel performs the brand story on load (D1 hero, upgraded)

The brand mark IS a vessel. The product story IS gulp → sip. Make the vessel **demonstrate the story in 1.5 seconds** the moment the page loads:

- **Hero vessel is bigger:** ~400px tall (D1 had 300; D3 had 430 — split the difference). It earns the right half of the hero grid.
- **On page load:**
  1. Vessel renders at **fill = 0.99** (gulped — almost overflowing, muted/muddy violet, no headroom).
  2. A number ticks down *inside* the vessel: **8,000 → 1,050 tokens / turn**, in JetBrains Mono large.
  3. The fill **drains down** to **0.4** over ~1.4s (use the `sc-liquid` meniscus easing — smooth, not bouncy).
  4. As it settles at 0.4, the violet brightens from muted to brand `#5B4FCF`. The meniscus rests with visible headroom.
  5. A small caption appears beneath the vessel in mono small-caps: `before sipcode → after sipcode`
- **After the load animation, the vessel keeps a slow, subtle bob** (the `sc-liquid` keyframe in the file's CSS — `translateY` + a tiny `skewX`). Alive, not noisy.
- **Strictly respect `prefers-reduced-motion`:** in reduced-motion mode, the vessel renders directly at fill=0.4 with the resting violet — no drain animation, no bob, just the static "sipped" state.

### Enhancement B — the lab measurement ticks become functional

D1's vertical 8k / 6k / 4k / 2k / 0 scale next to the vessel was decorative. Make it *say something* about the product:

- The tick at the resting fill level (~1,050 / `1k`) **lights violet** and labels itself **"your norm."** All other ticks stay neutral grey.
- A small mono caption underneath the scale: **"measured from your transcripts — not a brochure number."**
- This wires the hero visual to the language the **drift** detector uses in the product ("your norm vs this session"). The vessel, the scale, and the product all speak the same language.

### Mid-page scroll section — borrow D4 (Gulp vs Sip), but in LIGHT MODE for cohesion

Insert D4 as a dedicated scroll section between **Section 2 (Context rot explainer)** and **Section 3 (The three layers)** in the v2 brief — it earns the visitor's understanding of the metaphor before we name the three product layers.

**Important:** D4 as designed is fully dark. **Translate it to LIGHT MODE** so it doesn't fight the rest of the page:

- **GULP side:** background `#E8E6E0` (a slightly darker, faintly noisy Paper variant — the noise wall stays as a low-contrast hairline scribble texture, NOT bright text). Vessel at fill ≈ 0.99, fill color a muted desaturated violet/grey. Headline **"Bloated context."** in `ink`. Subhead in `charcoal`.
- **SIP side:** background clean Paper `#F8F8F6`, soft Sip-Violet glow (low opacity) in the corner. Vessel at fill = 0.4, fill color brand `#5B4FCF`. Headline **"Clean context."** in `ink`. Subhead in `charcoal`. Small npm-install pill beneath the subhead.
- **Center scrub divider** stays — a hairline ink rule, the circular `⇄` handle in white with subtle shadow. Mono small-caps **"drag to compare"** beneath.
- **Drag-to-compare behavior:** dragging the handle horizontally reveals more of the SIP side over the GULP side. Touch-friendly on mobile (large hit target). Keyboard-accessible (arrow keys move the scrub). `prefers-reduced-motion` mode renders the section as two static side-by-side cards with no scrubber.

This is **NOT** a separate page or click-through. It's an in-page scroll section. One-page launch story.

## 3) Section ordering recap (the v2 arc, updated)

| # | Section | Notes |
|---|---|---|
| 1 | **Hero (D1-base + load animation + functional ticks)** | Enhancements A + B above |
| 2 | Context-rot explainer | per v2 |
| **2.5** | **Gulp vs Sip scrub section (D4 in light mode)** | NEW — insert here |
| 3 | The three layers (Valve / Meter / Drift) | per v2 |
| 4 | Live before/after demo | per v2 |
| 5 | Drift terminal screen | per v2 |
| 6 | Inside Claude Desktop chat | per v2 |
| 7 | Installation | per v2 |
| 8 | Honesty section | per v2 |
| 9 | FAQ | per v2 |
| 10 | Final CTA | per v2 |
| 11 | Footer | per v2 |

## 4) Deliverable (clarified)

- **Astro project** ready to deploy on GitHub Pages at `Anuj7411.github.io/sipcode`.
- Components in `src/components/` (React or Astro). Page in `src/pages/index.astro`.
- Skiper UI imported only where its components save real time (Vessel, ScrubCompare, FAQAccordion).
- Brand tokens (colors, type, spacing) extracted into a single CSS file or Astro `<style>` block — referenced, not inlined per-section.
- A short `README.md` in the Astro project root explaining: `npm install`, `npm run dev`, `npm run build`, and how to deploy the `dist/` output to GitHub Pages.

### Open questions you may ask back
1. We have the meniscus + S vessel as SVG (in the brand kit at `02-wordmark/wordmark-only.svg` and `01-icon/icon-master.svg`). Want them attached?
2. We have the Sip-Violet palette locked (`#5B4FCF` light-mode accent, `#0A0A0A` ink, `#F8F8F6` paper, `#2D3142` charcoal). Use these — don't propose alternatives.
3. The hero animation timing (1.4s drain, 8000→1050 number tick): adjust if your taste says different but stay under 2.0s total — anything longer feels theatrical.

---

End of update.
