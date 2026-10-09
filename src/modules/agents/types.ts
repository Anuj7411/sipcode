/**
 * Agent abstraction — the multi-agent moat.
 *
 * Rules injection and the manifest target are agent-aware for Claude Code
 * and Cursor; session logs are parsed for Claude Code and Codex (Cursor
 * returns E009, and so does writing rules for Codex).
 *
 * Each agent has its own quirks:
 *   - where its rules live (CLAUDE.md, .cursor/rules/*.mdc or .cursorrules, AGENTS.md)
 *   - whether its session logs can be parsed (Claude Code and Codex yes, Cursor no)
 *   - how it's detected as "installed" in a given cwd
 *
 * Adapters wrap those quirks behind a single Agent interface so commands
 * route through `agent.method(deps, ...)` without caring which agent it is.
 */
import type { Clock } from "../../lib/clock.js";
import type { FileSystem } from "../../lib/fs.js";
import type { ProcessEnv } from "../../lib/process.js";
import type { SipcodeIssue } from "../../lib/errors.js";
import type { Result } from "../../lib/result.js";
import type { KeyScan } from "../transcript/parse.js";
import type {
  ParsedSession,
  SessionMeta,
} from "./shared.js";

/** Stable agent identifiers. New adapters reserve a new id (S044/S045/S046). */
export type AgentId = "claude-code" | "cursor" | "codex";

/** All agent IDs we know about (for validation + auto-detect). */
export const ALL_AGENT_IDS: ReadonlyArray<AgentId> = ["claude-code", "cursor", "codex"];

/** "auto" sentinel for CLI flag — resolved to a real AgentId by detect.ts. */
export type AgentSelector = AgentId | "auto";

/** Static metadata about an agent — no I/O. */
export interface AgentCapabilities {
  readonly id: AgentId;
  readonly displayName: string;
  /**
   * Where this agent stores its project-scoped rules, in preference order.
   * The first existing path wins on inspection; writes target the first
   * candidate by default (with fallback for cursor's legacy .cursorrules).
   */
  readonly rulesPathCandidates: (cwd: string) => readonly string[];
  /**
   * Can this agent's transcripts be parsed in this milestone?
   * cursor=false — schema isn't publicly stable. Stubbed to E009.
   */
  readonly transcriptParsingSupported: boolean;
}

/** I/O dependencies common to every adapter. */
export interface AgentDeps {
  readonly fs: FileSystem;
  readonly env: ProcessEnv;
  readonly clock: Clock;
}

/** Input to writeRulesBlock — a named sub-block body the agent should upsert. */
export interface RulesBlockInput {
  readonly name: string;
  readonly mode?: string;
  readonly body: string;
}

export interface AgentRulesWrite {
  /** Absolute path the rules were written to. */
  readonly path: string;
  /** Resulting file content (after upsert). */
  readonly content: string;
}

export interface AgentRulesRead {
  /** Absolute path of the rules file found. */
  readonly path: string;
  /** Full content of the rules file. */
  readonly content: string;
}

export type { KeyScan };

/**
 * Discovery with a report of what it could not use. Adapters with nothing to
 * report return a bare SessionMeta[] instead.
 */
export interface SessionDiscovery {
  readonly sessions: SessionMeta[];
  /** Session files that could not be read; added to loadSessions' unreadable count. */
  readonly unreadable: number;
  /** Folders that could not be listed (reported apart from files). Default 0. */
  readonly unreadableFolders?: number;
  /** Compressed logs (Codex `.jsonl.zst`) skipped on purpose, reported as one count. Default 0. */
  readonly skippedCompressed?: number;
  /** Other problems discovery wants surfaced. */
  readonly issues: readonly SipcodeIssue[];
}

/** Full agent interface — capabilities + I/O behaviors. */
export interface Agent extends AgentCapabilities {
  /** Discover past sessions. Cursor returns E009 (no parsing in this milestone). */
  discoverSessions(
    deps: AgentDeps,
  ): Promise<Result<SessionMeta[] | SessionDiscovery, SipcodeIssue[]>>;

  /** Parse a transcript file. Cursor returns E009. */
  parseTranscript(content: string): Result<ParsedSession, SipcodeIssue[]>;

  /**
   * Optional fast path: scan request keys + time span without a full parse.
   * Lets loadSessions dedupe against files outside a command window cheaply.
   */
  scanRequestKeys?(content: string): KeyScan;

  /** --here: does this discovered session belong to the project at `cwd`? */
  matchesCwd(meta: SessionMeta, cwd: string): boolean;

  /** Read the existing rules file content for inspection. null if none exists. */
  readRulesFile(deps: AgentDeps, cwd: string): Promise<AgentRulesRead | null>;

  /** Upsert a named sub-block into the agent's rules file (idempotent).
   *
   * `existingContent` is optional: when provided, the adapter uses it as the
   * "current" file state (this lets command callers thread their own readFile
   * seam through without coupling to fs.readFile). When undefined, the
   * adapter reads from `deps.fs`.
   */
  writeRulesBlock(
    deps: AgentDeps,
    cwd: string,
    block: RulesBlockInput,
    write: WriteFile,
    existingContent?: string,
  ): Promise<Result<AgentRulesWrite, SipcodeIssue[]>>;

  /** Remove a named sub-block from the agent's rules file. No-op if absent. */
  removeRulesBlock(
    deps: AgentDeps,
    cwd: string,
    blockName: string,
    write: WriteFile,
  ): Promise<Result<AgentRulesWrite | null, SipcodeIssue[]>>;

  /** Is the agent installed / detectable on this machine + cwd? */
  isInstalled(deps: AgentDeps, cwd: string): Promise<boolean>;
}

/** Pluggable file writer — the seam keeps adapters off node:fs. */
export type WriteFile = (absPath: string, content: string) => Promise<void>;
