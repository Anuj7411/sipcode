/**
 * Proxy stats store.
 *
 * `appendFile` is NOT reliably atomic on Windows for parallel writers, and the
 * hook can fire many times concurrently. Mitigation: each invocation writes its
 * own file `proxy-stats-<pid>-<timestamp>.jsonl`; `readReport` aggregates across
 * all of them. No write-time concurrency, so no append races on any platform.
 */
import { writeFile, readdir, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ProxyStatsEntry, ProxyReport } from "./types.js";

// Per-process sequence so rapid same-millisecond writes never collide on a
// filename. The hook fires once per process (pid differs across invocations),
// so pid + timestamp + seq is unique on every platform.
let seq = 0;

export async function writeStats(
  dir: string,
  entry: ProxyStatsEntry,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const filename = `proxy-stats-${process.pid}-${Date.now()}-${seq++}.jsonl`;
  await writeFile(join(dir, filename), JSON.stringify(entry) + "\n", "utf-8");
}

export async function readReport(dir: string): Promise<ProxyReport> {
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter(
      (f) => f.startsWith("proxy-stats-") && f.endsWith(".jsonl"),
    );
  } catch {
    /* dir missing — empty report */
  }

  const entries: ProxyStatsEntry[] = [];
  for (const f of files) {
    try {
      const raw = await readFile(join(dir, f), "utf-8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line) as ProxyStatsEntry);
        } catch {
          /* skip malformed line */
        }
      }
    } catch {
      /* skip unreadable file */
    }
  }

  let total = 0;
  const perRewriter: ProxyReport["perRewriter"] = {};
  const integritySums: Record<string, { sum: number; count: number }> = {};
  for (const e of entries) {
    total += e.savedTokensEstimate;
    const pr = (perRewriter[e.rewriterName] ??= {
      invocations: 0,
      estimatedSavedTokens: 0,
    });
    pr.invocations++;
    pr.estimatedSavedTokens += e.savedTokensEstimate;
    if (typeof e.integrityScore === "number") {
      const is = (integritySums[e.rewriterName] ??= { sum: 0, count: 0 });
      is.sum += e.integrityScore;
      is.count++;
    }
  }

  let globalIntegritySum = 0;
  let globalIntegrityCount = 0;
  for (const name of Object.keys(perRewriter)) {
    const is = integritySums[name];
    if (is && is.count > 0) {
      perRewriter[name]!.avgIntegrityScore = is.sum / is.count;
      globalIntegritySum += is.sum;
      globalIntegrityCount += is.count;
    }
  }
  const weightedAvgIntegrityScore =
    globalIntegrityCount > 0 ? globalIntegritySum / globalIntegrityCount : undefined;

  return {
    schemaVersion: "sipcode-proxy/2",
    totalInvocations: entries.length,
    estimatedSavedTokens: total,
    perRewriter,
    weightedAvgIntegrityScore,
    note: "Per-rewriter savings are heuristic estimates, not measured per-invocation. For verified savings, run `npx sipcode benchmark`.",
  };
}
