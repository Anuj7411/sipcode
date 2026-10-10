/**
 * The short form of a session id that Sipcode shows (why, stats, receipts,
 * hints, MCP lists) and that `--session <prefix>` takes back: it is always a
 * prefix of the full id, so pasting it finds the session.
 *
 * Claude Code ids are random (UUIDv4): 8 characters, as always.
 * Codex ids are time-ordered (UUIDv7): the first 12 hex digits are the
 * millisecond timestamp, so the first 8 are shared by every session started
 * in the same ~65 seconds (a parent and the subagents it spawns, for one).
 * A Codex UUIDv7 id is shown through its first random group
 * ("0199a1b2-c3d4-7e5f"): the full timestamp plus 12 random bits. Any other
 * Codex id keeps 8 characters.
 */
const UUID_V7_HEAD = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}(?:-|$)/i;

/** Length of the shown prefix of a Codex UUIDv7 id. */
const CODEX_V7_SHORT = 18;

export function shortSessionId(id: string, agentId?: string | undefined): string {
  if (agentId === "codex" && UUID_V7_HEAD.test(id)) return id.slice(0, CODEX_V7_SHORT);
  return id.slice(0, 8);
}
