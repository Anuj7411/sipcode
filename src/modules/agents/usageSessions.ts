/**
 * The usage cache: what a session holds without its tool calls, per
 * transcript file, so commands that only need token usage (today, forecast)
 * do not read unchanged transcripts again.
 *
 * Why: today / forecast derive "days of history" from the earliest session, so
 * they load every transcript. Fully parsing a 2.3 GB log folder took 30-45 s,
 * past the MCP tools' 10 s limit.
 *
 * A usage-only session is the full parse without tool calls: same turns
 * (request key, model, timestamp, every token count), same start / end /
 * duration, same turn count. Cross-file dedupe reads only those, so a cached
 * session dedupes exactly like a parsed one (loadSessions).
 *
 * The cache (~/.sipcode/usage-cache/<agent>.json) is JSON Lines: a header
 * line (schema + Sipcode version), then one line per transcript with its
 * path, size, mtime and usage-only session. Commands read it line by line and
 * write a new one beside it (renamed into place), so neither holds the whole
 * cache in memory. An entry is used only while its file's size and mtime are
 * unchanged, and is stored only when the text read has the size discovery saw
 * (a file growing mid-read is parsed again next time). A cache written by
 * another Sipcode version is ignored. Errors reading or writing it never fail
 * the command: it is a speed-up only.
 */
import { promises as nodeFs, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { RealFileSystem, type FileSystem } from "../../lib/fs.js";
import type { ProcessEnv } from "../../lib/process.js";
import type { AssistantTurn } from "../transcript/parse.js";
import type { ParsedSession } from "./shared.js";
import type { AgentId } from "./types.js";

/** Read / write one agent's cache file. */
export interface UsageCacheIO {
  /** The cache's lines in order; none when there is no cache. May throw mid-way (treated as the end). */
  lines(): AsyncIterable<string>;
  /** A new cache, filled line by line, that replaces the current one on commit. */
  writer(): UsageCacheWriter;
}

export interface UsageCacheWriter {
  add(line: string): Promise<void>;
  /** Replace the cache with the lines added. Never throws. */
  commit(): Promise<void>;
  /** Drop the lines added. Never throws. */
  discard(): Promise<void>;
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

/** Distinguishes temp files of writes in flight in one process (MCP tools run in parallel). */
let tmpSeq = 0;

/** Lines buffered before a write to the temp file. */
const FLUSH_CHARS = 1 << 20;

/** A temp file untouched this long was left by a killed writer (live ones write every 1 MB). */
const STALE_TMP_MS = 15 * 60 * 1000;

/**
 * Removes `<cache>.<pid>.<n>.tmp` files left beside the cache by a process
 * killed between writing and renaming. Only old ones: a recent one may be a
 * concurrent writer's. Errors are ignored (it is housekeeping).
 */
async function removeStaleTemps(file: string): Promise<void> {
  const dir = path.dirname(file);
  const base = path.basename(file);
  const own = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.\\d+\\.\\d+\\.tmp$`);
  let names: string[];
  try {
    names = await nodeFs.readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!own.test(name)) continue;
    const p = path.join(dir, name);
    try {
      const st = await nodeFs.stat(p);
      if (Date.now() - st.mtimeMs > STALE_TMP_MS) await nodeFs.rm(p, { force: true });
    } catch {
      // gone already, or not ours to remove
    }
  }
}

/** The cache on disk. Writes go to a temp file renamed into place. */
export function fileUsageCacheIO(file: string): UsageCacheIO {
  return {
    async *lines() {
      await removeStaleTemps(file);
      let handle: nodeFs.FileHandle;
      try {
        handle = await nodeFs.open(file, "r");
      } catch {
        return;
      }
      const input = handle.createReadStream({ encoding: "utf-8" });
      const rl = createInterface({ input, crlfDelay: Infinity });
      try {
        for await (const line of rl) yield line;
      } finally {
        rl.close();
        input.destroy();
        await handle.close().catch(() => {});
      }
    },
    writer() {
      const tmp = `${file}.${process.pid}.${tmpSeq++}.tmp`;
      let handle: nodeFs.FileHandle | undefined;
      let failed = false;
      let buf: string[] = [];
      let size = 0;
      const flush = async (): Promise<void> => {
        if (failed || buf.length === 0) return;
        const text = buf.join("");
        buf = [];
        size = 0;
        try {
          if (!handle) {
            await nodeFs.mkdir(path.dirname(file), { recursive: true });
            handle = await nodeFs.open(tmp, "w");
          }
          await handle.write(text);
        } catch {
          failed = true;
        }
      };
      const close = async (): Promise<void> => {
        const h = handle;
        handle = undefined;
        if (h) await h.close().catch(() => {});
      };
      return {
        async add(line) {
          buf.push(line, "\n");
          size += line.length + 1;
          if (size >= FLUSH_CHARS) await flush();
        },
        async commit() {
          await flush();
          await close();
          try {
            if (failed) throw new Error("cache write failed");
            await nodeFs.rename(tmp, file);
          } catch {
            await nodeFs.rm(tmp, { force: true }).catch(() => {});
          }
        },
        async discard() {
          buf = [];
          await close();
          await nodeFs.rm(tmp, { force: true }).catch(() => {});
        },
      };
    },
  };
}

/**
 * Bump when parseTranscript (either agent) changes what a usage-only session
 * holds, or when the file layout changes. The Sipcode version is part of the
 * header too, so every release starts a fresh cache.
 */
const CACHE_SCHEMA = "sipcode-usage-cache/2";

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

/** The first line of a cache this Sipcode can use (compared as text, so an old cache is never parsed). */
export function cacheHeader(): string {
  return JSON.stringify({ schema: CACHE_SCHEMA, version: sipcodeVersion() });
}

type TurnJson = Omit<AssistantTurn, "toolCalls">;
type SessionJson = Omit<ParsedSession, "assistantTurns" | "toolCalls" | "models" | "priorReads"> & {
  readonly models: string[];
  readonly priorReads?: string[];
  readonly turns: TurnJson[];
};

export interface CacheEntry {
  readonly file: string;
  readonly mtimeMs: number;
  readonly size: number;
  readonly session: ParsedSession;
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

/** One cache line. `file` comes first so entryFile can read it without parsing the line. */
export function encodeEntry(file: string, mtimeMs: number, size: number, s: ParsedSession): string {
  return JSON.stringify({ file, mtimeMs, size, session: toJson(s) });
}

const FILE_PREFIX = '{"file":"';

/** The transcript path a cache line is for, read without parsing the rest of the line. */
export function entryFile(line: string): string | undefined {
  if (!line.startsWith(FILE_PREFIX)) return undefined;
  for (let i = FILE_PREFIX.length; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 92 /* \ */) i++;
    else if (c === 34 /* " */) {
      try {
        const v = JSON.parse(line.slice(FILE_PREFIX.length - 1, i + 1)) as unknown;
        return typeof v === "string" ? v : undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** A cache line read back, or undefined when it is damaged. */
export function decodeEntry(line: string): CacheEntry | undefined {
  try {
    const e = JSON.parse(line) as { file?: unknown; mtimeMs?: unknown; size?: unknown; session?: SessionJson };
    if (typeof e.file !== "string" || typeof e.mtimeMs !== "number" || typeof e.size !== "number" || !e.session) {
      return undefined;
    }
    return { file: e.file, mtimeMs: e.mtimeMs, size: e.size, session: fromJson(e.session) };
  } catch {
    return undefined;
  }
}
