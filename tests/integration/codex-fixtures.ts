/** Codex rollout builders shared by the period-command integration tests. */
import type { InMemoryFs } from "../../src/lib/fs.js";

export const CODEX_SESSIONS = "/home/u/.codex/sessions";

const line = (o: unknown): string => JSON.stringify(o);

/** A usage-limit reading Codex logs after a request (event_msg token_count rate_limits). */
export interface CodexLimit {
  readonly usedPercent: number;
  readonly windowMinutes: number;
  readonly resetsAt: string;
  readonly planType?: string;
}

export interface CodexTurn {
  readonly model: string;
  readonly input: number;
  readonly output: number;
  readonly at: string;
  /** When set, a token_count line with this reading follows the turn's usage record. */
  readonly limit?: CodexLimit;
}

/**
 * One rollout: session_meta, then per turn a turn_context and a
 * token_usage_record (plus a token_count line with rate_limits when the turn
 * has a `limit`; the parser skips token_count lines once records exist).
 */
export function codexRollout(id: string, cwd: string, turns: ReadonlyArray<CodexTurn>): string {
  const lines = [
    line({
      timestamp: turns[0]?.at ?? "2026-05-10T10:00:00Z",
      type: "session_meta",
      payload: { id, session_id: id, cwd, cli_version: "0.160.0" },
    }),
  ];
  turns.forEach((t, i) => {
    lines.push(line({ timestamp: t.at, type: "turn_context", payload: { turn_id: `${id}-u${i}`, model: t.model } }));
    lines.push(
      line({
        timestamp: t.at,
        type: "token_usage_record",
        payload: {
          turn_id: `${id}-u${i}`,
          response_id: `${id}-r${i}`,
          usage: {
            input_tokens: t.input,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: t.output,
            reasoning_output_tokens: 0,
            total_tokens: t.input + t.output,
          },
        },
      }),
    );
    if (t.limit) {
      lines.push(
        line({
          timestamp: t.at,
          type: "event_msg",
          payload: {
            type: "token_count",
            info: null,
            rate_limits: {
              limit_id: "codex",
              limit_name: null,
              plan_type: t.limit.planType ?? "plus",
              primary: {
                used_percent: t.limit.usedPercent,
                window_minutes: t.limit.windowMinutes,
                resets_at: Date.parse(t.limit.resetsAt) / 1000,
              },
              secondary: null,
              credits: null,
            },
          },
        }),
      );
    }
  });
  return lines.join("\n");
}

/** Writes a rollout under the default CODEX_HOME for homeDir /home/u, dated by its first turn. */
export function addCodexRollout(
  fs: InMemoryFs,
  id: string,
  turns: ReadonlyArray<CodexTurn>,
  cwd = "C:\\p",
): void {
  const at = turns[0]?.at ?? "2026-05-10T10:00:00Z";
  const day = at.slice(0, 10).replace(/-/g, "/");
  fs.writeFile(
    `${CODEX_SESSIONS}/${day}/rollout-${at.slice(0, 19).replace(/:/g, "-")}-${id}.jsonl`,
    codexRollout(id, cwd, turns),
    Date.parse(at) + 60_000,
  );
}

export const solTurn = (at: string, input = 1000, output = 100): CodexTurn => ({
  model: "gpt-6.1-sol",
  input,
  output,
  at,
});

export const autoReviewTurn = (at: string, input = 20_000, output = 503): CodexTurn => ({
  model: "codex-auto-review",
  input,
  output,
  at,
});

// ---------------------------------------------------------------------------
// Usage-limit scenarios (limits, today, MCP get_codex_limits)
// ---------------------------------------------------------------------------

export const LIMITS_SESSION_A = "0199a1b2-c3d4-7a11-8000-00000000000a";
export const LIMITS_SESSION_B = "0199a0f7-11aa-7b02-8000-00000000000b";
export const LIMITS_REVIEW = "0199a0f7-11aa-7b03-8000-00000000000c";
export const LIMITS_SHRINK_SESSION = "0199a000-0000-7000-8000-000000000001";

const weekly = (usedPercent: number, resetsAt = "2026-10-14T08:30:00.000Z"): CodexLimit => ({
  usedPercent,
  windowMinutes: 10080,
  resetsAt,
});

const bigTurn = (at: string, usedPercent: number): CodexTurn => ({
  model: "gpt-5.4",
  input: 1_500_000,
  output: 50_000,
  at,
  limit: weekly(usedPercent),
});

/**
 * One weekly period (reset 2026-10-14T08:30Z, started 2026-10-07T08:30Z), 62%
 * used by 2026-10-09T08:00Z: session A in C:\work\sipcode raised it 10 + 20,
 * a codex-auto-review thread 5, session B in /home/u/my-app 5 + 22.
 */
export function addWeeklyLimitScenario(fs: InMemoryFs, opts: { readonly readings?: boolean } = {}): void {
  // readings: false writes the same requests without their limit readings.
  const keep = (turns: CodexTurn[]): CodexTurn[] =>
    opts.readings === false ? turns.map((t) => ({ model: t.model, input: t.input, output: t.output, at: t.at })) : turns;
  addCodexRollout(
    fs,
    LIMITS_SESSION_A,
    keep([bigTurn("2026-10-07T10:00:00.000Z", 10), bigTurn("2026-10-08T10:00:00.000Z", 30)]),
    "C:\\work\\sipcode",
  );
  addCodexRollout(
    fs,
    LIMITS_REVIEW,
    keep([{ ...autoReviewTurn("2026-10-08T15:00:00.000Z"), limit: weekly(35) }]),
    "C:\\work\\sipcode",
  );
  addCodexRollout(
    fs,
    LIMITS_SESSION_B,
    keep([bigTurn("2026-10-08T20:00:00.000Z", 40), bigTurn("2026-10-09T08:00:00.000Z", 62)]),
    "/home/u/my-app",
  );
}

/**
 * Four weekly periods of one gpt-5.4 session: three finished ones at 400K,
 * 400K and 100K tokens per 1% (a possible cut on Sep 15, 4.0x), then the
 * current one at 10% (reading 2026-10-08T00:00Z, reset 2026-10-13T00:00Z).
 */
export function addShrinkScenario(fs: InMemoryFs): void {
  const turn = (at: string, input: number, usedPercent: number, resetsAt: string): CodexTurn => ({
    model: "gpt-5.4",
    input,
    output: 0,
    at,
    limit: weekly(usedPercent, resetsAt),
  });
  addCodexRollout(
    fs,
    LIMITS_SHRINK_SESSION,
    [
      turn("2026-09-01T01:00:00.000Z", 20_000_000, 50, "2026-09-08T00:00:00.000Z"),
      turn("2026-09-08T01:00:00.000Z", 20_000_000, 50, "2026-09-15T00:00:00.000Z"),
      turn("2026-09-15T01:00:00.000Z", 5_000_000, 50, "2026-09-22T00:00:00.000Z"),
      turn("2026-10-08T00:00:00.000Z", 1_000_000, 10, "2026-10-13T00:00:00.000Z"),
    ],
    "/home/u/proj",
  );
}
