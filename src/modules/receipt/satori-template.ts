/**
 * Element-tree template for satori. Built with a plain `h()` factory so no
 * JSX / tsconfig change is needed.
 *
 * Satori accepts react-element-like objects with `type`, `props.style`, and
 * `props.children`. Layout is a constrained subset of CSS (flex / absolute).
 *
 * Design spec (LOCKED, see docs/PROJECT-SPEC.md §6.3):
 *   - 1200×630 (Twitter/LinkedIn OG-image ratio)
 *   - bg #0b0e0e, paper #e8e1d4, mint #3ddc97 (post), red #ff6b6b (pre)
 *   - Inter (body), Inter Tight (display), JetBrains Mono (numbers on leaks)
 *   - No charts, no graphs, no QR, no emoji.
 */
import type { ReceiptModel } from "./types.js";

// Satori's element type is structural; we model the subset we need.
export interface SatoriNode {
  readonly type: string;
  readonly props: {
    readonly style?: Record<string, string | number>;
    readonly children?: SatoriNode | string | ReadonlyArray<SatoriNode | string>;
  };
}

const BG = "#0b0e0e";
const PAPER = "#e8e1d4";
const MINT = "#3ddc97";
const MUTED = "#9b9690";
const RED = "#ff6b6b";
const HAIRLINE = "#1a1d1d";

function h(
  type: string,
  style: Record<string, string | number>,
  children?: SatoriNode | string | ReadonlyArray<SatoriNode | string>,
): SatoriNode {
  return {
    type,
    props: children !== undefined ? { style, children } : { style },
  };
}

export function buildReceiptTree(model: ReceiptModel): SatoriNode {
  const accent = model.variant === "post-install" ? MINT : RED;

  // Top strip: wordmark + duration/date.
  const top = h(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "baseline",
      width: "100%",
    },
    [
      h(
        "div",
        {
          fontSize: 30,
          fontWeight: 700,
          color: PAPER,
          letterSpacing: "-0.02em",
          fontFamily: "Inter Tight",
        },
        "sipcode",
      ),
      h(
        "div",
        { fontSize: 22, color: MUTED, fontFamily: "Inter" },
        `${model.header.durationDisplay}  ·  ${model.header.dateDisplay}`,
      ),
    ],
  );

  const divider = h("div", {
    height: 1,
    width: "100%",
    backgroundColor: HAIRLINE,
    marginTop: 18,
    marginBottom: 28,
  });

  const hero = h(
    "div",
    { display: "flex", flexDirection: "column" },
    [
      h(
        "div",
        {
          fontSize: 160,
          fontWeight: 700,
          color: accent,
          lineHeight: 1,
          letterSpacing: "-0.04em",
          fontFamily: "Inter Tight",
        },
        model.hero.tokensDisplay,
      ),
      h(
        "div",
        {
          fontSize: 28,
          color: PAPER,
          marginTop: 8,
          fontFamily: "Inter",
        },
        model.hero.sublabel,
      ),
      h(
        "div",
        {
          fontSize: 18,
          color: MUTED,
          marginTop: 8,
          fontFamily: "Inter",
        },
        `≈ ${model.hero.dollarDisplay}  ·  prices as of ${model.hero.pricingAsOf}`,
      ),
    ],
  );

  const leaksTitle = h(
    "div",
    {
      fontSize: 18,
      color: MUTED,
      letterSpacing: "0.18em",
      textTransform: "uppercase",
      marginBottom: 8,
      fontFamily: "Inter",
    },
    "what we caught",
  );

  const leakRows: SatoriNode[] = model.leaks.map((leak) =>
    h(
      "div",
      {
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "baseline",
        paddingTop: 8,
        paddingBottom: 8,
        borderBottom: `1px solid ${HAIRLINE}`,
        width: "100%",
      },
      [
        h(
          "div",
          { fontSize: 24, color: PAPER, fontFamily: "Inter" },
          `${leak.rank}.  ${leak.title}`,
        ),
        h(
          "div",
          {
            fontSize: 22,
            color: PAPER,
            fontFamily: "JetBrains Mono",
            fontWeight: 500,
          },
          leak.tokensDisplay,
        ),
      ],
    ),
  );

  const leaks = h(
    "div",
    { display: "flex", flexDirection: "column", width: "100%" },
    [leaksTitle, ...leakRows],
  );

  const bottom = h(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "baseline",
      width: "100%",
    },
    [
      h(
        "div",
        { fontSize: 22, color: MUTED, fontFamily: "Inter" },
        model.footer.tagline,
      ),
      h(
        "div",
        {
          fontSize: 22,
          color: PAPER,
          fontWeight: 700,
          fontFamily: "Inter Tight",
          letterSpacing: "-0.01em",
        },
        model.footer.url,
      ),
    ],
  );

  // Root container: 1200×630 with internal padding.
  return h(
    "div",
    {
      width: 1200,
      height: 630,
      backgroundColor: BG,
      color: PAPER,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "56px 64px",
      fontFamily: "Inter",
    },
    [
      h("div", { display: "flex", flexDirection: "column", width: "100%" }, [
        top,
        divider,
        hero,
      ]),
      leaks,
      bottom,
    ],
  );
}
