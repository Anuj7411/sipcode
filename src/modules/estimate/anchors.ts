/**
 * anchors — I/O wrapper.
 *
 * Walk `~/.claude/projects` (or SIPCODE_PROJECTS_DIR override), parse every
 * transcript via the existing transcript pipeline, and find sessions whose
 * tool-call shape resembles the predicted complexity tier of the current
 * task. Return the median total-token cost as a sanity-check anchor.
 *
 * Tier match windows (chosen to be permissive — most users have few enough
 * transcripts that a stricter filter would zero out):
 *   high:   tool calls ≥ 30  AND distinct reads ≥ 20
 *   medium: 10 ≤ tool calls < 30 AND 5 ≤ distinct reads < 20
 *   low:    tool calls < 10 AND distinct reads < 5
 *
 * We deliberately scan all projects (not just `--here`) because users often
 * have past sessions in sibling repos that resemble the task at hand. Capped
 * at 60 most-recent sessions for speed.
 */
import path from "node:path";
import type { FileSystem } from "../../lib/fs.js";
import type { ProcessEnv } from "../../lib/process.js";
import {
  listAllSessions,
  resolveProjectsDir,
  type SessionMeta,
} from "../transcript/discover.js";
import { parseTranscript } from "../transcript/parse.js";
import type { ComplexityTier, HistoricalAnchors } from "./types.js";

const MAX_SESSIONS_TO_SCAN = 120;

export interface AnchorOptions {
  /** Skip entirely (CLI flag --no-anchors). */
  readonly skip?: boolean;
  /** Cap on transcripts scanned. Defaults to MAX_SESSIONS_TO_SCAN. */
  readonly maxSessions?: number;
}

interface SessionShape {
  readonly toolCalls: number;
  readonly distinctReads: number;
  readonly totalTokens: number;
}

/**
 * Token weights for converting a real session's mix into "input-equivalent"
 * tokens. These come from Anthropic's pricing ratios relative to the input
 * price (using opus 4 as the reference, but the ratios are stable across
 * the opus/sonnet/haiku family):
 *   input         × 1.00   ($15/Mtok)
 *   output        × 5.00   ($75/Mtok)
 *   cache_read    × 0.10   ($1.50/Mtok)
 *   cache_create  × 1.25   ($18.75/Mtok)
 *
 * When the predictor later prices the result at the model's input rate,
 * the dollar number matches what Anthropic actually billed.
 */
const CACHE_READ_WEIGHT = 0.1;
const CACHE_CREATION_WEIGHT = 1.25;
const OUTPUT_WEIGHT = 5.0;

function shapeFor(content: string): SessionShape {
  const r = parseTranscript(content);
  if (!r.ok) {
    return { toolCalls: 0, distinctReads: 0, totalTokens: 0 };
  }
  const s = r.value;
  let totalTokens = 0;
  const reads = new Set<string>();
  for (const turn of s.assistantTurns) {
    totalTokens +=
      turn.inputTokens +
      turn.outputTokens * OUTPUT_WEIGHT +
      turn.cacheReadTokens * CACHE_READ_WEIGHT +
      turn.cacheCreationTokens * CACHE_CREATION_WEIGHT;
  }
  for (const c of s.toolCalls) {
    if (c.name === "Read") {
      const input = c.input as { file_path?: string } | undefined;
      const file = input?.file_path;
      if (file) reads.add(String(file).toLowerCase());
    }
  }
  return {
    toolCalls: s.toolCalls.length,
    distinctReads: reads.size,
    totalTokens: Math.round(totalTokens),
  };
}

export function tierMatchesShape(
  tier: ComplexityTier,
  shape: SessionShape,
): boolean {
  if (tier === "high") {
    return shape.toolCalls >= 30 && shape.distinctReads >= 20;
  }
  if (tier === "medium") {
    return (
      shape.toolCalls >= 10 &&
      shape.toolCalls < 30 &&
      shape.distinctReads >= 5 &&
      shape.distinctReads < 20
    );
  }
  // low
  return shape.toolCalls < 10 && shape.distinctReads < 5;
}

export function median(nums: ReadonlyArray<number>): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  }
  return sorted[mid]!;
}

export function confidenceFor(matchedCount: number): HistoricalAnchors["confidence"] {
  if (matchedCount >= 3) return "high";
  if (matchedCount >= 1) return "medium";
  return "low";
}

export async function loadAnchors(
  fs: FileSystem,
  env: ProcessEnv,
  tier: ComplexityTier,
  opts: AnchorOptions = {},
): Promise<HistoricalAnchors> {
  if (opts.skip) {
    return {
      matchedCount: 0,
      medianHistoricalTokens: 0,
      confidence: "low",
      skipped: true,
    };
  }

  const projectsDir = resolveProjectsDir(env);
  if (!(await fs.exists(projectsDir))) {
    return {
      matchedCount: 0,
      medianHistoricalTokens: 0,
      confidence: "low",
      skipped: false,
    };
  }

  let sessions: SessionMeta[];
  try {
    sessions = await listAllSessions(fs, projectsDir);
  } catch {
    return {
      matchedCount: 0,
      medianHistoricalTokens: 0,
      confidence: "low",
      skipped: false,
    };
  }

  const cap = opts.maxSessions ?? MAX_SESSIONS_TO_SCAN;
  const limited = sessions.slice(0, cap);
  const matched: number[] = [];
  for (const sess of limited) {
    let content: string;
    try {
      content = await fs.readFile(sess.filePath);
    } catch {
      continue;
    }
    const shape = shapeFor(content);
    if (tierMatchesShape(tier, shape) && shape.totalTokens > 0) {
      matched.push(shape.totalTokens);
    }
  }
  const med = median(matched);
  return {
    matchedCount: matched.length,
    medianHistoricalTokens: med,
    confidence: confidenceFor(matched.length),
    skipped: false,
  };
}

// Used by anchors.test.ts to make a tier check easy without exporting shape.
export const _internal = { shapeFor };

// Suppress noUnused for path import in some configs.
void path;
