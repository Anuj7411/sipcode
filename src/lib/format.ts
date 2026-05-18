/**
 * Locale-stable formatting helpers.
 *
 * All user-facing numbers go through these so output is screenshot-consistent
 * across machines regardless of system locale. We pin to en-US for v1.0;
 * proper i18n is a v1.1+ concern.
 */

const NUM = new Intl.NumberFormat("en-US");

/** Format an integer with US-style thousands separators (e.g. 1,234,567). */
export const formatNum = (n: number): string => NUM.format(n);

/** Format USD with 4-decimal precision (matches token-cost granularity). */
export const formatUSD = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;

/** Format a percentage with 1 decimal (e.g. 0.9%). */
export const formatPct = (n: number): string =>
  `${n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
