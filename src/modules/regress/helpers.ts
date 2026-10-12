/** Number and time formatting shared by the regress checks. Pure. */

/** 0.253 → "25.3%". */
export const pct = (x: number): string => (100 * x).toFixed(1) + "%";

/** 12345.6 → "12,346". */
export const fmtN = (n: number): string => Math.round(n).toLocaleString("en-US");

/** Epoch ms → ISO 8601 (UTC). */
export const isoTime = (ms: number): string => new Date(ms).toISOString();

/** The prototype's median: the middle element, or the upper of the two middle ones; 0 for none. */
export function upperMedian(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}
