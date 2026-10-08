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
import { loadPricingForDate } from "../../lib/pricing/load.js";
import { analyzeTokens, isEmptySession } from "../transcript/analyzers/tokens.js";
import { discoverAgentSessions } from "./loadSessions.js";
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
      const candidate = { agent, meta, parsed: p.value };
      if (!prefix) {
        // Helper threads (Codex subagents, auto-review) are never "your latest session".
        if (p.value.isSubagent) continue;
        if (skipEmpty) {
          const date = p.value.startedAt ? new Date(p.value.startedAt) : deps.clock.now();
          if (isEmptySession(analyzeTokens(p.value, loadPricingForDate(date)))) {
            fallback ??= candidate;
            continue;
          }
        }
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

export function otherAgentHint(o: PickedSession): string {
  return `${o.agent.displayName} also has a recent session (${o.meta.sessionId.slice(0, 8)}): run with --agent ${o.agent.id}.`;
}
