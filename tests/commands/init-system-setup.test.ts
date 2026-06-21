/**
 * Tests for v1.6.15 `sipcode init` system-setup additions.
 *
 * Two surfaces under test:
 *   1. `runSystemSetup` — orchestrates detection / proxy install / install
 *      marker / MCP verify with IO seams mocked. Asserts that each step
 *      degrades safely when its dependency is unavailable.
 *   2. `formatSetupCard` — pure formatter for the style-C SETUP card.
 *      Character-matches output for stability across versions.
 *
 * The existing `runInit` integration tests live elsewhere and DO NOT pass
 * `homeDir`, so they skip system-setup entirely. Those tests guard the
 * legacy behavior; these tests guard the new behavior.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  runSystemSetup,
  formatSetupCard,
  type SystemSetupResult,
  type SystemSetupDeps,
  type StepStatus,
} from "../../src/commands/init.js";

const HOME = "/home/user";
const CWD = "/proj";
const NOW = new Date("2026-06-15T12:00:00.000Z");

interface MockState {
  files: Map<string, string>;
  detectInstalled?: boolean;
  detectVersion?: string | null;
  mcpToolCount?: number;
  mcpVerifyThrows?: boolean;
  installMarkerThrows?: boolean;
}

function makeDeps(
  state: MockState,
  rulesMode: SystemSetupDeps["rulesMode"] = "default",
): SystemSetupDeps {
  return {
    homeDir: HOME,
    cwd: CWD,
    rulesMode,
    async readFile(p) {
      return state.files.get(p);
    },
    async writeFile(p, content) {
      const normalized = p.replace(/\\/g, "/");
      if (normalized.includes(".sipcode/install-state.json") && state.installMarkerThrows) {
        throw new Error("disk full");
      }
      state.files.set(p, content);
    },
    async detectClaudeCode() {
      return {
        installed: state.detectInstalled ?? true,
        version: state.detectVersion ?? null,
      };
    },
    async verifyMcpToolCount() {
      if (state.mcpVerifyThrows) throw new Error("mcp boot timeout");
      return state.mcpToolCount ?? 15;
    },
    now() {
      return NOW;
    },
  };
}

const OPTS_DEFAULT = { noProxy: false, noMarker: false, noVerifyMcp: false };

describe("runSystemSetup — detection gates everything", () => {
  it("skips everything when Claude Code is not detected", async () => {
    const state: MockState = { files: new Map(), detectInstalled: false };
    const result = await runSystemSetup(OPTS_DEFAULT, makeDeps(state));

    expect(result.claudeCodeDetected.kind).toBe("skipped");
    expect(result.settingsWritable.kind).toBe("skipped");
    expect(result.proxyHook.kind).toBe("skipped");
    expect(result.installMarker.kind).toBe("skipped");
    expect(result.mcpVerify.kind).toBe("skipped");
  });

  it("proceeds when Claude Code is detected, reports version when available", async () => {
    const state: MockState = {
      files: new Map(),
      detectInstalled: true,
      detectVersion: "2.1.170",
    };
    const result = await runSystemSetup(OPTS_DEFAULT, makeDeps(state));

    expect(result.claudeCodeDetected.kind).toBe("ok");
    expect((result.claudeCodeDetected as { kind: "ok"; detail: string }).detail).toBe("2.1.170");
  });
});

describe("runSystemSetup — proxy hook installation", () => {
  it("installs the proxy hook when settings.json is empty", async () => {
    const state: MockState = { files: new Map() };
    const result = await runSystemSetup(OPTS_DEFAULT, makeDeps(state));

    expect(result.proxyHook.kind).toBe("ok");
    // The hook .mjs and settings.json should have been written.
    const writtenSettings = [...state.files.keys()].find((k) =>
      k.endsWith("settings.json"),
    );
    expect(writtenSettings).toBeDefined();
  });

  it("reports 'already installed' when settings + script are unchanged", async () => {
    // Simulate idempotency: pre-populate the cache with the exact strings
    // the install would write. The trick — re-call to capture the strings,
    // then re-run to assert idempotency on the second pass.
    const state: MockState = { files: new Map() };
    await runSystemSetup(OPTS_DEFAULT, makeDeps(state));

    // Snapshot the post-install file map and re-run with the same state.
    const result2 = await runSystemSetup(OPTS_DEFAULT, makeDeps(state));
    expect(result2.proxyHook.kind).toBe("ok");
    expect((result2.proxyHook as { kind: "ok"; detail: string }).detail).toBe(
      "already installed",
    );
  });

  it("--no-proxy flag skips the proxy step", async () => {
    const state: MockState = { files: new Map() };
    const result = await runSystemSetup(
      { ...OPTS_DEFAULT, noProxy: true },
      makeDeps(state),
    );
    expect(result.proxyHook.kind).toBe("skipped");
    expect((result.proxyHook as { kind: "skipped"; reason: string }).reason).toContain(
      "--no-proxy",
    );
  });

  it("captures a proxy install failure without throwing", async () => {
    // writeFile rejects → step should set status to "failed", everything
    // else (marker, mcp verify) should still run.
    const state: MockState = { files: new Map() };
    const deps = makeDeps(state);
    const brokenDeps: SystemSetupDeps = {
      ...deps,
      async writeFile(p) {
        if (p.endsWith(".mjs") || p.endsWith("settings.json")) {
          throw new Error("permission denied");
        }
      },
    };

    const result = await runSystemSetup(OPTS_DEFAULT, brokenDeps);

    expect(result.proxyHook.kind).toBe("failed");
    expect((result.proxyHook as { kind: "failed"; reason: string }).reason).toContain(
      "permission denied",
    );
    // Marker step should still attempt (proxy failure doesn't cascade).
    expect(result.installMarker.kind).toBe("ok");
    expect(result.mcpVerify.kind).toBe("ok");
  });
});

describe("runSystemSetup — install marker for `sipcode impact`", () => {
  it("writes the install marker when rules mode is not 'skip'", async () => {
    const state: MockState = { files: new Map() };
    const result = await runSystemSetup(OPTS_DEFAULT, makeDeps(state, "default"));

    expect(result.installMarker.kind).toBe("ok");
    const markerKey = [...state.files.keys()].find((k) =>
      k.endsWith("install-state.json"),
    );
    expect(markerKey).toBeDefined();
    const marker = JSON.parse(state.files.get(markerKey!)!);
    expect(marker.rulesInstalledAt).toBe(NOW.toISOString());
    expect(marker.rulesMode).toBe("default");
  });

  it("--no-marker flag skips the marker step", async () => {
    const state: MockState = { files: new Map() };
    const result = await runSystemSetup(
      { ...OPTS_DEFAULT, noMarker: true },
      makeDeps(state),
    );
    expect(result.installMarker.kind).toBe("skipped");
    expect(
      (result.installMarker as { kind: "skipped"; reason: string }).reason,
    ).toContain("--no-marker");
  });

  it("skips the marker when rules mode is 'skip' (semantic — no baseline)", async () => {
    const state: MockState = { files: new Map() };
    const result = await runSystemSetup(OPTS_DEFAULT, makeDeps(state, "skip"));
    expect(result.installMarker.kind).toBe("skipped");
    expect(
      (result.installMarker as { kind: "skipped"; reason: string }).reason,
    ).toContain("rules mode is 'skip'");
  });

  it("captures a marker write failure as 'failed', doesn't throw", async () => {
    const state: MockState = { files: new Map(), installMarkerThrows: true };
    const result = await runSystemSetup(OPTS_DEFAULT, makeDeps(state));
    expect(result.installMarker.kind).toBe("failed");
    expect((result.installMarker as { kind: "failed"; reason: string }).reason).toContain(
      "disk full",
    );
    // MCP step should still run.
    expect(result.mcpVerify.kind).toBe("ok");
  });
});

describe("runSystemSetup — MCP tool count verification", () => {
  it("reports the tool count when verify succeeds", async () => {
    const state: MockState = { files: new Map(), mcpToolCount: 15 };
    const result = await runSystemSetup(OPTS_DEFAULT, makeDeps(state));
    expect(result.mcpVerify.kind).toBe("ok");
    expect((result.mcpVerify as { kind: "ok"; detail: string }).detail).toBe(
      "15 tools registered",
    );
  });

  it("--no-verify-mcp skips the verification", async () => {
    const state: MockState = { files: new Map() };
    const result = await runSystemSetup(
      { ...OPTS_DEFAULT, noVerifyMcp: true },
      makeDeps(state),
    );
    expect(result.mcpVerify.kind).toBe("skipped");
  });

  it("captures a verify failure without throwing", async () => {
    const state: MockState = { files: new Map(), mcpVerifyThrows: true };
    const result = await runSystemSetup(OPTS_DEFAULT, makeDeps(state));
    expect(result.mcpVerify.kind).toBe("failed");
    expect((result.mcpVerify as { kind: "failed"; reason: string }).reason).toContain(
      "mcp boot timeout",
    );
  });
});

describe("runSystemSetup — concurrent failure isolation", () => {
  it("a single step failure does not poison the rest", async () => {
    const state: MockState = {
      files: new Map(),
      mcpVerifyThrows: true,
      installMarkerThrows: true,
    };
    const deps = makeDeps(state);
    const brokenDeps: SystemSetupDeps = {
      ...deps,
      async writeFile(p, c) {
        if (p.endsWith(".mjs") || p.endsWith("settings.json")) {
          throw new Error("proxy write failed");
        }
        if (p.includes("install-state.json")) {
          throw new Error("marker write failed");
        }
        state.files.set(p, c);
      },
    };

    const result = await runSystemSetup(OPTS_DEFAULT, brokenDeps);

    // All three real failures show as 'failed', detection still 'ok'.
    expect(result.claudeCodeDetected.kind).toBe("ok");
    expect(result.proxyHook.kind).toBe("failed");
    expect(result.installMarker.kind).toBe("failed");
    expect(result.mcpVerify.kind).toBe("failed");
  });
});

// ─── formatSetupCard — pure formatter, character-matched ────────────────

const okStep = (detail?: string): StepStatus => ({ kind: "ok", ...(detail ? { detail } : {}) });
const skipStep = (reason: string): StepStatus => ({ kind: "skipped", reason });
const failStep = (reason: string): StepStatus => ({ kind: "failed", reason });

describe("formatSetupCard — output structure", () => {
  it("renders the success card with all five ✓ rows + ready footer", () => {
    const card = formatSetupCard({
      manifestRelativePath: ".sipcode/manifest.md",
      rulesInstalled: true,
      rulesMode: "default",
      claudeMdRelativePath: "CLAUDE.md",
      systemSetup: {
        claudeCodeDetected: okStep("v2.1.170"),
        settingsWritable: okStep("writable"),
        proxyHook: okStep("installed (signature v4)"),
        installMarker: okStep("impact baseline starts now"),
        mcpVerify: okStep("15 tools registered"),
      },
    });

    expect(card).toContain("  SETUP");
    expect(card).toContain("✓ project manifest");
    expect(card).toContain("✓ Claude Code detected");
    expect(card).toContain("✓ proxy hook installed");
    expect(card).toContain("✓ install marker set");
    expect(card).toContain("✓ MCP server verified");
    expect(card).toContain(
      "ready. your next Claude Code session will use Sipcode automatically.",
    );
    expect(card).toContain("▸ verify in 5 minutes:  sipcode drift");
    expect(card).toContain("▸ measure delta in 3-7 days:  sipcode impact");
  });

  it("renders the Cursor / no-Claude-Code partial card", () => {
    const card = formatSetupCard({
      manifestRelativePath: ".sipcode/manifest.md",
      rulesInstalled: true,
      rulesMode: "default",
      claudeMdRelativePath: "AGENTS.md",
      systemSetup: {
        claudeCodeDetected: skipStep("no ~/.claude directory found"),
        settingsWritable: skipStep("depends on detection"),
        proxyHook: skipStep("depends on settings"),
        installMarker: skipStep("deferred until rules complete"),
        mcpVerify: skipStep("depends on detection"),
      },
    });

    expect(card).toContain("⏵ Claude Code detected");
    expect(card).toContain(
      "partial setup. install Claude Code separately to also enable the proxy + MCP.",
    );
    expect(card).toContain("▸ reload your agent to pick up the new project rules");
    // The "ready" footer must NOT appear in partial mode.
    expect(card).not.toContain("ready. your next Claude Code session");
  });

  it("renders a partial card when proxy install failed", () => {
    const card = formatSetupCard({
      manifestRelativePath: ".sipcode/manifest.md",
      rulesInstalled: true,
      rulesMode: "default",
      claudeMdRelativePath: "CLAUDE.md",
      systemSetup: {
        claudeCodeDetected: okStep("v2.1.170"),
        settingsWritable: okStep("writable"),
        proxyHook: failStep("permission denied"),
        installMarker: okStep("impact baseline starts now"),
        mcpVerify: okStep("15 tools registered"),
      },
    });

    expect(card).toContain("✗ proxy hook installed");
    expect(card).toContain("permission denied");
    expect(card).toContain(
      "partial setup. one or more system steps were skipped or failed.",
    );
    expect(card).toContain("re-run sipcode init to retry");
  });

  it("renders the rule line separating problem block from action block", () => {
    const card = formatSetupCard({
      manifestRelativePath: ".sipcode/manifest.md",
      rulesInstalled: true,
      rulesMode: "default",
      claudeMdRelativePath: "CLAUDE.md",
      systemSetup: {
        claudeCodeDetected: okStep("v2.1.170"),
        settingsWritable: okStep("writable"),
        proxyHook: okStep("installed"),
        installMarker: okStep("set"),
        mcpVerify: okStep("15"),
      },
    });
    expect(card).toMatch(/━━━+/);
  });

  it("uses ⏵ for skipped, ✗ for failed, ✓ for ok markers", () => {
    const card = formatSetupCard({
      manifestRelativePath: null,
      rulesInstalled: false,
      rulesMode: "skip",
      claudeMdRelativePath: null,
      systemSetup: {
        claudeCodeDetected: okStep("v2.1.170"),
        settingsWritable: okStep("writable"),
        proxyHook: skipStep("--no-proxy flag"),
        installMarker: failStep("disk full"),
        mcpVerify: okStep("15 tools"),
      },
    });

    // All three marker characters present in the same render.
    expect(card).toContain("✓");
    expect(card).toContain("⏵");
    expect(card).toContain("✗");
  });
});

// ──────────── v1.6.16 F-CACHE-DEFER tests ─────────────────────────────────

import type { ActiveSessionsResult } from "../../src/modules/init/sessionDetection.js";

describe("runSystemSetup — F-CACHE-DEFER (v1.6.16)", () => {
  function withDefer(
    state: MockState,
    overrides: {
      active?: ActiveSessionsResult;
      detectionThrows?: boolean;
      markerWriteThrows?: boolean;
      markerCalls?: { path: string; content: string }[];
    } = {},
  ): SystemSetupDeps {
    const base = makeDeps(state, "default");
    return {
      ...base,
      async detectActiveSessions() {
        if (overrides.detectionThrows) throw new Error("EACCES projects");
        return (
          overrides.active ?? {
            active: false,
            count: 0,
            projectsDirExists: false,
          }
        );
      },
      async writeDeferredMarker(input) {
        if (overrides.markerWriteThrows) throw new Error("disk full marker");
        // Simulate the production writeDeferredMarker side-effect: write a
        // pending marker into state.files at the conventional path so tests
        // can assert it.
        const markerPath = path
          .join(input.homeDir, ".sipcode", "install-pending.json")
          .replace(/\\/g, "/")
          .replace(/^\//, "/");
        const content = JSON.stringify({
          schemaVersion: "sipcode-install-pending/1",
          createdAt: NOW.toISOString(),
          scriptPath: input.scriptPath,
          settingsPath: input.settingsPath,
        });
        state.files.set(
          path.join(input.homeDir, ".sipcode", "install-pending.json"),
          content,
        );
        overrides.markerCalls?.push({
          path: input.scriptPath,
          content,
        });
      },
    };
  }

  it("defers the proxy install when an active session is detected", async () => {
    const state: MockState = { files: new Map() };
    const result = await runSystemSetup(
      OPTS_DEFAULT,
      withDefer(state, {
        active: { active: true, count: 1, projectsDirExists: true },
      }),
    );

    expect(result.proxyHook.kind).toBe("deferred");
    expect(
      (result.proxyHook as { kind: "deferred"; reason: string }).reason,
    ).toContain("active claude code session");

    // settings.json must NOT have been written.
    const settingsKey = [...state.files.keys()].find((k) =>
      k.endsWith("settings.json"),
    );
    expect(settingsKey).toBeUndefined();

    // The hook script file SHOULD have been written (safe operation).
    const scriptKey = [...state.files.keys()].find((k) =>
      k.endsWith("sipcode-proxy.mjs"),
    );
    expect(scriptKey).toBeDefined();

    // The pending-install marker SHOULD have been written.
    const markerKey = [...state.files.keys()].find((k) =>
      k.endsWith("install-pending.json"),
    );
    expect(markerKey).toBeDefined();
    const marker = JSON.parse(state.files.get(markerKey!)!);
    expect(marker.schemaVersion).toBe("sipcode-install-pending/1");
  });

  it("installs normally when no active session is detected", async () => {
    const state: MockState = { files: new Map() };
    const result = await runSystemSetup(
      OPTS_DEFAULT,
      withDefer(state, {
        active: { active: false, count: 0, projectsDirExists: true },
      }),
    );

    expect(result.proxyHook.kind).toBe("ok");
    const settingsKey = [...state.files.keys()].find((k) =>
      k.endsWith("settings.json"),
    );
    expect(settingsKey).toBeDefined();
    const markerKey = [...state.files.keys()].find((k) =>
      k.endsWith("install-pending.json"),
    );
    expect(markerKey).toBeUndefined();
  });

  it("--force overrides defer even with an active session", async () => {
    const state: MockState = { files: new Map() };
    const result = await runSystemSetup(
      { ...OPTS_DEFAULT, force: true },
      withDefer(state, {
        active: { active: true, count: 3, projectsDirExists: true },
      }),
    );

    expect(result.proxyHook.kind).toBe("ok");
    const settingsKey = [...state.files.keys()].find((k) =>
      k.endsWith("settings.json"),
    );
    expect(settingsKey).toBeDefined();
    const markerKey = [...state.files.keys()].find((k) =>
      k.endsWith("install-pending.json"),
    );
    expect(markerKey).toBeUndefined();
  });

  it("defers the install marker too when proxy is deferred", async () => {
    const state: MockState = { files: new Map() };
    const result = await runSystemSetup(
      OPTS_DEFAULT,
      withDefer(state, {
        active: { active: true, count: 1, projectsDirExists: true },
      }),
    );

    expect(result.installMarker.kind).toBe("deferred");
    expect(
      (result.installMarker as { kind: "deferred"; reason: string }).reason,
    ).toContain("proxy install deferred");
  });

  it("falls back to install when detection throws (defensive)", async () => {
    const state: MockState = { files: new Map() };
    const result = await runSystemSetup(
      OPTS_DEFAULT,
      withDefer(state, { detectionThrows: true }),
    );

    // Detection broke; default = proceed with install rather than blocking.
    expect(result.proxyHook.kind).toBe("ok");
    const settingsKey = [...state.files.keys()].find((k) =>
      k.endsWith("settings.json"),
    );
    expect(settingsKey).toBeDefined();
  });

  it("reports 'failed' when marker write throws", async () => {
    const state: MockState = { files: new Map() };
    const result = await runSystemSetup(
      OPTS_DEFAULT,
      withDefer(state, {
        active: { active: true, count: 1, projectsDirExists: true },
        markerWriteThrows: true,
      }),
    );

    expect(result.proxyHook.kind).toBe("failed");
    expect(
      (result.proxyHook as { kind: "failed"; reason: string }).reason,
    ).toContain("disk full");
  });

  it("singular vs plural in the deferred reason", async () => {
    const state1: MockState = { files: new Map() };
    const r1 = await runSystemSetup(
      OPTS_DEFAULT,
      withDefer(state1, {
        active: { active: true, count: 1, projectsDirExists: true },
      }),
    );
    expect(
      (r1.proxyHook as { kind: "deferred"; reason: string }).reason,
    ).toContain("1 active claude code session");

    const state2: MockState = { files: new Map() };
    const r2 = await runSystemSetup(
      OPTS_DEFAULT,
      withDefer(state2, {
        active: { active: true, count: 2, projectsDirExists: true },
      }),
    );
    expect(
      (r2.proxyHook as { kind: "deferred"; reason: string }).reason,
    ).toContain("2 active claude code sessions");
  });
});

describe("formatSetupCard — F-CACHE-DEFER deferred state (v1.6.16)", () => {
  const okStep = (detail: string) => ({ kind: "ok" as const, detail });
  const deferStep = (reason: string) => ({
    kind: "deferred" as const,
    reason,
  });

  it("renders ⏸ glyph for deferred steps", () => {
    const card = formatSetupCard({
      manifestRelativePath: ".sipcode/manifest.md",
      rulesInstalled: true,
      rulesMode: "default",
      claudeMdRelativePath: "CLAUDE.md",
      systemSetup: {
        claudeCodeDetected: okStep("v2.1.170"),
        settingsWritable: okStep("writable"),
        proxyHook: deferStep("1 active claude code session detected"),
        installMarker: deferStep("proxy install deferred"),
        mcpVerify: okStep("15 tools registered"),
      },
    });
    expect(card).toContain("⏸");
    expect(card).toContain("deferred to protect");
    expect(card).toContain("auto-applies on your next sipcode command");
    expect(card).toContain("--force");
  });
});

