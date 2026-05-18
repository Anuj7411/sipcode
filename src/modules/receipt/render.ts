/**
 * Receipt renderer — pure: RenderedReport + variant → ReceiptModel.
 *
 * The receipt is a *brag*, not a dashboard. It surfaces:
 *   - one big number (sipped / wasted)
 *   - a dollar equivalent
 *   - three leaks, ranked
 *   - a tagline + url
 *
 * No I/O. No locale-sensitive formatting outside `lib/format.ts`.
 */
import { formatNum, formatUSD } from "../../lib/format.js";
import type { RenderedReport } from "../why/render.js";
import type {
  ReceiptLeak,
  ReceiptModel,
  ReceiptVariant,
} from "./types.js";

export interface RenderReceiptInput {
  readonly report: RenderedReport;
  readonly variant: ReceiptVariant;
  /** ISO timestamp of session start (drives the "as of" date — idempotent). */
  readonly sessionStartedAt: string | undefined;
}

const TAGLINE = "sip your tokens. don't gulp them.";
const URL = "sipcode.dev";

/** en-US, year-month-day. Locale-pinned so screenshots are identical across hosts. */
const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  timeZone: "UTC",
});

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return DATE_FMT.format(d);
}

export function renderReceipt(input: RenderReceiptInput): ReceiptModel {
  const { report, variant } = input;

  const tokens =
    variant === "post-install"
      ? report.estimatedSavings.totalTokens
      : report.punchline.totalTokens;

  const dollars =
    variant === "post-install"
      ? report.estimatedSavings.totalUSD
      : report.totals.estCostUSD;

  const sublabel: "sipped" | "wasted" =
    variant === "post-install" ? "sipped" : "wasted";

  // Leaks: take the report's top three (already ranked, already filtered to >0).
  const leaks: ReceiptLeak[] = report.topLeaks
    .slice(0, 3)
    .map((l, i): ReceiptLeak => ({
      rank: ((i + 1) as 1 | 2 | 3),
      title: l.title,
      tokensDisplay: formatNum(l.tokens),
    }));

  return {
    schemaVersion: "sipcode-receipt/1",
    variant,
    header: {
      sessionIdShort: report.header.sessionIdShort.slice(0, 4).toLowerCase(),
      dateDisplay: fmtDate(input.sessionStartedAt),
      durationDisplay: report.header.durationHuman,
    },
    hero: {
      tokens,
      tokensDisplay: formatNum(tokens),
      sublabel,
      dollarDisplay: formatUSD(dollars),
      pricingAsOf: report.metaPricing.asOf,
    },
    leaks,
    footer: { tagline: TAGLINE, url: URL },
  };
}
