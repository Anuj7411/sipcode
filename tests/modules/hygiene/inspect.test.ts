import { describe, expect, it } from "vitest";
import { inspectHygiene } from "../../../src/modules/hygiene/inspect.js";
import { installHygieneBlock } from "../../../src/modules/hygiene/install.js";
import {
  buildHookCommand,
  upsertSipcodeHook,
} from "../../../src/modules/hygiene/settingsJson.js";
import {
  HOOK_BREAKPOINT_ID,
  HOOK_PRESSURE_ID,
} from "../../../src/modules/hygiene/types.js";

describe("inspectHygiene", () => {
  it("reports nothing installed for empty inputs", () => {
    const state = inspectHygiene("", {});
    expect(state.blockInstalled).toBe(false);
    expect(state.pressureHookInstalled).toBe(false);
    expect(state.breakpointHookInstalled).toBe(false);
  });

  it("reports block installed at mode 'default' after installHygieneBlock", () => {
    const r = installHygieneBlock("", "default");
    if (!r.ok) throw new Error("setup");
    const state = inspectHygiene(r.value, {});
    expect(state.blockInstalled).toBe(true);
    expect(state.blockMode).toBe("default");
  });

  it("reports hooks present after upsertSipcodeHook", () => {
    let settings: Record<string, unknown> = {};
    settings = upsertSipcodeHook(settings, {
      event: "PreToolUse",
      matcher: "*",
      scriptPath: "/home/x/.claude/hooks/sipcode-pressure.mjs",
      id: HOOK_PRESSURE_ID,
    });
    settings = upsertSipcodeHook(settings, {
      event: "PostToolUse",
      matcher: "*",
      scriptPath: "/home/x/.claude/hooks/sipcode-breakpoint.mjs",
      id: HOOK_BREAKPOINT_ID,
    });
    const state = inspectHygiene("", settings);
    expect(state.pressureHookInstalled).toBe(true);
    expect(state.breakpointHookInstalled).toBe(true);
  });

  it("buildHookCommand quotes the script path so spaces survive", () => {
    expect(buildHookCommand("/a path/x.mjs")).toBe(`node "/a path/x.mjs"`);
  });
});
