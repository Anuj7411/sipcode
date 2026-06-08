# Session handoff — 2026-06-08

> **For the next Claude session:** read this top to bottom before doing anything else. It is the single source of truth for where we left off. Do not skim. The prior session was almost entirely about building the landing page at `docs/site/`. The project itself (Sipcode, the published npm package) is at v1.6.4 and unchanged this session.

---

## 0. Read order before touching anything

1. This document end-to-end (~15 min)
2. The user's auto-memory at `C:\Users\ojhaa\.claude\projects\C--Projects-Sipcode\memory\MEMORY.md` — loads automatically; confirm v1.6.4 + reliability positioning is the current truth
3. `docs/site/src/pages/index.astro` — the page shell
4. One section component (e.g. `docs/site/src/components/DemoSection.astro`) — to see the conventions in action
5. `docs/site/src/styles/global.css` — section divider, scroll-reveal, animation tokens, and the documented impeccable false-positives

After that you have the same picture I have. Do not "explore the codebase" first — it wastes context.

---

## 1. Where the project actually is right now

**Sipcode (the npm package)**
- Live on npm: **`sipcode@1.6.4`**
- 997 tests passing
- 13 MCP tools
- Strategic positioning is **reliability**, not just compression: "clean context = right answers." Token-saving is the proof, not the headline. RTK is acknowledged as complementary, not as a target to beat on compression %.
- The drift detector (`sipcode drift` + `get_drift_report` MCP tool) is the new flagship feature shipped in v1.6.x.

**Landing page (built this session, NOT YET shipped anywhere)**
- Lives in `docs/site/` as an Astro project (separate from the main repo's package.json)
- Runs at `http://localhost:4321` via `npm run dev`
- Production-built and verified, but **not deployed**. Target URL when deployed: `https://anuj7411.github.io/sipcode/` (GitHub Pages from `docs/site/dist/`)
- Bundle: 5.14 KB JS (2.02 KB gzip), 1.63s cold build, zero React, zero framework runtime
- ALL website files are uncommitted — `git status` shows `?? docs/site/`. The first thing the user might want to do after the next session opens is decide whether to commit.

**Current git branch**: `main`. Last 4 commits are all docs (claude.design handoffs). The proxy.ts / registry.ts / stats-store.ts edits the linter has been mentioning across sessions are committed in earlier work — they are the live state.

---

## 2. What was built this session (chronological)

1. Started in the middle of a Why section iteration — comparison panes were too white-on-white, claude.design output had been ported but the visual contrast was weak.
2. Built `MobileNotice.astro` because user said Sipcode is desktop-first and mobile users get a polite "Best on desktop" overlay.
3. Did the responsiveness audit honestly across 7 desktop viewport sizes (1280 → 3440). Zero horizontal overflow at any size.
4. Documented impeccable false-positives in one block in `global.css` instead of suppressing them per-file.
5. **Ported the MascotVessel from React → vanilla TS** (`MascotVessel.astro`). Old version was 367 lines of React. New version pre-renders all 3 face variants (happy/neutral/stressed) in the SVG, then a small vanilla TS script toggles visibility + animates the liquid translate. Same visual, same interactions, **97% smaller bundle**.
6. Removed `@astrojs/react`, `react`, `react-dom`, `@types/react`, `@types/react-dom` from `docs/site/package.json`. Astro config no longer registers the React integration.
7. Fixed Footer brand link `href="#"` → `href="#top"` (the `<main>` now has `id="top"`).
8. Added explicit head meta: `canonical`, `theme-color`, full `og:*` set with absolute URLs, full `twitter:*` set (not relying on OG fallback).
9. Cross-browser sweep: Chromium ✅ (puppeteer-verified), WebKit ✅ (Playwright-verified, identical render), Firefox ⚠️ couldn't launch on Windows (`spawn UNKNOWN`, known Playwright-on-Windows issue) — page only uses standards Firefox has supported for years.
10. Fixed a CSS specificity bug where `.mobile-notice { display: flex }` overrode the HTML `hidden` attribute; added `.mobile-notice[hidden] { display: none }` to restore it.

---

## 3. The website's structural truth (so you do not "rediscover" it)

### File inventory (all under `docs/site/`)

```
docs/site/
├── astro.config.mjs       — no integrations (vanilla Astro)
├── package.json           — only dep: astro ^4.16.0
├── tsconfig.json
└── src/
    ├── env.d.ts
    ├── lib/
    │   └── brand.ts       — TOKENS (colors/fonts), VESSEL_PATH, fillForTokens(), emotionForFill()
    ├── pages/
    │   └── index.astro    — page shell, imports every section, has the scroll-reveal IO script
    ├── styles/
    │   └── global.css     — body bg #EFEEEA, section margin/divider rules, animation tokens, scroll-reveal CSS, impeccable false-positive documentation block
    └── components/
        ├── Logo.astro            — wordmark + small vessel icon (used in NavBar)
        ├── NavBar.astro          — Why / Demo / Drift / Install / FAQ links + Star + Install CTAs
        ├── NpmInstallPill.astro  — the `$ npm i -g sipcode` pill in Hero
        ├── PlotBackground.astro  — faint grid + bezier curve + edge-ruler ticks + 4 corner reticles (used in every paper-bg section)
        ├── Hero.astro            — left text + right mascot, no eyebrow (impeccable flagged "hero-eyebrow-chip" as AI tell)
        ├── MascotVessel.astro    — vanilla TS interactive mascot (drained on load, slider, Sip/Gulp buttons)
        ├── WhySection.astro      — dark comparison card with context-fill bars (clean vs rotted)
        ├── LayersSection.astro   — three alternating-side rows: Valve / Meter / Drift, each with a dark visual preview
        ├── DemoSection.astro     — dark instrument panel: 6-row bar chart with caliper marks + dotted savings spans
        ├── DriftSection.astro    — left rail explanation + right dark terminal report with norm/session gauges
        ├── InstallSection.astro  — 2 side-by-side cards (Claude Code / Claude Desktop), copy-to-clipboard
        ├── HonestySection.astro  — dark statement panel: 4 hairline-divided rows, one × per row
        ├── FaqSection.astro      — light hairline accordion using <details>, first item open
        ├── FinalCta.astro        — centered: "Stop ~gulping~ them." + Install + Star
        ├── Footer.astro          — dark #121218: 3 cols (Brand / Docs / Project) + badges + legal row
        └── MobileNotice.astro    — fixed overlay shown only at <=760px, dismissable per session
```

### Section render order in `index.astro`

```
<main id="top">
  <Hero />               ─ breath  854px  (mascot)
  <WhySection />         ─ depth   787px  (dark comparison)
  <LayersSection />      ─ breath 1236px  (three layers, substantial)
  <DemoSection />        ─ depth   700px  (bar chart)
  <DriftSection />       ─ breath  734px  (dark terminal)
  <InstallSection />     ─ depth   502px  (two cards)
  <HonestySection />     ─ statement 673px (dark panel)
  <FaqSection />         ─ depth   650px
  <FinalCta />           ─ close   375px
</main>
<Footer />               ─         283px  (dark ink)
```
Total scroll length ~7000px at 1920×920 browser viewport. Numbers measured in real browser viewports (monitor height minus ~160px for URL bar + taskbar), not raw monitor heights. Every section verified to fit at 1920×920; some overflow ~100px at older 1366×768 laptops which we accepted (sections do not need to fit in one viewport — users scroll).

### Conventions every section follows (so the vibe is consistent)

1. **Top markup**:
   ```astro
   <section id="X" class="X">
     <PlotBackground />
     <div class="container">
       <header class="X-head">
         <div class="head-row">
           <span class="eyebrow"><span class="tick"></span>EYEBROW COPY</span>
           <span class="head-meta">right-side meta</span>
         </div>
         <h2 class="X-title">Headline. <span class="accent">Accent words.</span></h2>
       </header>
       ... section body
     </div>
   </section>
   ```
2. **Section vertical padding**: `padding: clamp(24px, 3.6vh, 56px) 0;` — **vh-based, never vw-based**. This is the responsiveness fix that took the longest. If you make a new section, copy this exact clamp.
3. **Container**: `.container { max-width: 1340px; margin: 0 auto; padding: 0 clamp(20px, 4vw, 64px); }` — defined once in `global.css`. Symmetric.
4. **Section gap (visible break)**: every `main > section:not(.hero)` gets `margin-top: clamp(20px, 2.4vh, 36px)` plus a small ochre diamond `::before` tick centered on the seam. The body background is `#EFEEEA` (slightly darker than paper) so the gap shows through. Defined globally — do not redefine.
5. **Visual language** (settled, do not deviate without asking):
   - **Light cards (white #fff bg)** = utility / evidence (Install cards, FAQ rows, Why's 29% stat card, arXiv card)
   - **Dark cards (#14141B or #131319 bg)** = live behavior / proof / statement (Why comparison, Layers previews, Demo panel, Drift terminal, Honesty panel)
   - **Ochre square tick** before every eyebrow label — anchors the visual rhythm
   - **Corner reticles** (`L`-shaped) appear on dark panels — small `#D6A23E` accents

### Brand tokens (locked, do not change)

```
ink           #0A0A0A    text, lines, vessel outline
violet        #5B4FCF    accent on light backgrounds, vessel fill (happy/neutral)
violet-light  #7A6FE3    accent on dark backgrounds (footer code chips, etc.)
violet-soft   #A99CF7    dark-mode highlight (terminal output)
paper         #F8F8F6    section background
charcoal      #2D3142    body text on light
ochre         #B9831B    eyebrow tick + section divider diamond + reticles on dark panels
body bg       #EFEEEA    shows through section gaps (set on body)

font-display  'Space Grotesk' 500-700
font-body     'Inter' 400-600
font-mono     'JetBrains Mono' 400-600
```

These are also in `src/lib/brand.ts` as a `TOKENS` object used by `MascotVessel.astro`.

---

## 4. User preferences — DO and DO NOT (carry these in)

### Hard NO (will trigger pushback)

- **No em-dashes** (— or `--`) anywhere in copy or this chat. Use commas, colons, periods, or parentheses. (The user explicitly flagged em-dash overuse as an AI tell.)
- **No numbered AI scaffolds** like "01 / 02 / 03" as section eyebrows. (Impeccable also flags this.)
- **No hype verbs**: revolutionize, supercharge, unleash, transform, disrupt, blast, crush.
- **No "Let me explain"** / "Here's the thing" / "Of course!" openings.
- **No fake numbers** — user caught a hardcoded "52k stars" once and it was a real trust hit.
- **No "not just X but Y" rhythm**, no "Both X and Y" structures (AI tells).
- **No exclamation marks** in body copy.
- **No mascot violence / Viking metaphors** (RTK does that, we don't).
- **No "coming soon" placeholders.** If we don't have it, it isn't on the page.
- **No six-column footers.** Three columns max.
- **No vanity counters** ("X teams waiting"). The user prefers blank to fake.
- **No newsletter form.** Not shipping that.
- **No language switcher.** One language.
- **No violet drop-shadows on dark backgrounds** — impeccable flags as "dark-glow AI tell."
- **No `box-shadow` with the brand violet color on UI buttons** — same reason. Use neutral charcoal shadow.
- **Do not measure layout with puppeteer alone and call it "fits."** Browser chrome (URL bar, taskbar) eats ~160px from monitor height. A 1920×1080 monitor has ~920px of actual viewport. Always subtract chrome when claiming "fits."
- **Do not install all 209 of `msitarzewski/agency-agents`.** Currently only 3 files installed in `~/.claude/agents/`: design-brand-guardian, design-ui-designer, design-visual-storyteller. Adding more would pollute the agents folder (the very anti-pattern Sipcode sells against).
- **Don't claim things work in browsers you didn't test** (we tested Chromium + WebKit; Firefox is untested-but-standards-compliant; recommend the user manually open it).
- **Don't auto-bump versions or auto-publish.** User's versioning policy is patch-by-default within 1.6.x. Never cross into 1.7 without explicit permission.

### Strong YES

- **Honesty over polish.** When something is broken, name it. When you don't know, say "I don't know." When you guessed, say "I guessed."
- **Show, don't tell.** When the user can see something, send a screenshot URL or boot a server. Don't describe what UI looks like in words.
- **Verify with real measurements**, not assumptions.
- **Direction C** for content density: dense (depth) sections and sparse (breath) sections alternate. Hero, Layers, Drift, CTA are breath. Why, Demo, Install, FAQ are depth.
- **One section at a time** for iteration, not all-at-once.
- **Document false-positives once** in a central place rather than suppressing per-file.
- **Cite, never claim** for things we didn't measure (29% and 40% reliability numbers are cited from Anthropic's research, not measured by Sipcode).

### User personality notes
- Indian English. Phrases like "thier" / "becase" / casual punctuation. Not a typo — that's just their style; respond clearly without being a grammar tutor.
- Gets frustrated when I re-explain things or add caveats they already understood.
- Wants to be challenged on bad ideas, not flattered into them.
- Very visual — if I say "looks better," they want to see it.
- Direct: "lets move forward," "next," "do it" — match that energy.

---

## 5. Honest open issues / what is NOT done

1. **Site is not deployed.** `docs/site/dist/` is built but never pushed to GitHub Pages. User has not enabled Pages in the repo settings. The canonical URL in the `<head>` (`https://anuj7411.github.io/sipcode/`) does not resolve yet.
2. **Site code is not committed.** Currently shows as `?? docs/site/` in `git status`. User has not asked for a commit yet.
3. **Firefox not tested in automation.** Playwright Firefox refuses to spawn on this Windows machine. Page uses only standards Firefox 121+ supports; the only iffy feature is `text-wrap: balance/pretty` which degrades gracefully. **Recommend the user opens it manually in Firefox once to verify.**
4. **1366×768 and 1280×720 laptops still overflow each section by ~100-130px.** Accepted — user said sections don't need to fit on tiny laptops; a small scroll is fine.
5. **No real-user testimonials section** built. RTK has "Real-world savings" with `rtk gain` output. We don't have real users yet so we deliberately skipped it (faking would burn trust). When real users surface post-launch, this is the section to add.
6. **No `benchmark --vs-rtk` live harness shipped.** Heuristic preview only. Deferred from Phase A; user wants this proven, not just claimed, before/during launch.
7. **No Sipcode product work this session.** Drift v2 (persistent history + config-cause attribution) is still on the roadmap. AST-aware compression also on the roadmap (reframed as a reliability feature, not "beat RTK on %").
8. **The site `<head>` has hardcoded `https://anuj7411.github.io/sipcode/` URLs in canonical + og:url + og:image + twitter:image.** If you deploy somewhere else, edit those.

---

## 6. What the user might want to do next (in likely order)

1. **Commit the site to git.** Probably a single `feat(site): landing page at docs/site` commit (it's 18 files, all new).
2. **Pivot to Sipcode product work** (the user said "we have to make a new chat" suggesting they want to draw a line and reopen on product). The natural next product items are:
   - Drift v2: persist baselines across sessions so the detector survives restarts
   - Live `benchmark --vs-rtk` execution harness (currently just heuristic)
   - AST-aware compression (Phase B; reframed as a reliability feature, not a compression-% race)
3. **Deploy the site to GitHub Pages.** Requires enabling Pages from `docs/site/dist/` (or moving build output to `docs/` root and serving from main branch).
4. **Manual Firefox check.** ~30 seconds.
5. **Launch.** User has said they'll use Product Hunt + cold emails, not Reddit (their posts get banned).

**Best default opener for the next chat:** ask the user which of these they want first. Don't assume.

---

## 7. How to verify the site is live and working

```bash
# from project root
cd docs/site
npm run dev   # boots at http://localhost:4321
# OR
npm run build && npm run preview
```

Expected:
- HTTP 200 at `http://localhost:4321/`
- Mascot drains from gulp → sip on load (after ~380ms)
- Smooth scroll between nav anchors
- Each section fades in as it enters view
- At <=760px viewport: mobile notice overlay appears, Star/View-anyway buttons work
- Production build outputs **5.14 KB JS / 2.02 KB gzip** in ~1.6s

If any of those are off, the user accidentally broke something between sessions or `npm install` did not run.

---

## 8. Critical conventions and decisions from earlier sessions (carry-in)

These were settled before this session and are still in force:

- **`sipcode@1.6.4` is live on npm.** Don't claim a different version.
- **The 13 MCP tools** include `get_drift_report` (the flagship). Full list in the FAQ section of the landing page.
- **RTK is complementary, not a target.** Don't pitch the page as "beat RTK." Pitch as "the only reliability-framed token tool."
- **The reliability numbers (29% sharper / 40% fewer agent errors)** are cited from research, never claimed as our own measurement. The honesty section explicitly says this. The Why section explicitly says it. Don't dilute.
- **Versioning policy**: patch-by-default. Stay in 1.6.x. Never auto-cross to 1.7 without explicit ask. Major bumps need ask.
- **Mobile is explicitly out of scope.** Desktop-first product (Claude Code is desktop). Mobile gets the redirect notice.
- **The brand kit (logo, colors, type) is locked** at `~/.claude/projects/C--Projects-Sipcode/memory/` references. Don't redesign the mark.

---

## 9. The state of the dev server (if you find it running)

A dev server may be running at `http://localhost:4321` from the prior session. Verify with `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4321/`. If it's dead, restart with `cd docs/site && npm run dev`.

---

## 10. Final words

If you're the next session reading this: I genuinely tried to give you everything. If something feels missing, the most likely answer is in one of these files (in priority order):

1. `docs/site/src/pages/index.astro`
2. `docs/site/src/styles/global.css`
3. `docs/site/src/components/MascotVessel.astro` (it's the only interactive component)
4. `~/.claude/projects/C--Projects-Sipcode/memory/MEMORY.md`
5. `docs/SESSION-HANDOFF-2026-06-04.md` (older handoff, when the drift detector was new)
6. `docs/COMPETITIVE-STRATEGY-RTK.md` (RTK positioning reconciliation)
7. `docs/superpowers/specs/2026-06-05-sipcode-reliability-reposition-design.md` (the reliability pivot rationale)

Now go. The user is direct. Match that. Don't apologize, don't preamble, do the work.

— Sonnet 4.6 (closing session 2026-06-08)
