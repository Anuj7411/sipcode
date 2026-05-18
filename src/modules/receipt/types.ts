/**
 * Receipt domain types.
 *
 * Pure data flowing through the receipt pipeline:
 *   RenderedReport + variant → ReceiptModel
 *                            → terminal string
 *                            → standalone HTML string
 *                            → PNG bytes (via satori + resvg)
 *
 * All locale-sensitive numbers are pre-formatted into `*Display` strings via
 * `lib/format.ts`, so the visual renderers never re-format.
 */

export type ReceiptVariant = "post-install" | "pre-install";

export interface ReceiptHeader {
  /** First 4 hex chars of session id, lowercase. */
  readonly sessionIdShort: string;
  /** Locale-pinned date string for the receipt — derived from session start. */
  readonly dateDisplay: string;
  /** Pre-formatted duration e.g. "12m 3s". */
  readonly durationDisplay: string;
}

export interface ReceiptHero {
  /** Big number — total tokens sipped (post) or wasted (pre). */
  readonly tokens: number;
  /** Pre-formatted via formatNum (en-US). */
  readonly tokensDisplay: string;
  /** "sipped" or "wasted". */
  readonly sublabel: "sipped" | "wasted";
  /** Dollar equivalent — pre-formatted via formatUSD. */
  readonly dollarDisplay: string;
  /** Pricing as-of date footnote (locale-pinned ISO). */
  readonly pricingAsOf: string;
}

export interface ReceiptLeak {
  readonly rank: 1 | 2 | 3;
  /** Lowercase title. */
  readonly title: string;
  /** Mono right-aligned number. */
  readonly tokensDisplay: string;
}

export interface ReceiptFooter {
  readonly tagline: string;
  readonly url: string;
}

export interface ReceiptModel {
  readonly schemaVersion: "sipcode-receipt/1";
  readonly variant: ReceiptVariant;
  readonly header: ReceiptHeader;
  readonly hero: ReceiptHero;
  readonly leaks: ReadonlyArray<ReceiptLeak>;
  readonly footer: ReceiptFooter;
}

export interface ReceiptShareLinks {
  /** Pre-encoded https://twitter.com/intent/tweet?text=... */
  readonly tweetIntentUrl: string;
  /** Decoded copy text (for terminal echo / testing). */
  readonly tweetText: string;
}
