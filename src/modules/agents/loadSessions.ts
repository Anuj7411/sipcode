/**
 * Shared session loading for every period command and every agent:
 * discover → --here → read → parse → cross-file dedupe (commands window afterwards).
 * Unreadable files are counted, never silently dropped.
 */
import { ok, type Result } from "../../lib/result.js";
import type { SipcodeIssue } from "../../lib/errors.js";
import { dedupeAcrossSessions } from "../transcript/dedupe.js";
import type { ParsedSession, SessionMeta } from "./shared.js";
import type { Agent, AgentDeps } from "./types.js";

export interface LoadedSession {
  readonly meta: SessionMeta;
  readonly parsed: ParsedSession;
}

export interface LoadSessionsInput {
  readonly agent: Agent;
  readonly deps: AgentDeps;
  readonly cwd: string;
  readonly here?: boolean | undefined;
}

export interface LoadSessionsOutput {
  readonly sessions: LoadedSession[];
  /** Files discovered before any filtering (tells a brand-new user from an empty window). */
  readonly discovered: number;
  readonly unreadable: number;
  readonly droppedDuplicateRequests: number;
  readonly issues: SipcodeIssue[];
}

export async function loadSessions(
  input: LoadSessionsInput,
): Promise<Result<LoadSessionsOutput, SipcodeIssue[]>> {
  const { agent, deps, cwd } = input;
  const discovery = await agent.discoverSessions(deps);
  if (!discovery.ok) return discovery;
  let metas = discovery.value;
  const discovered = metas.length;
  // --here before dedupe is safe: a resumed session stays in its project.
  // No time pre-filter: an old original must still remove its copies from a
  // newer resumed file. Commands apply their window after loading.
  if (input.here) metas = metas.filter((m) => agent.matchesCwd(m, cwd));
  const loaded: { meta: SessionMeta; parsed: ParsedSession }[] = [];
  const issues: SipcodeIssue[] = [];
  let unreadable = 0;
  for (const meta of metas) {
    let content: string;
    try {
      content = await deps.fs.readFile(meta.filePath);
    } catch {
      unreadable++;
      continue;
    }
    const parsed = agent.parseTranscript(content);
    if (!parsed.ok) {
      issues.push(...parsed.error);
      continue;
    }
    loaded.push({ meta, parsed: parsed.value });
  }
  const d = dedupeAcrossSessions(loaded.map((l) => l.parsed));
  return ok({
    sessions: loaded.map((l, i) => ({ meta: l.meta, parsed: d.sessions[i]! })),
    discovered,
    unreadable,
    droppedDuplicateRequests: d.droppedRequests,
    issues,
  });
}
