/**
 * Per-session signal cache for B3 AST-aware reads.
 *
 * Records Grep/Glob patterns Claude has searched for. The AST-read
 * orchestrator uses these as the relevance signal: when Claude later Reads a
 * .ts file, symbols whose name matches any recent grep pattern get a high
 * relevance score and the orchestrator can inject offset/limit to return only
 * those symbols' line ranges instead of the full file.
 *
 * Cache file: `~/.sipcode/proxy-signals/<session-id>.jsonl`. Session-keyed
 * because each Claude Code session has its own search intent.
 *
 * StoreIO seam mirrors read-cache.ts so tests can inject in-memory I/O.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export type SignalKind = "grep-pattern" | "glob-pattern";

export interface Signal {
  /** Tool name that produced this signal (Bash/Grep/Glob). */
  readonly tool: string;
  /** What kind of signal this is. */
  readonly kind: SignalKind;
  /** The raw query/pattern Claude sent. */
  readonly pattern: string;
  /** When this signal was captured (epoch ms). */
  readonly capturedAtMs: number;
}

export interface StoreIO {
  read(p: string): Promise<string | null>;
  append(p: string, content: string): Promise<void>;
}

export const realStoreIO: StoreIO = {
  async read(p) {
    try {
      return await fs.readFile(p, "utf-8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw err;
    }
  },
  async append(p, content) {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.appendFile(p, content, "utf-8");
  },
};

export function sessionSignalsPath(home: string, sessionId: string): string {
  return path.join(home, ".sipcode", "proxy-signals", `${sessionId}.jsonl`);
}

/**
 * Load signals for a session, newest-first. Caps the load at MAX_SIGNALS to
 * keep relevance scoring fast even on long sessions.
 */
export const MAX_SIGNALS = 200;

export async function loadSignals(
  filePath: string,
  io: StoreIO = realStoreIO,
): Promise<Signal[]> {
  const raw = await io.read(filePath);
  if (raw === null) return [];
  const out: Signal[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const e = JSON.parse(trimmed) as Signal;
      if (
        e &&
        typeof e === "object" &&
        typeof e.pattern === "string" &&
        typeof e.capturedAtMs === "number"
      ) {
        out.push(e);
      }
    } catch {
      // skip malformed line
    }
  }
  out.sort((a, b) => b.capturedAtMs - a.capturedAtMs);
  return out.slice(0, MAX_SIGNALS);
}

export async function appendSignal(
  filePath: string,
  signal: Signal,
  io: StoreIO = realStoreIO,
): Promise<void> {
  await io.append(filePath, JSON.stringify(signal) + "\n");
}

/**
 * Pull search patterns from a PreToolUse input. Returns null when the tool
 * doesn't carry any usable signal. Pure.
 */
export function deriveSignalFromInput(
  toolName: string,
  toolInput: Record<string, unknown>,
  nowMs: number,
): Signal | null {
  // Native Grep
  if (toolName === "Grep") {
    const pattern = toolInput.pattern;
    if (typeof pattern === "string" && pattern.length > 0) {
      return { tool: "Grep", kind: "grep-pattern", pattern, capturedAtMs: nowMs };
    }
    return null;
  }
  // Native Glob
  if (toolName === "Glob") {
    const pattern = toolInput.pattern;
    if (typeof pattern === "string" && pattern.length > 0) {
      return { tool: "Glob", kind: "glob-pattern", pattern, capturedAtMs: nowMs };
    }
    return null;
  }
  // Bash grep — best-effort pattern extraction.
  if (toolName === "Bash") {
    const command = toolInput.command;
    if (typeof command !== "string") return null;
    const m = command.match(
      /^\s*(?:grep|rg|ag)\s+(?:--?[a-zA-Z][a-zA-Z0-9-]*(?:=\S+)?\s+)*['"]?([^\s'"]+)['"]?/,
    );
    if (m && m[1]) {
      return {
        tool: "Bash",
        kind: "grep-pattern",
        pattern: m[1],
        capturedAtMs: nowMs,
      };
    }
    return null;
  }
  return null;
}
