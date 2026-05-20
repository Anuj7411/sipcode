/**
 * Pure pressure-band classifier — used by `hygiene --check` and shared
 * conceptually with the generated hook script (the hook re-implements
 * this inline to stay dep-free, but the logic is identical).
 */
import { APPROX_CONTEXT_WINDOW_TOKENS } from "./hookScript.js";
import type { PressureBand, PressureSample } from "./types.js";

const BANDS: ReadonlyArray<{ at: number; band: PressureBand; message: string }> = [
  { at: 0.9, band: "p90", message: "[sipcode] context at ~90%. /compact now — or start a new session." },
  { at: 0.7, band: "p70", message: "[sipcode] context at ~70%. /compact recommended at next natural break." },
  { at: 0.5, band: "p50", message: "[sipcode] context at ~50%. consider summarizing before continuing." },
];

/** Read the last assistant turn with a usage block and compute utilization. */
export function utilizationFromTranscript(
  transcriptContent: string,
  approxWindow: number = APPROX_CONTEXT_WINDOW_TOKENS,
): number {
  if (transcriptContent.length === 0) return 0;
  const lines = transcriptContent.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i];
    if (!ln || !ln.includes(`"usage"`)) continue;
    try {
      const obj = JSON.parse(ln) as {
        message?: { usage?: Record<string, number> };
        usage?: Record<string, number>;
      };
      const u = obj.message?.usage ?? obj.usage;
      if (!u) continue;
      const input =
        (u.input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0);
      const output = u.output_tokens ?? 0;
      return (input + output) / approxWindow;
    } catch {
      /* keep scanning */
    }
  }
  return 0;
}

export function classifyPressure(utilization: number): PressureSample {
  for (const b of BANDS) {
    if (utilization >= b.at) {
      return { band: b.band, utilization, message: b.message };
    }
  }
  return {
    band: "none",
    utilization,
    message: `[sipcode] context at ~${Math.round(utilization * 100)}%. nothing to do yet.`,
  };
}
