/**
 * Pure: numeric score → Tier label. Stable thresholds — public API.
 */
import type { Tier } from "./types.js";

export function tierFor(score: number): Tier {
  if (score >= 90) return "platinum";
  if (score >= 75) return "gold";
  if (score >= 60) return "silver";
  if (score >= 40) return "bronze";
  return "needs-work";
}

/** Tier → ASCII stars for terminal output. */
export function tierStars(tier: Tier): string {
  switch (tier) {
    case "platinum":
      return "*****";
    case "gold":
      return "****";
    case "silver":
      return "***";
    case "bronze":
      return "**";
    case "needs-work":
      return "*";
  }
}

/** Tier → hex color for badge + html. */
export function tierColor(tier: Tier): string {
  switch (tier) {
    case "platinum":
      return "#3DDC97"; // mint
    case "gold":
      return "#3DDC97"; // mint
    case "silver":
      return "#E8E1D4"; // paper
    case "bronze":
      return "#FF9F45"; // warm orange
    case "needs-work":
      return "#FF6B6B"; // salmon
  }
}
