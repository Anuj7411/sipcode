/**
 * Synthetic Claude Code transcripts and Codex rollouts for `sipcode regress`,
 * ported from the prototype's ground truth (prototypes/regress/make-fixtures.mjs
 * on the regress-prototype branch). The dirty set reproduces the published
 * signatures of the confirmed regressions R1 to R5 plus a Codex version that
 * drains its limit 10x faster per token; the clean set has the same healthy
 * versions and must produce zero findings.
 *
 * Codex is laid out for Sipcode's account-wide limit model (the prototype
 * compared per-file deltas): each version runs in its own weekly period, one
 * after the other, and its readings rise with its own requests.
 */
import type { InMemoryFs } from "../../src/lib/fs.js";

export const HOME = "/home/u";
export const CLAUDE_PROJECT = `${HOME}/.claude/projects/C--demo`;
export const CODEX_DAY_DIR = `${HOME}/.codex/sessions/2026/06/20`;

const T0 = Date.parse("2026-03-01T09:00:00Z");
const DAY = 86_400_000;

/** One request: minutes since the previous one, uncached input, cache read / 5m write / 1h write, output, after a tool result. */
export interface Turn {
  readonly gap?: number;
  readonly inp?: number;
  readonly cr: number;
  readonly c5?: number;
  readonly c1?: number;
  readonly out?: number;
  readonly tool?: boolean;
}

export interface SessionOpts {
  readonly side?: boolean;
  readonly start?: number;
  readonly entrypoint?: string;
}

let reqN = 0;

/** The JSONL text of one Claude Code session: a user line, then the assistant line, per turn. */
export function claudeSessionText(sid: string, version: string, model: string, turns: readonly Turn[], opts: SessionOpts = {}): string {
  const lines: string[] = [];
  let t = opts.start ?? T0;
  for (const x of turns) {
    t += (x.gap ?? 1) * 60_000;
    lines.push(
      JSON.stringify({
        type: "user",
        sessionId: sid,
        version,
        timestamp: new Date(t - 1000).toISOString(),
        message: { role: "user", content: x.tool ? [{ type: "tool_result", tool_use_id: "t", content: "ok" }] : "next" },
      }),
    );
    reqN++;
    lines.push(
      JSON.stringify({
        type: "assistant",
        sessionId: sid,
        version,
        ...(opts.entrypoint ? { entrypoint: opts.entrypoint } : {}),
        isSidechain: opts.side ?? false,
        requestId: `req_${reqN}`,
        timestamp: new Date(t).toISOString(),
        message: {
          id: `msg_${reqN}`,
          model,
          role: "assistant",
          content: [{ type: "text", text: "." }],
          usage: {
            input_tokens: x.inp ?? 3,
            output_tokens: x.out ?? 400,
            cache_read_input_tokens: x.cr,
            cache_creation_input_tokens: (x.c5 ?? 0) + (x.c1 ?? 0),
            cache_creation: { ephemeral_5m_input_tokens: x.c5 ?? 0, ephemeral_1h_input_tokens: x.c1 ?? 0 },
          },
        },
      }),
    );
  }
  return lines.join("\n") + "\n";
}

export function addClaudeSession(
  fs: InMemoryFs,
  sid: string,
  version: string,
  model: string,
  turns: readonly Turn[],
  opts: SessionOpts = {},
): void {
  const minutes = turns.reduce((a, x) => a + (x.gap ?? 1), 0);
  fs.writeFile(`${CLAUDE_PROJECT}/${sid}.jsonl`, claudeSessionText(sid, version, model, turns, opts), (opts.start ?? T0) + minutes * 60_000);
}

/** Healthy growth: each turn reads the previous context from cache and writes the small delta. */
export function healthy(
  n: number,
  o: { base?: number; step?: number; ttl?: "1h" | "5m"; inp?: number; tool?: boolean; idleAt?: readonly number[] } = {},
): Turn[] {
  const { base = 40e3, step = 3e3, ttl = "1h", inp = 3, tool = true, idleAt = [] } = o;
  const out: Turn[] = [];
  let ctx = base;
  for (let i = 0; i < n; i++) {
    const idle = idleAt.includes(i);
    const write = i === 0 || idle ? ctx : step; // first turn / after idle: one cold turn (expected)
    const read = i === 0 || idle ? 0 : ctx - step;
    out.push({ gap: idle ? 75 : 1, inp, cr: read, ...(ttl === "1h" ? { c1: write } : { c5: write }), tool });
    ctx += step;
  }
  return out;
}

export const HEALTHY_VERSIONS = ["2.1.60", "2.1.95", "2.1.140", "2.1.200", "2.1.250", "2.1.262"] as const;

export function addClaudeDataset(fs: InMemoryFs, { dirty }: { readonly dirty: boolean }): void {
  let s = 0;
  const sid = (): string => `sess${String(++s).padStart(4, "0")}-0000-4000-8000-000000000000`;
  HEALTHY_VERSIONS.forEach((v, k) => {
    for (let j = 0; j < 3; j++) {
      addClaudeSession(fs, sid(), v, "claude-opus-4-8", healthy(30, { idleAt: [15] }), { start: T0 + (k * 10 + j) * DAY, entrypoint: "cli" });
    }
    addClaudeSession(fs, sid(), v, "claude-fable-5-1", healthy(25, { inp: 5 }), { start: T0 + (k * 10 + 5) * DAY, entrypoint: "cli" });
  });
  // Agent SDK and subagent runs with the 5-minute TTL: different cache policy by design, never compared.
  addClaudeSession(fs, sid(), "2.1.201", "claude-opus-4-8", healthy(30, { ttl: "5m" }), { start: T0 + 31 * DAY, entrypoint: "sdk-ts" });
  addClaudeSession(fs, sid(), "2.1.201", "claude-opus-4-8", healthy(30, { ttl: "5m" }), { start: T0 + 32 * DAY, side: true });
  if (!dirty) return;
  // R2 2.1.76: back-to-back turns, cache_read stuck at the system-prompt size, whole conversation re-written (#34629 rows).
  for (let j = 0; j < 3; j++) {
    const turns: Turn[] = [];
    let conv = 40e3;
    for (let i = 0; i < 25; i++) {
      turns.push({ gap: 1, cr: 14569, c1: conv, tool: true });
      conv += 1500;
    }
    addClaudeSession(fs, sid(), "2.1.76", "claude-opus-4-6", turns, { start: T0 + (70 + j) * DAY });
  }
  // R3 2.1.90: after an idle gap > 60 min, the following turns stay cold.
  for (let j = 0; j < 8; j++) {
    const turns = healthy(10);
    let ctx = 40e3 + 10 * 3e3;
    for (let i = 0; i < 4; i++) {
      turns.push({ gap: i === 0 ? 70 : 1, cr: 0, c1: ctx, tool: true });
      ctx += 3e3;
    }
    addClaudeSession(fs, sid(), "2.1.90", "claude-opus-4-6", turns, { start: T0 + (80 + j) * DAY });
  }
  // R4 2.1.100 and 2.1.105: main-chain cache writes at the 5-minute TTL (#46829 daily shares).
  for (const v of ["2.1.100", "2.1.105"]) {
    for (let j = 0; j < 2; j++) addClaudeSession(fs, sid(), v, "claude-opus-4-6", healthy(30, { ttl: "5m" }), { start: T0 + (90 + j) * DAY });
  }
  // R1 fable-5-1 at 2.1.258: context after tool results re-sent uncached on every tool-call turn.
  for (let j = 0; j < 2; j++) {
    addClaudeSession(fs, sid(), "2.1.258", "claude-fable-5-1", healthy(25, { inp: 3200 }), { start: T0 + (180 + j) * DAY });
  }
  // R5 2.1.240: full rebuild about every 60 minutes in long sessions with back-to-back turns.
  for (let j = 0; j < 2; j++) {
    const turns: Turn[] = [];
    let ctx = 80e3;
    for (let i = 0; i < 240; i++) {
      const rebuild = i > 0 && i % 60 === 0;
      turns.push({ gap: 1, cr: rebuild ? 9e3 : ctx - 400, c1: rebuild ? ctx - 9e3 : 400, tool: true });
      ctx += 400;
    }
    addClaudeSession(fs, sid(), "2.1.240", "claude-opus-4-8", turns, { start: T0 + (170 + j) * DAY });
  }
}

const WEEK = 7 * DAY;
const CODEX_W0 = Date.parse("2026-06-01T00:00:00Z");

/**
 * One Codex rollout of `turns` requests in week `week` (its own weekly
 * period). Each request: 120,000 input of which 105,000 cached, 5,000 output
 * (20,000 uncached + output tokens). The reading after it rises by `pctPerM`
 * percent per 1M of those tokens, in whole percent like Codex reports.
 */
export function codexRolloutText(
  id: string,
  version: string,
  week: number,
  pctPerM: number,
  o: { turns?: number; model?: string; plan?: string; windowMinutes?: number } = {},
): string {
  const { turns = 150, model = "gpt-5.5", plan = "plus", windowMinutes = 10_080 } = o;
  const start = CODEX_W0 + week * WEEK;
  const resetsAt = (start + windowMinutes * 60_000) / 1000;
  const lines = [
    JSON.stringify({ timestamp: new Date(start + 3_600_000).toISOString(), type: "session_meta", payload: { id, session_id: id, cwd: "/home/u/proj", cli_version: version } }),
  ];
  for (let i = 0; i < turns; i++) {
    const at = new Date(start + 3_600_000 + (i + 1) * 60_000).toISOString();
    lines.push(JSON.stringify({ timestamp: at, type: "turn_context", payload: { turn_id: `${id}-u${i}`, model } }));
    lines.push(
      JSON.stringify({
        timestamp: at,
        type: "token_usage_record",
        payload: {
          turn_id: `${id}-u${i}`,
          response_id: `${id}-r${i}`,
          usage: { input_tokens: 120_000, cached_input_tokens: 105_000, cache_write_input_tokens: 0, output_tokens: 5_000, reasoning_output_tokens: 0, total_tokens: 125_000 },
        },
      }),
    );
    const used = Math.floor(((i + 1) * 20_000 * pctPerM) / 1e6 + 1e-9);
    lines.push(
      JSON.stringify({
        timestamp: at,
        type: "event_msg",
        payload: {
          type: "token_count",
          info: null,
          rate_limits: { limit_id: "codex", plan_type: plan, primary: { used_percent: used, window_minutes: windowMinutes, resets_at: resetsAt }, secondary: null },
        },
      }),
    );
  }
  return lines.join("\n") + "\n";
}

export function addCodexRollout(fs: InMemoryFs, id: string, version: string, week: number, pctPerM: number, o: Parameters<typeof codexRolloutText>[4] = {}): void {
  const turns = o.turns ?? 150;
  fs.writeFile(`${CODEX_DAY_DIR}/rollout-w${week}-${id}.jsonl`, codexRolloutText(id, version, week, pctPerM, o), CODEX_W0 + week * WEEK + (turns + 70) * 60_000);
}

export function addCodexDataset(fs: InMemoryFs, { dirty }: { readonly dirty: boolean }): void {
  addCodexRollout(fs, "0199a000-0000-7000-8000-00000000000a", "0.140.0", 0, 2);
  addCodexRollout(fs, "0199a000-0000-7000-8000-00000000000b", "0.141.0", 1, 2.2);
  addCodexRollout(fs, "0199a000-0000-7000-8000-00000000000c", "0.142.0", 2, dirty ? 25 : 2.1);
}
