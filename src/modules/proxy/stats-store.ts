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
  for (const e of entries) {
    total += e.savedTokensEstimate;
    const pr = (perRewriter[e.rewriterName] ??= {
      invocations: 0,
      estimatedSavedTokens: 0,
    });
    pr.invocations++;
    pr.estimatedSavedTokens += e.savedTokensEstimate;
  }

  return {
    schemaVersion: "sipcode-proxy/2",
    totalInvocations: entries.length,
    estimatedSavedTokens: total,
    perRewriter,
    note: "Per-rewriter savings are heuristic estimates, not measured per-invocation. For verified savings, run `npx sipcode benchmark`.",
  };
}
