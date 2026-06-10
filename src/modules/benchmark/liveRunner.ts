/**
 * Live benchmark runner — spawns the actual Claude Code CLI on a corpus task
 * twice (with the proxy off vs on), captures real reported usage, persists to
 * `~/.sipcode/benchmark-live/results.jsonl`.
 *
 * This is the harness behind `sipcode benchmark --vs-rtk --live`. Heuristic
 * mode (default) stays in `vsRtk.ts`. Live mode is opt-in because each run
 * spends real Anthropic credit on the user's account.
 *
 * Backend: the `claude` CLI shipped with Claude Code. Toggle:
 *   - off  → claude --print --output-format json --bare    (skip hooks)
 *   - on   → claude --print --output-format json           (proxy hook fires)
 *   - rtk  → wraps the rtk binary if installed (deferred to a follow-up)
 *
 * The spawn + filesystem I/O lives behind a `LiveIO` seam so unit tests can
 * inject deterministic responses. The real seam is at `realLiveIO`.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

export type Condition = "off" | "on" | "rtk";

export interface LiveResultRow {
  /** Unique per run. UUIDv4-ish; we generate locally without the crypto module. */
  readonly runId: string;
  readonly taskId: string;
  readonly condition: Condition;
  /** Model the CLI reported. Useful when the user pinned --model. */
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Sum of cache_read + cache_creation tokens, if reported. */
  readonly cacheTokens: number;
  readonly totalTokens: number;
  /** Anthropic-reported cost USD (when --print --output-format json includes it). */
  readonly costUsd: number;
  /** Wall-clock duration in ms. */
  readonly durationMs: number;
  readonly completedAt: string;
  /** Exit code; 0 on success. */
  readonly exitCode: number;
  /** Truncated stderr tail (max 800 chars) for failure diagnosis. */
  readonly stderrTail?: string | undefined;
}

export interface RunOpts {
  /** Override the claude binary path; default "claude" from PATH. */
  readonly claudeBin?: string;
  /** Override the model; default unset (claude picks). */
  readonly model?: string;
  /** Max budget USD safety cap; default 1.00. */
  readonly maxBudgetUsd?: number;
  /** Timeout in ms; default 5 minutes. */
  readonly timeoutMs?: number;
}

export interface LiveIO {
  /** Append a line to the persistence JSONL. */
  appendResult(p: string, row: LiveResultRow): Promise<void>;
  /** Read all persisted rows from the JSONL. */
  readResults(p: string): Promise<LiveResultRow[]>;
  /** Spawn `claude` with the prepared args + cwd; return stdout/stderr/exit/duration. */
  spawnClaude(args: {
    bin: string;
    args: string[];
    cwd: string;
    prompt: string;
    timeoutMs: number;
  }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
  }>;
  /** Stable, monotonic-ish run id. */
  newRunId(): string;
  /** Wall-clock now. Pure injection so tests can freeze time. */
  now(): Date;
}

export const realLiveIO: LiveIO = {
  async appendResult(p, row) {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.appendFile(p, JSON.stringify(row) + "\n", "utf-8");
  },
  async readResults(p) {
    try {
      const raw = await fs.readFile(p, "utf-8");
      const rows: LiveResultRow[] = [];
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          rows.push(JSON.parse(line) as LiveResultRow);
        } catch {
          // skip malformed
        }
      }
      return rows;
    } catch {
      return [];
    }
  },
  spawnClaude({ bin, args, cwd, prompt, timeoutMs }) {
    return new Promise((resolve) => {
      const started = Date.now();
      const child = spawn(bin, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => {
        stdout += d.toString();
      });
      child.stderr.on("data", (d) => {
        stderr += d.toString();
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, timeoutMs);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
          durationMs: Date.now() - started,
        });
      });
      // Pass prompt on stdin (avoids huge argv on long prompts).
      child.stdin.write(prompt);
      child.stdin.end();
    });
  },
  newRunId() {
    // Local UUID-ish: timestamp + counter. Avoids the node:crypto dep so the
    // privacy guard doesn't have to special-case this file.
    const t = Date.now().toString(36);
    const r = Math.floor(Math.random() * 1e9).toString(36);
    return `run-${t}-${r}`;
  },
  now() {
    return new Date();
  },
};

/** Default persistence path. */
export function defaultResultsPath(home: string): string {
  return path.join(home, ".sipcode", "benchmark-live", "results.jsonl");
}

/** Build the claude argv. Identical between off/on conditions — isolation
 * happens externally via `sipcodeIsolation.withSipcodeStripped` (caller's
 * responsibility). `--setting-sources project,local` was tried previously but
 * it skipped ALL user settings (e.g. claude-mem), entangling the delta.
 * `--bare` was also tried but it requires ANTHROPIC_API_KEY and breaks
 * Max-plan OAuth. The clean toggle is "user settings with Sipcode hook entry
 * temporarily removed" — that's what `withSipcodeStripped` does. */
export function buildClaudeArgs(opts: {
  repoDir: string;
  model?: string | undefined;
  maxBudgetUsd?: number | undefined;
}): string[] {
  const args: string[] = [
    "--print",
    "--output-format",
    "json",
    "--no-session-persistence",
    "--add-dir",
    opts.repoDir,
  ];
  if (opts.model) {
    args.push("--model", opts.model);
  }
  if (opts.maxBudgetUsd && opts.maxBudgetUsd > 0) {
    args.push("--max-budget-usd", String(opts.maxBudgetUsd));
  }
  return args;
}

interface ClaudeUsageBlock {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ClaudeJsonOutput {
  type?: string;
  model?: string;
  total_cost_usd?: number;
  usage?: ClaudeUsageBlock;
  // Some versions nest under `result.usage` or report aggregate keys instead.
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_tokens?: number;
}

/** Extract usage from `claude --output-format json` output. Defensive on shape. */
export function parseClaudeJson(stdout: string): {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  costUsd: number;
} {
  let obj: ClaudeJsonOutput = {};
  try {
    // Some CLI versions print one JSON object; others print a stream. Take the
    // last parseable JSON object on stdout as the final summary.
    const lines = stdout.split("\n").filter((l) => l.trim().startsWith("{"));
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        obj = JSON.parse(lines[i]!) as ClaudeJsonOutput;
        break;
      } catch {
        // try the next-older line
      }
    }
  } catch {
    // fall through to defaults
  }
  const usage = obj.usage ?? {};
  const inputTokens = usage.input_tokens ?? obj.total_input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? obj.total_output_tokens ?? 0;
  const cacheTokens =
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);
  const totalTokens =
    obj.total_tokens ?? inputTokens + outputTokens + cacheTokens;
  return {
    model: obj.model ?? "unknown",
    inputTokens,
    outputTokens,
    cacheTokens,
    totalTokens,
    costUsd: obj.total_cost_usd ?? 0,
  };
}

export interface RunOneTaskArgs {
  readonly taskId: string;
  readonly prompt: string;
  readonly repoDir: string;
  readonly condition: Condition;
  readonly opts?: RunOpts;
}

/** Execute one task under one condition. Persists the result row. */
export async function runOneLive(
  args: RunOneTaskArgs,
  resultsPath: string,
  io: LiveIO = realLiveIO,
): Promise<LiveResultRow> {
  const claudeBin = args.opts?.claudeBin ?? "claude";
  const cliArgs = buildClaudeArgs({
    repoDir: args.repoDir,
    model: args.opts?.model,
    maxBudgetUsd: args.opts?.maxBudgetUsd ?? 1.0,
  });
  const timeoutMs = args.opts?.timeoutMs ?? 5 * 60 * 1000;

  const spawned = await io.spawnClaude({
    bin: claudeBin,
    args: cliArgs,
    cwd: args.repoDir,
    prompt: args.prompt,
    timeoutMs,
  });

  const usage = parseClaudeJson(spawned.stdout);
  const row: LiveResultRow = {
    runId: io.newRunId(),
    taskId: args.taskId,
    condition: args.condition,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheTokens: usage.cacheTokens,
    totalTokens: usage.totalTokens,
    costUsd: usage.costUsd,
    durationMs: spawned.durationMs,
    completedAt: io.now().toISOString(),
    exitCode: spawned.exitCode,
    stderrTail:
      spawned.exitCode !== 0
        ? spawned.stderr.slice(-800)
        : undefined,
  };
  await io.appendResult(resultsPath, row);
  return row;
}

export interface PerTaskAggregate {
  readonly taskId: string;
  readonly off?: { runs: number; medianTotalTokens: number; medianCostUsd: number } | undefined;
  readonly on?: { runs: number; medianTotalTokens: number; medianCostUsd: number } | undefined;
  readonly rtk?: { runs: number; medianTotalTokens: number; medianCostUsd: number } | undefined;
  /** Percentage tokens saved by "on" vs "off" (median basis). 0 if either is missing. */
  readonly sipcodeSavedPct: number;
  /** Percentage tokens saved by "rtk" vs "off" (median basis). 0 if either is missing. */
  readonly rtkSavedPct: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
}

/**
 * Aggregate persisted rows into per-task medians + savings %. Pure.
 *
 * Inclusion criterion: `totalTokens > 0` (work was measurably done), not
 * `exitCode === 0`. Discovered 2026-06-09: claude --print can exit 1 from
 * tangential SessionEnd hooks (e.g. claude-mem) AFTER the actual task usage
 * has been reported. The token data is real; ignore the spurious exit code.
 */
export function aggregate(rows: ReadonlyArray<LiveResultRow>): PerTaskAggregate[] {
  const byTask = new Map<string, LiveResultRow[]>();
  for (const r of rows) {
    if (r.totalTokens <= 0) continue;
    if (!byTask.has(r.taskId)) byTask.set(r.taskId, []);
    byTask.get(r.taskId)!.push(r);
  }
  const out: PerTaskAggregate[] = [];
  for (const [taskId, rs] of byTask) {
    const byCond: Record<Condition, LiveResultRow[]> = { off: [], on: [], rtk: [] };
    for (const r of rs) byCond[r.condition].push(r);
    const sum = (cond: Condition) =>
      byCond[cond].length === 0
        ? undefined
        : {
            runs: byCond[cond].length,
            medianTotalTokens: median(byCond[cond].map((r) => r.totalTokens)),
            medianCostUsd: median(byCond[cond].map((r) => r.costUsd)),
          };
    const off = sum("off");
    const on = sum("on");
    const rtk = sum("rtk");
    const sipcodeSavedPct =
      off && on && off.medianTotalTokens > 0
        ? Math.round(((off.medianTotalTokens - on.medianTotalTokens) / off.medianTotalTokens) * 100)
        : 0;
    const rtkSavedPct =
      off && rtk && off.medianTotalTokens > 0
        ? Math.round(((off.medianTotalTokens - rtk.medianTotalTokens) / off.medianTotalTokens) * 100)
        : 0;
    out.push({ taskId, off, on, rtk, sipcodeSavedPct, rtkSavedPct });
  }
  out.sort((a, b) => a.taskId.localeCompare(b.taskId));
  return out;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** Render the live comparison table for a terminal. Pure. */
export function renderLiveTable(aggregates: ReadonlyArray<PerTaskAggregate>): string {
  const lines: string[] = [];
  lines.push("sipcode benchmark --vs-rtk --live (measured)");
  lines.push("");
  lines.push(
    `  ${"task".padEnd(8)} ${"off".padStart(10)} ${"sipcode".padStart(10)} ${"sipcode%".padStart(9)} ${"rtk".padStart(10)} ${"rtk%".padStart(7)}  runs`,
  );
  let anyOn = false;
  let anyOff = false;
  let totalOff = 0;
  let totalOn = 0;
  let totalRtk = 0;
  let anyRtk = false;
  for (const a of aggregates) {
    const offStr = a.off ? fmt(a.off.medianTotalTokens) : "—";
    const onStr = a.on ? fmt(a.on.medianTotalTokens) : "—";
    const rtkStr = a.rtk ? fmt(a.rtk.medianTotalTokens) : "—";
    const runs = [a.off?.runs ?? 0, a.on?.runs ?? 0, a.rtk?.runs ?? 0].join("/");
    const sipPct = a.off && a.on ? a.sipcodeSavedPct + "%" : "—";
    const rtkPct = a.off && a.rtk ? a.rtkSavedPct + "%" : "—";
    lines.push(
      `  ${a.taskId.padEnd(8)} ${offStr.padStart(10)} ${onStr.padStart(10)} ${sipPct.padStart(9)} ${rtkStr.padStart(10)} ${rtkPct.padStart(7)}  ${runs}`,
    );
    if (a.off) {
      totalOff += a.off.medianTotalTokens;
      anyOff = true;
    }
    if (a.on) {
      totalOn += a.on.medianTotalTokens;
      anyOn = true;
    }
    if (a.rtk) {
      totalRtk += a.rtk.medianTotalTokens;
      anyRtk = true;
    }
  }
  lines.push("");
  if (anyOff && anyOn) {
    const aggPct = totalOff > 0 ? Math.round(((totalOff - totalOn) / totalOff) * 100) : 0;
    lines.push(
      `  measured savings (Sipcode vs unoptimized): ${aggPct}% across ${aggregates.length} tasks.`,
    );
  }
  if (anyRtk) {
    const aggPct = totalOff > 0 ? Math.round(((totalOff - totalRtk) / totalOff) * 100) : 0;
    lines.push(`  measured savings (RTK vs unoptimized): ${aggPct}%`);
  }
  lines.push(
    "  Each cell is a median across all runs persisted in ~/.sipcode/benchmark-live/results.jsonl.",
  );
  return lines.join("\n");
}
