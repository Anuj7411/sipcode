/**
 * Config-cause attribution.
 *
 * Each drift run snapshots the user's Claude Code config — specifically the
 * MCP server names — and appends to `~/.sipcode/drift/configs.jsonl`. When
 * cache-reuse regression is detected, we diff a snapshot taken before the
 * baseline window against the current snapshot. If MCP servers were added or
 * removed, that change usually explains the cache drop.
 *
 * Privacy: only MCP server NAMES are recorded. Never values, env, or args.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ConfigSnapshot, ConfigDiff } from "./types.js";
import type { StoreIO } from "./store.js";
import { realStoreIO } from "./store.js";

const KEEP_MAX = 100;
const PRUNE_AT = 400;

/** Default candidate paths in priority order. First readable wins; we merge. */
export function defaultConfigPaths(homeDir: string): string[] {
  return [
    path.join(homeDir, ".claude.json"),
    path.join(homeDir, ".claude", "settings.json"),
  ];
}

/** Read whichever Claude config files exist and extract `mcpServers` keys. */
export async function captureConfigSnapshot(
  paths: ReadonlyArray<string>,
  nowMs: number,
  reader: (p: string) => Promise<string | null> = realStoreIO.read,
): Promise<ConfigSnapshot> {
  const names = new Set<string>();
  for (const p of paths) {
    const raw = await reader(p);
    if (raw === null) continue;
    try {
      const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
      const servers = parsed?.mcpServers;
      if (servers && typeof servers === "object") {
        for (const name of Object.keys(servers)) names.add(name);
      }
    } catch {
      // Skip unparseable file — never let a broken config halt drift.
    }
  }
  return {
    capturedAtMs: nowMs,
    mcpServers: Array.from(names).sort((a, b) => a.localeCompare(b)),
  };
}

/** Load all stored config snapshots, newest-first, deduped on capturedAtMs. */
export async function loadConfigSnapshots(
  filePath: string,
  io: StoreIO = realStoreIO,
): Promise<ConfigSnapshot[]> {
  const raw = await io.read(filePath);
  if (raw === null) return [];
  const byT = new Map<number, ConfigSnapshot>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const s = JSON.parse(trimmed) as ConfigSnapshot;
      if (s && typeof s.capturedAtMs === "number" && Array.isArray(s.mcpServers)) {
        byT.set(s.capturedAtMs, s);
      }
    } catch {
      // Skip malformed line.
    }
  }
  return Array.from(byT.values()).sort((a, b) => b.capturedAtMs - a.capturedAtMs);
}

/** Append the given snapshot; collapse adjacent duplicates (same server set). */
export async function persistConfigSnapshot(
  filePath: string,
  snap: ConfigSnapshot,
  io: StoreIO = realStoreIO,
): Promise<void> {
  const prior = await loadConfigSnapshots(filePath, io);
  const latest = prior[0];
  if (latest && arraysEqual(latest.mcpServers, snap.mcpServers)) {
    // No meaningful change — don't grow the log forever.
    return;
  }
  await io.append(filePath, JSON.stringify(snap) + "\n");
  if (prior.length + 1 > PRUNE_AT) {
    const kept = [snap, ...prior].slice(0, KEEP_MAX);
    const body = kept.map((s) => JSON.stringify(s)).join("\n") + "\n";
    await io.write(filePath, body);
  }
}

/** Compare two snapshots; positive direction = added, negative = removed. */
export function diffConfigs(
  before: ConfigSnapshot | undefined,
  after: ConfigSnapshot | undefined,
): ConfigDiff {
  const a = new Set(before?.mcpServers ?? []);
  const b = new Set(after?.mcpServers ?? []);
  return {
    added: [...b].filter((n) => !a.has(n)).sort(),
    removed: [...a].filter((n) => !b.has(n)).sort(),
  };
}

/** Render a diff as a human-readable attribution line, or "" if empty. */
export function attributionFromDiff(diff: ConfigDiff): string {
  if (diff.added.length === 0 && diff.removed.length === 0) return "";
  const parts: string[] = [];
  if (diff.added.length > 0) {
    parts.push(`added ${diff.added.map((n) => `\`${n}\``).join(", ")}`);
  }
  if (diff.removed.length > 0) {
    parts.push(`removed ${diff.removed.map((n) => `\`${n}\``).join(", ")}`);
  }
  return `Your MCP server list changed since the baseline window: ${parts.join("; ")}. Changing MCP servers restarts them and invalidates the cache.`;
}

/** Pick the snapshot most recently captured at-or-before `beforeMs`. */
export function snapshotBefore(
  snapshots: ReadonlyArray<ConfigSnapshot>,
  beforeMs: number,
): ConfigSnapshot | undefined {
  // snapshots are newest-first
  return snapshots.find((s) => s.capturedAtMs <= beforeMs);
}

function arraysEqual(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
