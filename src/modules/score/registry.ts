/**
 * Check registry: declarative list of every SC### check.
 *
 * Pure module — the order here defines the canonical iteration order so
 * the JSON / terminal / HTML output is byte-identical run-over-run.
 */
import type { CategoryId, CheckDef, CheckId } from "./types.js";

const registered: CheckDef[] = [];

export function registerCheck(def: CheckDef): void {
  // Defensive: refuse duplicate IDs so re-running tests in the same proc
  // doesn't corrupt the registry.
  const existing = registered.findIndex((d) => d.id === def.id);
  if (existing >= 0) {
    registered[existing] = def;
    return;
  }
  registered.push(def);
}

/** Sorted by category then numeric SC id — deterministic for snapshot tests. */
export function getAllChecks(): ReadonlyArray<CheckDef> {
  const copy = [...registered];
  copy.sort((a, b) => {
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return copy;
}

export function getChecksByCategory(cat: CategoryId): ReadonlyArray<CheckDef> {
  return getAllChecks().filter((c) => c.category === cat);
}

export function getCheck(id: CheckId): CheckDef | undefined {
  return registered.find((d) => d.id === id);
}

/** Test/escape hatch — drop all registered checks. */
export function _resetRegistryForTests(): void {
  registered.length = 0;
}
