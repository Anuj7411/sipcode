/**
 * The session a single-session command (why / receipt / drift) reports on:
 * the newest non-empty session across the shown agents, or the one an
 * explicit `--session <prefix>` names, plus each other agent's newest
 * session for a one-line hint.
 *
 * Rules:
 *   - Subagent threads (Codex helper threads) are never auto-picked; an
 *     explicit `--session` may still name one.
 *   - Empty sessions are skipped when auto-picking (unless `skipEmpty: false`);
 *     when every session is empty, the newest one is shown so the command
 *     always has something to report.
 *   - `--here` scopes the auto-pick only. An explicit `--session` searches all
 *     of an agent's sessions, as Claude Code's lookup always has.
 *   - Inside one agent, a prefix matching several sessions picks the newest
 *     (unchanged). Matches in more than one agent are flagged `ambiguous`.
 */
import { issue, type SipcodeIssue } from "../../lib/errors.js";
import { MESSAGES } from "../../lib/messages.js";
import { loadPricingForDate, type PriceProvider } from "../../lib/pricing/load.js";
import { analyzeTokens, isEmptySession } from "../transcript/analyzers/tokens.js";
import { discoverAgentSessions, dropCopiedRequests } from "./loadSessions.js";
import type { ParsedSession, SessionMeta } from "./shared.js";
import type { Agent, AgentDeps } from "./types.js";

export interface PickedSession {
  readonly agent: Agent;
  readonly meta: SessionMeta;
  readonly parsed: ParsedSession;
}

export interface PickResult {
  readonly chosen: PickedSession;
  /** Auto-pick: each other agent's newest non-empty session. Prefix: the other agents' matches. */
  readonly others: PickedSession[];
  /** A `--session` prefix matched sessions in more than one agent: `chosen` + `others` are the matches. */
  readonly ambiguous: boolean;
}

/** One agent's discovered sessions, newest first. */
export interface AgentSessions {
  readonly agent: Agent;
  readonly all: SessionMeta[];
  /** `all` filtered by `--here` (equal to `all` without it). */
  readonly scoped: SessionMeta[];
}

export async function listAgentSessions(i: {
  agents: ReadonlyArray<Agent>;
  deps: AgentDeps;
  cwd: string;
  here?: boolean | undefined;
}): Promise<AgentSessions[]> {
  const out: AgentSessions[] = [];
  for (const agent of i.agents) {
    const d = await discoverAgentSessions(agent, i.deps);
    const all = d.ok ? d.value.sessions : [];
    out.push({
      agent,
      all,
      scoped: i.here ? all.filter((m) => agent.matchesCwd(m, i.cwd)) : all,
    });
  }
  return out;
}

export interface PickOptions {
  readonly sessionIdPrefix?: string | undefined;
  /** Skip sessions with no token usage when auto-picking. Default true. */
  readonly skipEmpty?: boolean | undefined;
  /**
   * Return each pick with only its own requests (ownRequestsOnly). Auto-pick
   * then also skips a session whose every request was copied from another
   * file (resumed, nothing new logged yet), as it skips an empty one.
   */
  readonly ownRequests?: boolean | undefined;
}

export async function pickFrom(
  lists: ReadonlyArray<AgentSessions>,
  deps: AgentDeps,
  opts: PickOptions,
): Promise<PickResult | undefined> {
  const prefix = opts.sessionIdPrefix;
  const skipEmpty = opts.skipEmpty ?? true;
  const picked: PickedSession[] = [];
  const fallbacks: PickedSession[] = [];
  for (const { agent, all, scoped } of lists) {
    const metas = prefix ? all.filter((m) => m.sessionId.startsWith(prefix)) : scoped;
    let fallback: PickedSession | undefined;
    for (const meta of metas) {
      let content: string;
      try {
        content = await deps.fs.readFile(meta.filePath);
      } catch {
        continue;
      }
      const p = agent.parseTranscript(content);
      if (!p.ok) continue;
      let candidate: PickedSession = { agent, meta, parsed: p.value };
      if (!prefix) {
        // Helper threads (Codex subagents, auto-review) are never "your latest session".
        if (p.value.isSubagent) continue;
        const rawEmpty = isEmpty(p.value, deps);
        if (skipEmpty && rawEmpty) {
          fallback ??= candidate;
          continue;
        }
        if (opts.ownRequests) {
          candidate = { ...candidate, parsed: await ownRequestsOnly({ ...candidate, deps, lists }) };
          if (!rawEmpty && isEmpty(candidate.parsed, deps)) {
            fallback ??= candidate;
            continue;
          }
        }
      } else if (opts.ownRequests) {
        candidate = { ...candidate, parsed: await ownRequestsOnly({ ...candidate, deps, lists }) };
      }
      picked.push(candidate);
      break; // metas are newest-first
    }
    if (fallback) fallbacks.push(fallback);
  }
  const byNewest = (a: PickedSession, b: PickedSession): number => b.meta.mtimeMs - a.meta.mtimeMs;
  if (picked.length === 0) {
    // Every session is empty: show the newest so there is always a report.
    const newest = fallbacks.sort(byNewest)[0];
    return newest ? { chosen: newest, others: [], ambiguous: false } : undefined;
  }
  picked.sort(byNewest);
  return {
    chosen: picked[0]!,
    others: picked.slice(1),
    ambiguous: prefix !== undefined && picked.length > 1,
  };
}

function isEmpty(session: ParsedSession, deps: AgentDeps): boolean {
  const date = session.startedAt ? new Date(session.startedAt) : deps.clock.now();
  return isEmptySession(analyzeTokens(session, loadPricingForDate(date)));
}

export async function pickLatestSession(i: {
  agents: ReadonlyArray<Agent>;
  deps: AgentDeps;
  cwd: string;
  here?: boolean | undefined;
  sessionIdPrefix?: string | undefined;
  skipEmpty?: boolean | undefined;
}): Promise<PickResult | undefined> {
  return pickFrom(await listAgentSessions(i), i.deps, i);
}

/**
 * The chosen session's own requests: those a resumed Claude Code session or
 * a Codex fork copied from another file are dropped (dropCopiedRequests), so
 * why / receipt count what the period commands count.
 */
export async function ownRequestsOnly(i: {
  agent: Agent;
  deps: AgentDeps;
  meta: SessionMeta;
  parsed: ParsedSession;
  lists: ReadonlyArray<AgentSessions>;
}): Promise<ParsedSession> {
  const all = i.lists.find((l) => l.agent === i.agent)?.all ?? [];
  const r = await dropCopiedRequests({
    agent: i.agent,
    deps: i.deps,
    targets: [{ meta: i.meta, parsed: i.parsed }],
    all,
  });
  return r.sessions[0]!;
}

/** With --here, the suggested command keeps it (without it, --agent picks the newest anywhere). */
export function otherAgentHint(o: Pick<PickedSession, "agent" | "meta">, here = false): string {
  return `${o.agent.displayName} also has a recent session (${o.meta.sessionId.slice(0, 8)}): run with --agent ${o.agent.id}${here ? " --here" : ""}.`;
}

/** Whose prices a session is costed with (and whose table date to show). */
export function priceProvider(agent: Agent): PriceProvider {
  return agent.id === "codex" ? "openai" : "anthropic";
}

/**
 * Parser warnings for a non-Claude session: the lines the parser skipped.
 * (Claude Code sessions use parseTranscriptVerbose, which lists each line.)
 */
export function parseIssues(session: ParsedSession): SipcodeIssue[] {
  const n = session.linesSkipped;
  return n > 0 ? [issue("E003", `${n} line(s) could not be read (skipped).`)] : [];
}

/**
 * The error a single-session command prints when it has no session to show:
 * an ambiguous or unknown --session, or nothing in scope. Claude Code alone
 * keeps its original messages. `undefined` when `picked` is usable.
 */
export function sessionPickError(i: {
  command: string;
  picked: PickResult | undefined;
  agents: ReadonlyArray<Agent>;
  sessionIdPrefix: string | undefined;
  here: boolean;
  projectsDir: string;
}): string | undefined {
  const claudeOnly = i.agents.length === 1 && i.agents[0]!.id === "claude-code";
  const names = i.agents.map((a) => a.displayName);
  if (i.picked?.ambiguous) {
    const matches = [i.picked.chosen, ...i.picked.others].map((p) => ({
      agentId: p.agent.id,
      agentName: p.agent.displayName,
      sessionId: p.meta.sessionId,
    }));
    return MESSAGES.sessionAmbiguous(i.command, i.sessionIdPrefix ?? "", matches);
  }
  if (i.picked) return undefined;
  if (i.sessionIdPrefix) {
    return MESSAGES.sessionNotFound(i.sessionIdPrefix, claudeOnly ? undefined : names);
  }
  return claudeOnly
    ? MESSAGES.noSessionsFound(i.projectsDir)
    : MESSAGES.noAgentSessions(i.command, names, i.here);
}
