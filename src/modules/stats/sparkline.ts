/**
 * Pure unicode sparkline.
 *
 * Maps an array of values to a string of block characters whose heights
 * track magnitude relative to max. Width-capped via downsampling — buckets
 * the input by summing within fixed-size windows.
 */

const BLOCKS = "▁▂▃▄▅▆▇█";

export function sparkline(values: readonly number[], width = 30): string {
  if (values.length === 0) return "";
  const sampled = downsample(values, Math.max(1, Math.floor(width)));
  let max = 0;
  for (const v of sampled) {
    if (v > max) max = v;
  }
  if (max <= 0) {
    // All zeros: render the lowest block so the chart is visible.
    return BLOCKS[0]!.repeat(sampled.length);
  }
  const out: string[] = [];
  for (const v of sampled) {
    const norm = v / max;
    const idx = Math.min(
      BLOCKS.length - 1,
      Math.max(0, Math.floor(norm * BLOCKS.length)),
    );
    out.push(BLOCKS[idx]!);
  }
  return out.join("");
}

/**
 * Downsample by summing inputs into `width` buckets. When input is shorter
 * than width, returns it unchanged (no upsampling).
 */
export function downsample(values: readonly number[], width: number): number[] {
  const w = Math.max(1, Math.floor(width));
  if (values.length <= w) return values.slice();
  const out: number[] = new Array(w).fill(0);
  const ratio = values.length / w;
  for (let i = 0; i < values.length; i++) {
    const bucket = Math.min(w - 1, Math.floor(i / ratio));
    out[bucket] = (out[bucket] ?? 0) + (values[i] ?? 0);
  }
  return out;
}

export function sparklineStats(values: readonly number[]): {
  min: number;
  max: number;
  median: number;
} {
  if (values.length === 0) return { min: 0, max: 0, median: 0 };
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : sorted[mid] ?? 0;
  return {
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    median,
  };
}
