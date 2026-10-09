/**
 * Session loading for commands that only need token usage (today, forecast),
 * with a per-file cache so unchanged transcripts are not read again.
 *
 * Why: today / forecast derive "days of history" from the earliest session, so
 * they load every transcript. Fully parsing a 2.3 GB log folder took 30-45 s,
 * past the MCP tools' 10 s limit. What they read from a session is its token
 * usage; tool calls only for today's sessions (duplicate reads).
 *
 * A usage-only session is the full parse without tool calls: same turns
 * (request key, model, timestamp, every token count), same start / end /
 * duration, same turn count. Cross-file dedupe (dedupeAcrossSessions) reads
 * only those, so over usage-only and full sessions together it keeps, drops
 * and maxes exactly the requests it would over full parses, and analyzeTokens
 * gives the same totals. The sessions a caller needs tool calls for
 * (`needsToolCalls`, judged on the deduped session) are parsed in full and
 * deduped again; nothing else changes between the two passes.
 *
 * The cache (~/.sipcode/usage-cache/<agent>.json) holds the usage-only form of
 * each parsed file, keyed by its path, size and mtime: a file that changed is
 * parsed again. It is stored only when the text read has the size discovery
 * saw (a file growing mid-read is parsed again next time), and is ignored when
 * written by another Sipcode version. Errors reading or writing it never fail
 * the command: it is a speed-up only.
 */
import { promises as nodeFs, readFileSync } from "node:fs";
import path from "node:path";
import { RealFileSystem, type FileSystem } from "../../lib/fs.js";
import type { ProcessEnv } from "../../lib/process.js";
import { ok, type Result } from "../../lib/result.js";
import type { SipcodeIssue } from "../../lib/errors.js";
import { dedupeAcrossSessions } from "../transcript/dedupe.js";
import type { AssistantTurn } from "../transcript/parse.js";
import { discoverAgentSessions, type LoadedSession, type LoadSessionsOutput } from "./loadSessions.js";
import type { ParsedSession, SessionMeta } from "./shared.js";
import type { Agent, AgentDeps, AgentId } from "./types.js";

/** Read / write one agent's cache file. */
export interface UsageCacheIO {
  /** The cache text, or null when there is none (or it cannot be read). */
  read(): Promise<string | null>;
  write(content: string): Promise<void>;
}

/** Where commands keep each agent's cache. */
export function usageCacheFile(homeDir: string, agentId: AgentId): string {
  return path.join(homeDir, ".sipcode", "usage-cache", `${agentId}.json`);
}

/** Each agent's cache, or null for none. */
export type UsageCaches = (agentId: AgentId) => UsageCacheIO | null;

/**
 * The commands' default: the cache under the home folder when reading the
 * real disk; none with an injected file system (tests), so nothing is written.
 */
export function defaultUsageCaches(fs: FileSystem, env: ProcessEnv): UsageCaches {
  return fs instanceof RealFileSystem
    ? (id) => fileUsageCacheIO(usageCacheFile(env.homeDir(), id))
    : () => null;
}

/** The cache on disk. Writes go to a temp file renamed into place. */
export function fileUsageCacheIO(file: string): UsageCacheIO {
  return {
    async read() {
      try {
        return await nodeFs.readFile(file, "utf-8");
      } catch {
        return null;
      }
    },
    async write(content) {
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        await nodeFs.mkdir(path.dirname(file), { recursive: true });
        await nodeFs.writeFile(tmp, content, "utf-8");
        await nodeFs.rename(tmp, file);
      } catch {
        await nodeFs.rm(tmp, { force: true }).catch(() => {});
      }
    },
  };
}

/**
 * Bump when parseTranscript (either agent) changes what a usage-only session
 * holds. The Sipcode version is part of the key too, so every release starts
 * a fresh cache.
 */
const CACHE_SCHEMA = "sipcode-usage-cache/1";

let versionMemo: string | undefined;
function sipcodeVersion(): string {
  if (versionMemo === undefined) {
    try {
      // src/modules/agents and dist/modules/agents are both three levels below the package root.
      const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf-8")) as {
        version?: unknown;
      };
      versionMemo = typeof pkg.version === "string" ? pkg.version : "unknown";
    } catch {
      versionMemo = "unknown";
    }
  }
  return versionMemo;
}

type TurnJson = Omit<AssistantTurn, "toolCalls">;
type SessionJson = Omit<ParsedSession, "assistantTurns" | "toolCalls" | "models" | "priorReads"> & {
  readonly models: string[];
  readonly priorReads?: string[];
  readonly turns: TurnJson[];
};

interface CacheEntry {
  readonly mtimeMs: number;
  readonly size: number;
  readonly session: SessionJson;
}

interface CacheFile {
  readonly schema: string;
  readonly version: string;
  readonly entries: Record<string, CacheEntry>;
}

function toJson(s: ParsedSession): SessionJson {
  const { assistantTurns, toolCalls: _calls, models, priorReads, ...rest } = s;
  void _calls;
  return {
    ...rest,
    models: [...models],
    ...(priorReads ? { priorReads: [...priorReads] } : {}),
    turns: assistantTurns.map(({ toolCalls: _c, ...t }) => (void _c, t)),
  };
}

function fromJson(j: SessionJson): ParsedSession {
  const { turns, models, priorReads, ...rest } = j;
  return {
    ...rest,
    models: new Set(models),
    ...(priorReads ? { priorReads: new Set(priorReads) } : {}),
    assistantTurns: turns.map((t) => ({ ...t, toolCalls: [] })),
    toolCalls: [],
  };
}

/** A session without its tool calls (what the cache stores). */
export function usageOnly(s: ParsedSession): ParsedSession {
  return fromJson(toJson(s));
}

async function readCache(io: UsageCacheIO): Promise<Record<string, CacheEntry>> {
  const raw = await io.read();
  if (raw === null) return {};
  try {
    const c = JSON.parse(raw) as Partial<CacheFile>;
    if (c.schema !== CACHE_SCHEMA || c.version !== sipcodeVersion()) return {};
    return c.entries && typeof c.entries === "object" ? c.entries : {};
  } catch {
    return {};
  }
}

export interface LoadUsageSessionsInput {
  readonly agent: Agent;
  readonly deps: AgentDeps;
  readonly cwd: string;
  readonly here?: boolean | undefined;
  /** null: no cache, every file is parsed. */
  readonly cache: UsageCacheIO | null;
  /**
   * Sessions (after dedupe) whose tool calls the caller reads. They come back
   * fully parsed; every other session is usage-only (no tool calls).
   */
  readonly needsToolCalls?: ((s: LoadedSession) => boolean) | undefined;
  /**
   * For a file this run parses anyway: keep its full parse, as it will likely
   * pass needsToolCalls (saves reading it twice). Default: never.
   */
  readonly keepFull?: ((meta: SessionMeta) => boolean) | undefined;
}

interface Slot {
  readonly meta: SessionMeta;
  session: ParsedSession;
  full: boolean;
}

/**
 * Same sessions, order, dedupe and counters as loadSessions without a window,
 * except that sessions not picked by needsToolCalls have no tool calls, and a
 * file served from the cache is not read (so not counted unreadable).
 */
export async function loadUsageSessions(
  input: LoadUsageSessionsInput,
): Promise<Result<LoadSessionsOutput, SipcodeIssue[]>> {
  const { agent, deps, cwd } = input;
  const discovery = await discoverAgentSessions(agent, deps);
  if (!discovery.ok) return discovery;
  const found = discovery.value;
  let metas = found.sessions;
  // --here before dedupe is safe: a resumed session stays in its project.
  if (input.here) metas = metas.filter((m) => agent.matchesCwd(m, cwd));

  const cached = input.cache ? await readCache(input.cache) : {};
  const next: Record<string, CacheEntry> = {};
  let changed = false;
  // Entries of files this run does not look at (--here) stay while the file exists.
  const present = new Set(found.sessions.map((m) => m.filePath));
  for (const [file, e] of Object.entries(cached)) {
    if (present.has(file)) next[file] = e;
    else changed = true;
  }

  const issues: SipcodeIssue[] = [...found.issues];
  let unreadable = found.unreadable;
  const slots: Slot[] = [];
  for (const meta of metas) {
    const hit = cached[meta.filePath];
    if (hit && hit.mtimeMs === meta.mtimeMs && hit.size === meta.size) {
      let session: ParsedSession | undefined;
      try {
        session = fromJson(hit.session);
      } catch {
        // A damaged entry: parse the file instead.
      }
      if (session) {
        slots.push({ meta, session, full: false });
        continue;
      }
    }
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
    const json = toJson(parsed.value);
    if (input.cache && Buffer.byteLength(content, "utf8") === meta.size) {
      next[meta.filePath] = { mtimeMs: meta.mtimeMs, size: meta.size, session: json };
      changed = true;
    } else if (next[meta.filePath]) {
      delete next[meta.filePath];
      changed = true;
    }
    const full = input.keepFull?.(meta) ?? false;
    slots.push({ meta, session: full ? parsed.value : fromJson(json), full });
  }

  let d = dedupeAcrossSessions(slots.map((s) => s.session));
  const needs = input.needsToolCalls;
  if (needs) {
    let reparsed = false;
    for (const [i, slot] of slots.entries()) {
      if (slot.full || !needs({ meta: slot.meta, parsed: d.sessions[i]! })) continue;
      let content: string;
      try {
        content = await deps.fs.readFile(slot.meta.filePath);
      } catch {
        continue; // keep the usage-only session: totals stay right, no duplicate reads
      }
      const parsed = agent.parseTranscript(content);
      if (!parsed.ok) continue;
      slot.session = parsed.value;
      slot.full = true;
      reparsed = true;
    }
    if (reparsed) d = dedupeAcrossSessions(slots.map((s) => s.session));
  }

  if (input.cache && changed) {
    const file: CacheFile = { schema: CACHE_SCHEMA, version: sipcodeVersion(), entries: next };
    await input.cache.write(JSON.stringify(file));
  }

  return ok({
    sessions: slots.map((s, i) => ({ meta: s.meta, parsed: d.sessions[i]! })),
    discovered: found.sessions.length,
    unreadable,
    unreadableFolders: found.unreadableFolders,
    skippedCompressed: found.skippedCompressed,
    scannedOnly: 0,
    droppedDuplicateRequests: d.droppedRequests,
    issues,
  });
}
