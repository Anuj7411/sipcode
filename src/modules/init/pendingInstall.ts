/**
 * Pending-install marker for v1.6.16 F-CACHE-DEFER.
 *
 * When `sipcode init` runs while an active Claude Code session exists, the
 * settings.json write (which would invalidate Anthropic's prompt cache) is
 * deferred. A marker is written at ~/.sipcode/install-pending.json with the
 * intent "install proxy hook at scriptPath". The next sipcode invocation
 * outside an active session calls applyPendingInstall, which regenerates
 * the script (so users get the LATEST sipcode version) and applies the
 * proxy hook to the CURRENT settings.json (preserving any user changes).
 *
 * Schema is versioned (sipcode-install-pending/1). Future additive
 * changes bump the version; readers reject unknown versions to avoid
 * silently mis-applying a marker authored by a newer sipcode build.
 *
 * Pure-ish: I/O is injected via PendingInstallIO so tests can drive every
 * path deterministically. The actual settings/script transform reuses
 * existing helpers (parseSettings, installProxyHook, renderSettings) so
 * this module never duplicates that logic.
 */
import path from "node:path";
import {
  parseSettings,
  renderSettings,
} from "../hygiene/settingsJson.js";
import { installProxyHook } from "../proxy/install.js";
import type { ActiveSessionsResult } from "./sessionDetection.js";

export const PENDING_INSTALL_SCHEMA_V1 = "sipcode-install-pending/1" as const;
type SchemaV1 = typeof PENDING_INSTALL_SCHEMA_V1;

/** I/O seam. Pure operations only. */
export interface PendingInstallIO {
  readFile(absPath: string): Promise<string | null>;
  writeFile(absPath: string, content: string): Promise<void>;
  deleteFile(absPath: string): Promise<void>;
  now(): Date;
}

/** The persisted marker. v1 schema. */
export interface PendingMarker {
  readonly schemaVersion: SchemaV1;
  readonly createdAt: string;
  readonly scriptPath: string;
  readonly settingsPath: string;
}

export interface WriteMarkerInput {
  readonly homeDir: string;
  readonly scriptPath: string;
  readonly settingsPath: string;
}

export interface ApplyInput {
  readonly homeDir: string;
  /** Generator for the proxy hook script content. Re-run at apply time so
   * users get the latest version even if it was deferred days ago. */
  readonly generateScript: () => string;
}

export type ApplyResult =
  | { readonly kind: "no-marker" }
  | {
      readonly kind: "applied";
      readonly scriptWritten: boolean;
      readonly settingsWritten: boolean;
    };

/** Absolute path to the marker file. */
export function pendingMarkerPath(homeDir: string): string {
  return path.join(homeDir, ".sipcode", "install-pending.json");
}

/** Write (or overwrite) the marker. */
export async function writePendingMarker(
  input: WriteMarkerInput,
  io: PendingInstallIO,
): Promise<void> {
  const marker: PendingMarker = {
    schemaVersion: PENDING_INSTALL_SCHEMA_V1,
    createdAt: io.now().toISOString(),
    scriptPath: input.scriptPath,
    settingsPath: input.settingsPath,
  };
  const json = JSON.stringify(marker, null, 2) + "\n";
  await io.writeFile(pendingMarkerPath(input.homeDir), json);
}

/**
 * Read the marker. Returns null if missing, corrupt, or schema-incompatible.
 * Never throws.
 */
export async function readPendingMarker(
  homeDir: string,
  io: PendingInstallIO,
): Promise<PendingMarker | null> {
  let raw: string | null;
  try {
    raw = await io.readFile(pendingMarkerPath(homeDir));
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(parsed)) return null;

  // Strict schema validation. Reject unknown versions to avoid silently
  // mis-applying a marker authored by a newer sipcode build.
  if (parsed["schemaVersion"] !== PENDING_INSTALL_SCHEMA_V1) return null;
  if (typeof parsed["createdAt"] !== "string") return null;
  if (typeof parsed["scriptPath"] !== "string" || parsed["scriptPath"].length === 0) {
    return null;
  }
  if (typeof parsed["settingsPath"] !== "string" || parsed["settingsPath"].length === 0) {
    return null;
  }

  return {
    schemaVersion: PENDING_INSTALL_SCHEMA_V1,
    createdAt: parsed["createdAt"],
    scriptPath: parsed["scriptPath"],
    settingsPath: parsed["settingsPath"],
  };
}

/** Clear the marker. No-op if missing. Never throws. */
export async function clearPendingMarker(
  homeDir: string,
  io: PendingInstallIO,
): Promise<void> {
  try {
    await io.deleteFile(pendingMarkerPath(homeDir));
  } catch {
    // File didn't exist, or some other transient error. Either way, the
    // postcondition "marker is gone" holds at apply time the next call
    // around, so swallow.
  }
}

/**
 * Apply the deferred install:
 *  1. Read the marker. If missing, return no-marker.
 *  2. Generate the proxy hook script (fresh — users get the latest).
 *  3. Write script if changed.
 *  4. Read current settings.json, parse, apply installProxyHook
 *     (this preserves any user-managed hook entries).
 *  5. Write settings.json if changed.
 *  6. Clear the marker.
 *
 * Idempotent: a second call after success returns no-marker. A repeat call
 * with no observable change still clears the marker but reports
 * scriptWritten=false / settingsWritten=false.
 */
export async function applyPendingInstall(
  input: ApplyInput,
  io: PendingInstallIO,
): Promise<ApplyResult> {
  const marker = await readPendingMarker(input.homeDir, io);
  if (marker === null) return { kind: "no-marker" };

  // Step 2: regenerate the script.
  const newScript = input.generateScript();
  const existingScript = await io.readFile(marker.scriptPath);
  const scriptChanged = existingScript !== newScript;
  if (scriptChanged) {
    await io.writeFile(marker.scriptPath, newScript);
  }

  // Step 4-5: apply against current settings.
  const existingSettings = await io.readFile(marker.settingsPath);
  const parsed = parseSettings(existingSettings ?? "");
  const nextObj = installProxyHook(parsed, marker.scriptPath);
  const nextSettings = renderSettings(nextObj);
  const settingsChanged = (existingSettings ?? "") !== nextSettings;
  if (settingsChanged) {
    await io.writeFile(marker.settingsPath, nextSettings);
  }

  // Step 6: clear marker.
  await clearPendingMarker(input.homeDir, io);

  return {
    kind: "applied",
    scriptWritten: scriptChanged,
    settingsWritten: settingsChanged,
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ──────────── maybeApplyPendingInstall — CLI auto-apply wrapper ───────────

export interface MaybeApplyDeps {
  readonly homeDir: string;
  /** Same shape as SystemSetupDeps.detectActiveSessions. Injected so the
   * CLI can use the real-fs implementation while tests use mocks. */
  readonly detectActiveSessions: (
    homeDir: string,
  ) => Promise<ActiveSessionsResult>;
  readonly pendingIO: PendingInstallIO;
  readonly generateScript: () => string;
  /** Optional logger. CLI passes a quiet writer; tests pass a buffer. */
  readonly log?: (message: string) => void;
}

export type MaybeApplyResult =
  | { readonly kind: "no-marker" }
  | { readonly kind: "skipped-active-session"; readonly count: number }
  | { readonly kind: "skipped-detection-error"; readonly error: string }
  | {
      readonly kind: "applied";
      readonly scriptWritten: boolean;
      readonly settingsWritten: boolean;
    };

/**
 * The CLI startup hook for F-CACHE-DEFER. Called from `cli.ts` preAction:
 *
 *  - If no marker exists: instant no-op (sub-millisecond stat).
 *  - If marker exists AND an active Claude Code session is running: skip,
 *    leave marker for the next attempt. Don't trash the user's prompt
 *    cache mid-session.
 *  - If marker exists AND no active session: apply the install, clear
 *    the marker, log a single line so the user knows what happened.
 *  - If detection itself throws: conservatively SKIP. We don't know if
 *    it's safe; better to ask the user to re-run later than to guess
 *    wrong and clobber their session.
 *
 * Never throws — every path returns a result the caller can ignore safely.
 */
export async function maybeApplyPendingInstall(
  deps: MaybeApplyDeps,
): Promise<MaybeApplyResult> {
  // Fast path: probe for the marker first to avoid the detection overhead
  // when there's nothing pending.
  const marker = await readPendingMarker(deps.homeDir, deps.pendingIO);
  if (marker === null) return { kind: "no-marker" };

  // Marker exists. Check active sessions before applying.
  let active: ActiveSessionsResult;
  try {
    active = await deps.detectActiveSessions(deps.homeDir);
  } catch (err) {
    return {
      kind: "skipped-detection-error",
      error: err instanceof Error ? err.message : "unknown detection error",
    };
  }

  if (active.active) {
    return { kind: "skipped-active-session", count: active.count };
  }

  // Safe to apply.
  const applyResult = await applyPendingInstall(
    { homeDir: deps.homeDir, generateScript: deps.generateScript },
    deps.pendingIO,
  );

  // Only log if the apply actually changed something. When init already
  // installed via the normal path (no active session at the time), the
  // marker may be stale; applyPendingInstall is then a no-op-but-clears.
  // Silent in that case so the user does not see a confusing message
  // about an apply that did nothing.
  if (
    applyResult.kind === "applied" &&
    (applyResult.scriptWritten || applyResult.settingsWritten) &&
    deps.log
  ) {
    deps.log(
      "sipcode applied a pending install (settings.json updated, prompt cache impact deferred until now).",
    );
  }

  // Forward the apply result. "no-marker" should be unreachable here
  // (we just checked) but the union widening means we return it as-is.
  if (applyResult.kind === "no-marker") return { kind: "no-marker" };
  return applyResult;
}
