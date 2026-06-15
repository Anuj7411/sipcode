# Sipcode CLI output style guide (style C)

**Status:** Locked 2026-06-15. All v1.6.15+ command outputs follow this style.

This document is the single source of truth for how Sipcode CLI commands present their output in the terminal. Mirror it in any documentation that includes terminal screenshots (landing page cards, blog posts, launch artifacts).

---

## 1. Why this style

Sipcode's outputs were dense before v1.6.15: metrics, prose, and fixes mixed in one block. Users had trouble scanning past 2-3 signals (verified from Anuj's 2026-06-15 dogfood screenshots). Style C separates the three jobs an output has:

1. **Tell me what changed** (hero numbers + brief why)
2. **Show me the detail** (clean columns)
3. **Tell me what to do** (1-3 action lines)

Each block has a clear visual rule between it. Users can stop reading at any layer.

---

## 2. Locked principles

| Element | Rule | Rationale |
|---|---|---|
| Header | `COMMAND NAME` in UPPERCASE at top-left, contextual hint (date, session id, corpus version) at top-right. Separated by horizontal whitespace. | Title + context in one glance. No box-drawing — renders on every terminal including Windows cmd. |
| Hero row | Single line of the most important number(s) right after the header. Use unit symbols (`$`, `%`, `M`) so labels aren't strictly needed when meaning is obvious. | The "headline" — the one thing you want a user to remember. |
| Detail block | Sub-header in `lowercase` (no formatting), values right-aligned in clean columns, arrows `→` for from-to deltas. | Right-alignment keeps the eye on the number, not the label. |
| Visual rule | `━━━` (U+2501) heavy horizontal line. ~70 characters wide on a 80-col terminal. | Hard break between blocks. Better than blank lines for scannability. |
| Action lines | Prefix `▸` (U+25B8). 1-3 lines max. Direct imperative ("run X") not passive ("you might consider X"). | One unambiguous next step per line. |
| Direction arrows | `↑` for increase, `↓` for decrease. Same color as the parent metric (NOT auto-red for "bad"). | Let the human judge whether up or down is good. Sipcode is honest about uncertainty, not prescriptive about meaning. |
| pp vs % | `pp` (percentage points) for changes in a percentage. `%` for proportional changes. | "Output ratio dropped 2.5 pp" is meaningfully different from "Output ratio dropped 2.5%". |
| Numbers | Thousands separator `,` for ints over 9,999 (`12,400` not `12400`). Money uses currency symbol prefix (`$67.43`). Bytes use SI suffixes (`36.19M`). | Readability without verbosity. |
| Color | NO color in v1.6.15. Pure monochrome ASCII so output is consistent across terminals + copy-pasteable into bug reports and blog posts. Color is v1.6.16+ if it earns its way in. | Color across `chalk/picocolors` libraries breaks on Windows cmd, in pagers, and in CI logs. Skip until we have a real reason. |
| Emoji | One emoji prefix allowed per command for state signaling: `⚠` (warning), `⏳` (waiting/insufficient-data), `✓` (success). NO sparkles, fire, rockets, etc. | Single signal per command, none in body. |
| Box-drawing | NONE except the `━` horizontal rule. No `╭╮╯╰│` corners or sides. | Tested in Windows cmd.exe and old SSH terminals; corners render as garbage on legacy fonts. |

---

## 3. The three block patterns

Every command picks one of three patterns based on the command's job.

### Pattern P — Problem + Fix (for diagnostic commands)

Used by: `drift`, `why`

```
  COMMAND NAME                                              <context>

  <hero number(s) summarizing the problem>

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  <signal 1 row>      <value-from> → <value-to>           <delta>
                      <one-line why this matters>

  <signal 2 row>      <value-from> → <value-to>           <delta>
                      <one-line why this matters>

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ▸ <action 1>
  ▸ <action 2>
```

### Pattern S — Summary + Breakdown (for stats commands)

Used by: `proxy --stats`, `benchmark`

```
  COMMAND NAME                                              <context>

  <hero row: 2-4 stats spaced across the line>

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  <sub-header>
    <row 1 with right-aligned values>
    <row 2 with right-aligned values>
    ...

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ▸ <action 1>
  ▸ <action 2>
```

### Pattern I — Headline + Detail + Insight (for informational commands)

Used by: `forecast`, `today`, `impact` (data state), `init`

```
  COMMAND NAME                                              <context>

  <hero number(s)>

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  <sub-header 1>
    <metric>                <value>
    <metric>                <value>

  <sub-header 2 (optional)>
    <metric>                <value>

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ▸ <contextual insight that personalizes the number — not a generic action>
```

### Empty-state variant of Pattern I (for impact when no install marker)

```
  COMMAND NAME                                              <context>

  <emoji> <one-line state explanation>

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  <2-3 lines of plain prose explaining what to do to get into the data state>

  ▸ <fallback action>
```

---

## 4. Locked per-command outputs

These are the approved outputs for v1.6.15. The `<<<value>>>` placeholders show where dynamic values fill in.

### `sipcode drift` (Pattern P)

```
  CONTEXT DRIFT                                          <<<N>>> signals

  tokens per turn       <<<norm>>> → <<<now>>>             ↑ <<<delta%>>>
                        bloated context costs more

  repeated reads        <<<norm>>> → <<<now>>> tokens      ↑ NEW
                        Claude re-reading files it already had

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ▸ start a fresh chat to reset bloat
  ▸ sipcode proxy --install to skip redundant reads
```

When no drift detected, single-line:
```
  CONTEXT DRIFT                                          <<<date/session>>>

  ✓ no regression vs your 30-day norm
```

### `sipcode proxy --stats` (Pattern S)

```
  PROXY ACTIVITY                                            this session

  <<<N>>> rewrites      ~<<<saved>>> tokens saved      signal kept <<<pct>>>% (med)

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  rewriter         fires      saved tokens     integrity
  <<<rewriter>>>      <<<n>>>          <<<saved>>>          <<<pct>>>%
  ...

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ▸ low integrity? run sipcode why to see what was dropped
  ▸ verified savings: npx sipcode benchmark
```

Rewriters sorted by fires (descending). v1.6.15 records every dedup hit (live or warmfill) under a single `dedup-read` row — the saved-tokens number is identical either way. v1.6.16 will split into `dedup-read (live)` and `dedup-read (warmfill)` rows by reading each entry's `source` field at dedup time (presentational improvement; the architecture already records the source).

### `sipcode forecast` (Pattern I)

```
  MONTH-END FORECAST                                  last 14 days

  $<<<projected>>>  projected           range $<<<low>>> - $<<<high>>>

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  current pace
    avg daily               $<<<avg>>>
    median daily            $<<<med>>>
    sessions / 14d          <<<n>>>

  vs last month
    last month              $<<<last>>>
    this month projected    $<<<projected>>>             ↑ <<<delta%>>>

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ▸ at this pace, you'll cross last month's total on the <<<date>>>
```

### `sipcode today` (Pattern I)

```
  TODAY · <<<date>>>                                  detected: <<<agent>>>

  $<<<spend>>> spent       <<<sessions>>> sessions       <<<tokens>>>M tokens       output ratio <<<pct>>>%

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  vs 30-day median
    spend / day        $<<<med>>>   →   $<<<today>>>            ↑ <<<delta%>>>
    tokens / day       <<<med>>>M   →    <<<today>>>M           ↑ <<<delta%>>>
    output ratio        <<<med>>>%   →     <<<today>>>%          ↓ <<<delta>>> pp

  top leak
    <<<file>>>     <<<n>>> re-reads      $<<<cost>>>

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ▸ <<<contextual insight, e.g. "tokens up but output ratio down — context bloat, run sipcode drift">>>
```

### `sipcode impact` — no-data state

```
  IMPACT — before vs after Sipcode                     pivot <<<date>>>

  ⏳ not enough post-install data yet

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Sipcode needs at least a few days of post-install sessions
  to compute a meaningful before-vs-after comparison.

  ▸ in the meantime, run sipcode why for per-session forensics
```

### `sipcode impact` — data state

```
  IMPACT — before vs after Sipcode                     pivot <<<date>>>

  spend  / session     $<<<before>>>   →   $<<<after>>>           ↓ <<<delta%>>>
  tokens / session     <<<before>>>   →    <<<after>>>            ↓ <<<delta%>>>
  re-read waste        <<<before>>>   →    <<<after>>>            ↓ <<<delta%>>>

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  based on <<<n>>> sessions before, <<<m>>> sessions after the install marker.

  ▸ share your delta:  sipcode receipt
```

### `sipcode why` (Pattern P)

```
  SESSION FORENSICS                          session <<<sid>>>

  <<<tokens>>> tokens         <<<turns>>> turns          $<<<cost>>> spent

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  heaviest turns
    <<<turn>>>      <<<tokens>>> tok      <<<tool>>> <<<target>>>
    ...

  heaviest files
    <<<file>>>      <<<n>>> reads      <<<tokens>>> tok
    ...

  rewrites applied
    <<<rewriter>>>      <<<n>>> fires
    ...

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ▸ <<<actionable insight based on the heaviest file>>>
```

### `sipcode benchmark` — floor-framed (Pattern S)

```
  BENCHMARK · corpus v1.0.0 · reproducible by anyone

  62.6%   median savings on a locked 20-task corpus

          range 37.4% - 80.6%        3.57M tokens        $67.43

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  top 6 by savings %
    BT008    80.6%   ▓▓▓▓▓▓▓░    218,500  →   42,280
    BT011    78.1%   ▓▓▓▓▓▓▓░    247,500  →   54,250
    BT003    77.2%   ▓▓▓▓▓▓░░    278,900  →   63,720
    BT013    74.6%   ▓▓▓▓▓▓░░    296,800  →   75,320
    BT015    69.2%   ▓▓▓▓▓▓░░    197,300  →   60,700
    BT012    64.6%   ▓▓▓▓▓▓░░    209,900  →   74,370

    (14 more tasks — run sipcode benchmark --full for all)

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  this is the verifiable floor. your workload is usually higher.
  ▸ measure yours:  sipcode impact
  ▸ methodology:    benchmark/METHODOLOGY.md
```

The bar uses `▓` (U+2593) and `░` (U+2591). Solid-vs-stippled, no color needed. Width is 8 cells; fill is `Math.round(savingsPct / 100 * 8)` cells.

### `sipcode init` (Pattern I, success state)

```
  SETUP

  ✓ Claude Code detected             (<<<version>>>)
  ✓ ~/.claude/settings.json          (writable)
  ✓ proxy hook installed             (signature v4, <<<sipcode version>>>)
  ✓ install marker set               (impact baseline will start now)
  ✓ MCP server registered            (<<<N>>> tools)

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ready. your next Claude Code session will use Sipcode automatically.

  ▸ verify in 5 minutes:  sipcode drift
  ▸ measure delta in 3-7 days:  sipcode impact
```

When something is missing, replace the corresponding ✓ with `✗` and add an action line explaining the fix:
```
  ✗ Claude Code detected             (not found)
```

---

## 5. Test seam

All formatters live in `src/cli/formatters/style-c/` and are pure functions taking a typed data object, returning a string. No `console.log` in the formatter. Tests assert the output character-by-character for stability.

A pure formatter means: a benchmark run that produced `{median: 62.6, totalSaved: 3567170, ...}` will always render to the same string, in any version of Sipcode, on any OS. That's the reproducibility property we want for blog posts, screenshots, and bug reports.

---

## 6. Landing-page mirror

The Home page (`docs/site/src/components/LiveTerminals.astro`) renders pre-baked snapshots of three of these outputs (drift, forecast, benchmark) using exact-character matching to what the CLI would produce on the dogfood corpus. If the CLI output style changes, that Astro file must be regenerated. Owner: whoever updates this doc.

---

*Last updated: 2026-06-15. Maintained as the canonical style guide for v1.6.15+.*
