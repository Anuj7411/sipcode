import { describe, it, expect } from "vitest";
import {
  captureConfigSnapshot,
  diffConfigs,
  attributionFromDiff,
  loadConfigSnapshots,
  persistConfigSnapshot,
  snapshotBefore,
} from "../../../src/modules/drift/config-snapshot.js";
import type { StoreIO } from "../../../src/modules/drift/store.js";
import type { ConfigSnapshot } from "../../../src/modules/drift/types.js";

function memIO(): StoreIO {
  const files = new Map<string, string>();
  return {
    async read(p) {
      return files.has(p) ? files.get(p)! : null;
    },
    async write(p, content) {
      files.set(p, content);
    },
    async append(p, content) {
      files.set(p, (files.get(p) ?? "") + content);
    },
  };
}

describe("captureConfigSnapshot", () => {
  it("extracts MCP server names from a single config file", async () => {
    const reader = async (p: string) =>
      p === "/home/u/.claude.json"
        ? JSON.stringify({ mcpServers: { supabase: {}, github: {} } })
        : null;
    const snap = await captureConfigSnapshot(["/home/u/.claude.json"], 1000, reader);
    expect(snap.capturedAtMs).toBe(1000);
    expect(snap.mcpServers).toEqual(["github", "supabase"]);
  });

  it("merges names across multiple config files (dedup + sort)", async () => {
    const reader = async (p: string) => {
      if (p === "/a") return JSON.stringify({ mcpServers: { x: {}, m: {} } });
      if (p === "/b") return JSON.stringify({ mcpServers: { m: {}, z: {} } });
      return null;
    };
    const snap = await captureConfigSnapshot(["/a", "/b"], 0, reader);
    expect(snap.mcpServers).toEqual(["m", "x", "z"]);
  });

  it("returns an empty server list when no files exist", async () => {
    const snap = await captureConfigSnapshot(["/none"], 0, async () => null);
    expect(snap.mcpServers).toEqual([]);
  });

  it("survives a malformed config file (returns empty without throwing)", async () => {
    const reader = async () => "{not valid json";
    const snap = await captureConfigSnapshot(["/x"], 0, reader);
    expect(snap.mcpServers).toEqual([]);
  });
});

describe("diffConfigs + attributionFromDiff", () => {
  const s = (...names: string[]): ConfigSnapshot => ({
    capturedAtMs: 0,
    mcpServers: names,
  });

  it("reports adds and removes between two snapshots", () => {
    const before = s("a", "b", "c");
    const after = s("b", "c", "d");
    const d = diffConfigs(before, after);
    expect(d.added).toEqual(["d"]);
    expect(d.removed).toEqual(["a"]);
  });

  it("treats a missing 'before' as everything-added", () => {
    const d = diffConfigs(undefined, s("a", "b"));
    expect(d.added).toEqual(["a", "b"]);
    expect(d.removed).toEqual([]);
  });

  it("attributionFromDiff returns empty string when nothing changed", () => {
    expect(attributionFromDiff(diffConfigs(s("a"), s("a")))).toBe("");
  });

  it("attributionFromDiff names the specific servers", () => {
    const line = attributionFromDiff(diffConfigs(s("a"), s("b")));
    expect(line).toContain("added `b`");
    expect(line).toContain("removed `a`");
    expect(line).toContain("cache");
  });
});

describe("persistConfigSnapshot + loadConfigSnapshots", () => {
  it("appends a new snapshot and reads it back", async () => {
    const io = memIO();
    const path = "/x/configs.jsonl";
    await persistConfigSnapshot(path, { capturedAtMs: 1, mcpServers: ["a"] }, io);
    await persistConfigSnapshot(path, { capturedAtMs: 2, mcpServers: ["a", "b"] }, io);
    const snaps = await loadConfigSnapshots(path, io);
    expect(snaps.map((s) => s.capturedAtMs)).toEqual([2, 1]);
  });

  it("collapses an unchanged snapshot (same server set) — no churn", async () => {
    const io = memIO();
    const path = "/x/configs.jsonl";
    await persistConfigSnapshot(path, { capturedAtMs: 1, mcpServers: ["a"] }, io);
    await persistConfigSnapshot(path, { capturedAtMs: 2, mcpServers: ["a"] }, io);
    const snaps = await loadConfigSnapshots(path, io);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.capturedAtMs).toBe(1);
  });
});

describe("snapshotBefore", () => {
  it("finds the newest snapshot taken at or before the cutoff", () => {
    const snaps: ConfigSnapshot[] = [
      { capturedAtMs: 500, mcpServers: ["c"] },
      { capturedAtMs: 300, mcpServers: ["b"] },
      { capturedAtMs: 100, mcpServers: ["a"] },
    ];
    expect(snapshotBefore(snaps, 350)?.capturedAtMs).toBe(300);
    expect(snapshotBefore(snaps, 600)?.capturedAtMs).toBe(500);
    expect(snapshotBefore(snaps, 50)).toBeUndefined();
  });
});
