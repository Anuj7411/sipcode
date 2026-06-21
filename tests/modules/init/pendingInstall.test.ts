/**
 * Tests for v1.6.16 `pendingInstall` — F-CACHE-DEFER marker module.
 *
 * Responsibilities of the module under test:
 *   1. Write a marker at ~/.sipcode/install-pending.json with the intent
 *      "install the proxy hook (settings.json write deferred)".
 *   2. Read back the marker. Tolerate missing file (null) and corrupt JSON
 *      (null), don't throw.
 *   3. Clear the marker after a successful apply.
 *   4. Apply the deferred install: regenerate the proxy hook script,
 *      apply installProxyHook against CURRENT settings.json (preserves any
 *      user changes), write back, clear marker. Idempotent.
 *
 * Schema: `sipcode-install-pending/1`. Additive future versions allowed.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  PENDING_INSTALL_SCHEMA_V1,
  writePendingMarker,
  readPendingMarker,
  clearPendingMarker,
  applyPendingInstall,
  pendingMarkerPath,
  type PendingInstallIO,
  type PendingMarker,
} from "../../../src/modules/init/pendingInstall.js";

const HOME = "/home/user";
const NOW = new Date("2026-06-21T12:00:00.000Z");
const SCRIPT_PATH = path.join(HOME, ".claude", "hooks", "sipcode-proxy.mjs");
const SETTINGS_PATH = path.join(HOME, ".claude", "settings.json");
const MARKER_PATH = path.join(HOME, ".sipcode", "install-pending.json");

interface MockState {
  files: Map<string, string>;
  /** writeFile failure injection — paths that throw on write. */
  writeFailures?: ReadonlySet<string>;
  /** deleteFile failure injection. */
  deleteFailures?: ReadonlySet<string>;
}

function makeIO(state: MockState, now: Date = NOW): PendingInstallIO {
  return {
    async readFile(p) {
      return state.files.get(p) ?? null;
    },
    async writeFile(p, content) {
      if (state.writeFailures?.has(p)) throw new Error("ENOSPC: disk full");
      state.files.set(p, content);
    },
    async deleteFile(p) {
      if (state.deleteFailures?.has(p)) throw new Error("EPERM");
      state.files.delete(p);
    },
    now() {
      return now;
    },
  };
}

const DUMMY_SCRIPT = "// sipcode proxy hook signature v4\nconsole.log('hi');\n";

describe("pendingMarkerPath", () => {
  it("places marker under ~/.sipcode/install-pending.json", () => {
    expect(pendingMarkerPath(HOME)).toBe(MARKER_PATH);
  });
});

describe("writePendingMarker + readPendingMarker round-trip", () => {
  it("writes a v1 schema marker with createdAt and paths", async () => {
    const state: MockState = { files: new Map() };
    const io = makeIO(state);

    await writePendingMarker(
      { homeDir: HOME, scriptPath: SCRIPT_PATH, settingsPath: SETTINGS_PATH },
      io,
    );

    const raw = state.files.get(MARKER_PATH);
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(parsed.schemaVersion).toBe(PENDING_INSTALL_SCHEMA_V1);
    expect(parsed.createdAt).toBe(NOW.toISOString());
    expect(parsed.scriptPath).toBe(SCRIPT_PATH);
    expect(parsed.settingsPath).toBe(SETTINGS_PATH);
  });

  it("reads back what was written", async () => {
    const state: MockState = { files: new Map() };
    const io = makeIO(state);

    await writePendingMarker(
      { homeDir: HOME, scriptPath: SCRIPT_PATH, settingsPath: SETTINGS_PATH },
      io,
    );
    const marker = await readPendingMarker(HOME, io);
    expect(marker).not.toBeNull();
    expect(marker!.schemaVersion).toBe(PENDING_INSTALL_SCHEMA_V1);
    expect(marker!.scriptPath).toBe(SCRIPT_PATH);
    expect(marker!.settingsPath).toBe(SETTINGS_PATH);
    expect(marker!.createdAt).toBe(NOW.toISOString());
  });

  it("overwrites an existing marker (latest deferral wins)", async () => {
    const state: MockState = { files: new Map() };
    const io = makeIO(state);

    await writePendingMarker(
      { homeDir: HOME, scriptPath: "/old/script", settingsPath: "/old/settings" },
      io,
    );
    await writePendingMarker(
      { homeDir: HOME, scriptPath: SCRIPT_PATH, settingsPath: SETTINGS_PATH },
      io,
    );

    const marker = await readPendingMarker(HOME, io);
    expect(marker!.scriptPath).toBe(SCRIPT_PATH);
    expect(marker!.settingsPath).toBe(SETTINGS_PATH);
  });
});

describe("readPendingMarker — robustness", () => {
  it("returns null when the file is missing", async () => {
    const io = makeIO({ files: new Map() });
    expect(await readPendingMarker(HOME, io)).toBeNull();
  });

  it("returns null when the file is corrupt JSON", async () => {
    const state: MockState = { files: new Map([[MARKER_PATH, "{ not json"]]) };
    const io = makeIO(state);
    expect(await readPendingMarker(HOME, io)).toBeNull();
  });

  it("returns null when the schema version is wrong", async () => {
    const state: MockState = {
      files: new Map([
        [
          MARKER_PATH,
          JSON.stringify({
            schemaVersion: "sipcode-install-pending/99",
            createdAt: NOW.toISOString(),
            scriptPath: SCRIPT_PATH,
            settingsPath: SETTINGS_PATH,
          }),
        ],
      ]),
    };
    const io = makeIO(state);
    expect(await readPendingMarker(HOME, io)).toBeNull();
  });

  it("returns null when required fields are missing", async () => {
    const state: MockState = {
      files: new Map([
        [
          MARKER_PATH,
          JSON.stringify({
            schemaVersion: PENDING_INSTALL_SCHEMA_V1,
            // missing scriptPath / settingsPath / createdAt
          }),
        ],
      ]),
    };
    const io = makeIO(state);
    expect(await readPendingMarker(HOME, io)).toBeNull();
  });
});

describe("clearPendingMarker", () => {
  it("deletes the marker file", async () => {
    const state: MockState = { files: new Map() };
    const io = makeIO(state);
    await writePendingMarker(
      { homeDir: HOME, scriptPath: SCRIPT_PATH, settingsPath: SETTINGS_PATH },
      io,
    );
    expect(state.files.has(MARKER_PATH)).toBe(true);

    await clearPendingMarker(HOME, io);
    expect(state.files.has(MARKER_PATH)).toBe(false);
  });

  it("is a no-op when the marker does not exist (does not throw)", async () => {
    const io = makeIO({ files: new Map() });
    await expect(clearPendingMarker(HOME, io)).resolves.toBeUndefined();
  });
});

describe("applyPendingInstall — full flow", () => {
  it("returns no-op when no marker exists", async () => {
    const io = makeIO({ files: new Map() });
    const result = await applyPendingInstall(
      { homeDir: HOME, generateScript: () => DUMMY_SCRIPT },
      io,
    );
    expect(result.kind).toBe("no-marker");
  });

  it("applies the script + settings, then clears the marker", async () => {
    const state: MockState = { files: new Map() };
    const io = makeIO(state);

    // Set up: write a marker. Simulate existing settings.json with unrelated user content.
    await writePendingMarker(
      { homeDir: HOME, scriptPath: SCRIPT_PATH, settingsPath: SETTINGS_PATH },
      io,
    );
    state.files.set(
      SETTINGS_PATH,
      JSON.stringify({ unrelated: "user-config" }, null, 2) + "\n",
    );

    const result = await applyPendingInstall(
      { homeDir: HOME, generateScript: () => DUMMY_SCRIPT },
      io,
    );

    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;

    // Script written.
    expect(state.files.get(SCRIPT_PATH)).toBe(DUMMY_SCRIPT);

    // Settings updated: includes hooks AND preserves unrelated user content.
    const settings = JSON.parse(state.files.get(SETTINGS_PATH)!);
    expect(settings.unrelated).toBe("user-config");
    expect(settings.hooks).toBeDefined();
    expect(Array.isArray(settings.hooks.PreToolUse)).toBe(true);
    expect(settings.hooks.PreToolUse.length).toBeGreaterThan(0);

    // Marker cleared.
    expect(state.files.has(MARKER_PATH)).toBe(false);

    // Result reports what changed.
    expect(result.scriptWritten).toBe(true);
    expect(result.settingsWritten).toBe(true);
  });

  it("is idempotent — second apply finds no marker (no-op)", async () => {
    const state: MockState = { files: new Map() };
    const io = makeIO(state);

    await writePendingMarker(
      { homeDir: HOME, scriptPath: SCRIPT_PATH, settingsPath: SETTINGS_PATH },
      io,
    );

    const first = await applyPendingInstall(
      { homeDir: HOME, generateScript: () => DUMMY_SCRIPT },
      io,
    );
    expect(first.kind).toBe("applied");

    const second = await applyPendingInstall(
      { homeDir: HOME, generateScript: () => DUMMY_SCRIPT },
      io,
    );
    expect(second.kind).toBe("no-marker");
  });

  it("skips redundant writes when script + settings already match", async () => {
    const state: MockState = { files: new Map() };
    const io = makeIO(state);

    // Pre-populate as if a prior apply already happened. Then write a marker
    // again (simulating a stale marker after an external sync).
    await writePendingMarker(
      { homeDir: HOME, scriptPath: SCRIPT_PATH, settingsPath: SETTINGS_PATH },
      io,
    );
    // First apply to establish "already installed" state.
    await applyPendingInstall(
      { homeDir: HOME, generateScript: () => DUMMY_SCRIPT },
      io,
    );

    // Write the marker again with same intent.
    await writePendingMarker(
      { homeDir: HOME, scriptPath: SCRIPT_PATH, settingsPath: SETTINGS_PATH },
      io,
    );
    const result = await applyPendingInstall(
      { homeDir: HOME, generateScript: () => DUMMY_SCRIPT },
      io,
    );

    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    expect(result.scriptWritten).toBe(false);
    expect(result.settingsWritten).toBe(false);
  });

  it("preserves a non-sipcode hook entry in PreToolUse", async () => {
    const state: MockState = { files: new Map() };
    const io = makeIO(state);

    await writePendingMarker(
      { homeDir: HOME, scriptPath: SCRIPT_PATH, settingsPath: SETTINGS_PATH },
      io,
    );
    const userHooks = {
      hooks: {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "node /some/other/hook.mjs" }],
          },
        ],
      },
    };
    state.files.set(SETTINGS_PATH, JSON.stringify(userHooks, null, 2) + "\n");

    await applyPendingInstall(
      { homeDir: HOME, generateScript: () => DUMMY_SCRIPT },
      io,
    );

    const settings = JSON.parse(state.files.get(SETTINGS_PATH)!);
    const pre = settings.hooks.PreToolUse;
    // Both the user's hook AND sipcode's should be present.
    expect(pre.length).toBe(2);
    const commands = pre.flatMap((e: { hooks: { command: string }[] }) =>
      e.hooks.map((h) => h.command),
    );
    expect(commands.some((c: string) => c.includes("some/other/hook.mjs"))).toBe(true);
    expect(commands.some((c: string) => c.includes("sipcode-proxy"))).toBe(true);
  });

  it("does not crash if settings.json is corrupt — falls back to fresh", async () => {
    const state: MockState = { files: new Map() };
    const io = makeIO(state);

    await writePendingMarker(
      { homeDir: HOME, scriptPath: SCRIPT_PATH, settingsPath: SETTINGS_PATH },
      io,
    );
    state.files.set(SETTINGS_PATH, "{ this is not json");

    const result = await applyPendingInstall(
      { homeDir: HOME, generateScript: () => DUMMY_SCRIPT },
      io,
    );

    expect(result.kind).toBe("applied");
    // The corrupt content was replaced with a clean hooks-only object.
    const settings = JSON.parse(state.files.get(SETTINGS_PATH)!);
    expect(settings.hooks.PreToolUse.length).toBe(1);
  });
});
