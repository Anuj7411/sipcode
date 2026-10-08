/**
 * Which agents a command shows: the Claude Code / Cursor pick from
 * `detectAgent` (unchanged), plus a Codex section when Codex is installed.
 * Terminal output gets one section per agent; JSON stays one agent per call.
 */
import type { Clock } from "../../lib/clock.js";
import type { FileSystem } from "../../lib/fs.js";
import { formatNum, formatTokensShort } from "../../lib/format.js";
import { MESSAGES } from "../../lib/messages.js";
import type { ProcessEnv } from "../../lib/process.js";
import { resolveProjectsDir } from "../transcript/discover.js";
import { parseAgentFlag } from "./cli.js";
import { detectAgent, type AgentDetectResult } from "./detect.js";
import { getAgentById } from "./registry.js";
import type { Agent, AgentId } from "./types.js";

export type DisplayAgents =
  | { ok: true; agents: Agent[]; detect: AgentDetectResult }
  | { ok: false; exitCode: 1 };

export interface DisplayAgentsInput {
  readonly agent: string | undefined;
  readonly fs: FileSystem;
  readonly env: ProcessEnv;
  readonly clock: Clock;
  readonly cwd: string;
  readonly json: boolean;
  readonly stderr: (s: string) => void;
}

export async function resolveDisplayAgents(i: DisplayAgentsInput): Promise<DisplayAgents> {
  const parsed = parseAgentFlag(i.agent);
  if (!parsed.ok) {
    i.stderr(parsed.message);
    return { ok: false, exitCode: 1 };
  }
  const detect = await detectAgent({ selector: parsed.selector, fs: i.fs, env: i.env, cwd: i.cwd });
  if (detect.explicit) return { ok: true, agents: [getAgentById(detect.agent)], detect };

  const codex = getAgentById("codex");
  const codexInstalled = await codex.isInstalled({ fs: i.fs, env: i.env, clock: i.clock }, i.cwd);
  let ids: AgentId[];
  if (detect.agent === "claude-code") {
    // A Claude Code pick without a transcripts folder has nothing to show.
    const claudeHasLogs = await i.fs.exists(resolveProjectsDir(i.env));
    if (claudeHasLogs) ids = codexInstalled ? ["claude-code", "codex"] : ["claude-code"];
    else ids = codexInstalled ? ["codex"] : ["claude-code"];
  } else {
    ids = codexInstalled && detect.agent !== "codex" ? [detect.agent, "codex"] : [detect.agent];
  }

  if (i.json && ids.length > 1) {
    const first = getAgentById(ids[0]!);
    i.stderr(
      `note: Codex logs found too. JSON covers ${first.displayName}; run with --agent codex for Codex.`,
    );
    ids = [ids[0]!];
  }
  return { ok: true, agents: ids.map(getAgentById), detect };
}

export function sectionHeader(displayName: string): string {
  return `── ${displayName} ──`;
}

export interface CombinedPart {
  readonly tokens: number;
  readonly usd: number;
  /** The part's cost leaves out tokens on models with no known price. */
  readonly unpriced?: boolean;
}

function approxUSD(n: number): string {
  return n >= 1 ? `~$${formatNum(Math.round(n))}` : `~$${n.toFixed(2)}`;
}

/** `Both tools: 13.1B tokens · ~$10,888 + ~$412`; dollars only when no tokens are given. */
export function combinedLine(parts: ReadonlyArray<CombinedPart>): string {
  const tokens = parts.reduce((n, p) => n + p.tokens, 0);
  const usd = parts
    .map((p) => `${approxUSD(p.usd)}${p.unpriced ? " (+ unpriced)" : ""}`)
    .join(" + ");
  return tokens > 0
    ? `Both tools: ${formatTokensShort(tokens)} tokens · ${usd}`
    : `Both tools: ${usd}`;
}

/** One line a section wants printed, in order. */
export interface SectionWrite {
  readonly stream: "stdout" | "stderr";
  readonly text: string;
}

/** What one agent's part of a command produced. */
export interface SectionResult {
  readonly exitCode: 0 | 1;
  readonly writes: readonly SectionWrite[];
  /**
   * No sessions in the window. Alone, the command keeps its usual exit code and
   * stderr message; next to another section, the message is printed inside the
   * section and the command does not fail.
   */
  readonly emptyWindow?: boolean;
  /** Totals for the combined line (stats / today / forecast). */
  readonly totals?: CombinedPart;
}

/** Collects a section's output in order instead of printing it. */
export class SectionOutput {
  readonly writes: SectionWrite[] = [];
  readonly out = (text: string): void => {
    this.writes.push({ stream: "stdout", text });
  };
  readonly err = (text: string): void => {
    this.writes.push({ stream: "stderr", text });
  };
  result(exitCode: 0 | 1, extra: { emptyWindow?: boolean; totals?: CombinedPart } = {}): SectionResult {
    return { exitCode, writes: this.writes, ...extra };
  }
}

export interface RunSectionsInput {
  readonly agents: readonly Agent[];
  readonly detect: AgentDetectResult;
  /** Print the "detected agent: … (auto)" banner when one agent is shown (stats, impact). */
  readonly banner: boolean;
  /** End with the `Both tools:` line (stats, today, forecast). */
  readonly combined: boolean;
  readonly stdout: (s: string) => void;
  readonly stderr: (s: string) => void;
  readonly run: (agent: Agent, index: number) => Promise<SectionResult>;
}

/**
 * One agent: exactly the command's single-agent output. Several: a header per
 * agent, each section's output, then the combined line. The exit code is 1 only
 * for a real error, never for a section that merely had nothing in the window.
 */
export async function runSections(i: RunSectionsInput): Promise<0 | 1> {
  if (i.agents.length === 1) {
    const agent = i.agents[0]!;
    if (i.banner && !i.detect.explicit) {
      i.stdout(MESSAGES.agentDetectedAuto(agent.id));
      if (i.detect.ambiguous && agent.id === i.detect.agent) i.stdout(MESSAGES.agentAmbiguous());
    }
    const r = await i.run(agent, 0);
    for (const w of r.writes) (w.stream === "stdout" ? i.stdout : i.stderr)(w.text);
    return r.exitCode;
  }
  const totals: CombinedPart[] = [];
  let exitCode: 0 | 1 = 0;
  for (const [index, agent] of i.agents.entries()) {
    i.stdout(sectionHeader(agent.displayName));
    const r = await i.run(agent, index);
    for (const w of r.writes) {
      if (w.stream === "stdout" || r.emptyWindow) i.stdout(w.text);
      else i.stderr(w.text === "" ? "" : `${agent.displayName}: ${w.text}`);
    }
    if (r.totals) totals.push(r.totals);
    if (!r.emptyWindow && r.exitCode === 1) exitCode = 1;
    i.stdout("");
  }
  if (i.combined && totals.length > 1) i.stdout(combinedLine(totals));
  return exitCode;
}
