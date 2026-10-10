/** Codex rollout builders shared by the period-command integration tests. */
import type { InMemoryFs } from "../../src/lib/fs.js";

export const CODEX_SESSIONS = "/home/u/.codex/sessions";

const line = (o: unknown): string => JSON.stringify(o);

export interface CodexTurn {
  readonly model: string;
  readonly input: number;
  readonly output: number;
  readonly at: string;
}

/** One rollout: session_meta, then per turn a turn_context and a token_usage_record. */
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
