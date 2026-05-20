import { describe, expect, it } from "vitest";
import {
  inspectSipcodeHooks,
  parseSettings,
  removeSipcodeHooks,
  renderSettings,
  upsertSipcodeHook,
} from "../../../src/modules/hygiene/settingsJson.js";
import {
  HOOK_BREAKPOINT_ID,
  HOOK_PRESSURE_ID,
} from "../../../src/modules/hygiene/types.js";

const PRESSURE_PLAN = {
  event: "PreToolUse",
  matcher: "*",
  scriptPath: "/h/.claude/hooks/sipcode-pressure.mjs",
  id: HOOK_PRESSURE_ID,
} as const;

const BREAKPOINT_PLAN = {
  event: "PostToolUse",
  matcher: "*",
  scriptPath: "/h/.claude/hooks/sipcode-breakpoint.mjs",
  id: HOOK_BREAKPOINT_ID,
} as const;

describe("parseSettings", () => {
  it("returns {} for empty input", () => {
    expect(parseSettings("")).toEqual({});
    expect(parseSettings("   ")).toEqual({});
  });
  it("returns {} for invalid JSON", () => {
    expect(parseSettings("not json")).toEqual({});
  });
  it("returns {} for non-object JSON (array, number, null)", () => {
    expect(parseSettings("[1,2]")).toEqual({});
    expect(parseSettings("42")).toEqual({});
    expect(parseSettings("null")).toEqual({});
  });
  it("returns parsed object for valid JSON object", () => {
    expect(parseSettings(`{"a":1}`)).toEqual({ a: 1 });
  });
});

describe("upsertSipcodeHook", () => {
  it("adds a PreToolUse entry when none exist", () => {
    const out = upsertSipcodeHook({}, PRESSURE_PLAN);
    const hooks = out["hooks"] as Record<string, unknown>;
    const arr = hooks["PreToolUse"] as Array<Record<string, unknown>>;
    expect(arr).toHaveLength(1);
    expect(arr[0]?.["matcher"]).toBe("*");
    const inner = (arr[0]?.["hooks"] as Array<{ command: string }>)[0]!;
    expect(inner.command).toContain("sipcode-pressure");
  });

  it("is idempotent — second call with same plan equals first", () => {
    const a = upsertSipcodeHook({}, PRESSURE_PLAN);
    const b = upsertSipcodeHook(a, PRESSURE_PLAN);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("preserves an existing non-sipcode PreToolUse entry", () => {
    const existing = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "echo other-tool" }],
          },
        ],
      },
    };
    const out = upsertSipcodeHook(existing, PRESSURE_PLAN);
    const arr = (out["hooks"] as Record<string, unknown>)["PreToolUse"] as Array<
      Record<string, unknown>
    >;
    expect(arr).toHaveLength(2);
    const others = arr.filter(
      (e) =>
        !((e["hooks"] as Array<{ command: string }>)[0]?.command.includes(
          "sipcode",
        )),
    );
    expect(others).toHaveLength(1);
    expect(
      (others[0]?.["hooks"] as Array<{ command: string }>)[0]?.command,
    ).toBe("echo other-tool");
  });

  it("supports two different events (PreToolUse + PostToolUse)", () => {
    let s: Record<string, unknown> = {};
    s = upsertSipcodeHook(s, PRESSURE_PLAN);
    s = upsertSipcodeHook(s, BREAKPOINT_PLAN);
    const hooks = s["hooks"] as Record<string, unknown>;
    expect(Object.keys(hooks).sort()).toEqual(["PostToolUse", "PreToolUse"]);
  });

  it("upsert replaces an existing sipcode entry rather than duplicating", () => {
    let s = upsertSipcodeHook({}, PRESSURE_PLAN);
    s = upsertSipcodeHook(s, { ...PRESSURE_PLAN, scriptPath: "/new/path.mjs" });
    const arr = (s["hooks"] as Record<string, unknown>)["PreToolUse"] as Array<
      Record<string, unknown>
    >;
    expect(arr).toHaveLength(1);
    const cmd = (arr[0]?.["hooks"] as Array<{ command: string }>)[0]?.command;
    expect(cmd).toContain("/new/path.mjs");
  });
});

describe("removeSipcodeHooks", () => {
  it("removes only sipcode entries, preserves others", () => {
    const seeded: Record<string, unknown> = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "echo other-tool" }],
          },
        ],
      },
    };
    let s = upsertSipcodeHook(seeded, PRESSURE_PLAN);
    s = upsertSipcodeHook(s, BREAKPOINT_PLAN);
    const cleaned = removeSipcodeHooks(s);
    expect(JSON.stringify(cleaned)).toBe(JSON.stringify(seeded));
  });

  it("removes the empty hooks key when no entries remain", () => {
    let s: Record<string, unknown> = {};
    s = upsertSipcodeHook(s, PRESSURE_PLAN);
    s = upsertSipcodeHook(s, BREAKPOINT_PLAN);
    const cleaned = removeSipcodeHooks(s);
    expect(cleaned).toEqual({});
  });

  it("removing when no sipcode entries exist is a no-op (returns input)", () => {
    const settings = { hooks: { PreToolUse: [] } };
    expect(removeSipcodeHooks(settings)).toBe(settings);
  });

  it("removing other top-level keys are untouched", () => {
    let s: Record<string, unknown> = { permissions: { allow: ["Read"] } };
    s = upsertSipcodeHook(s, PRESSURE_PLAN);
    const cleaned = removeSipcodeHooks(s);
    expect(cleaned["permissions"]).toEqual({ allow: ["Read"] });
    expect(cleaned["hooks"]).toBeUndefined();
  });
});

describe("inspectSipcodeHooks", () => {
  it("returns both flags false on empty settings", () => {
    expect(inspectSipcodeHooks({})).toEqual({
      pressureInstalled: false,
      breakpointInstalled: false,
    });
  });

  it("detects pressure but not breakpoint when only one is installed", () => {
    const s = upsertSipcodeHook({}, PRESSURE_PLAN);
    expect(inspectSipcodeHooks(s)).toEqual({
      pressureInstalled: true,
      breakpointInstalled: false,
    });
  });

  it("detects both when both are installed", () => {
    let s: Record<string, unknown> = {};
    s = upsertSipcodeHook(s, PRESSURE_PLAN);
    s = upsertSipcodeHook(s, BREAKPOINT_PLAN);
    expect(inspectSipcodeHooks(s)).toEqual({
      pressureInstalled: true,
      breakpointInstalled: true,
    });
  });
});

describe("renderSettings", () => {
  it("uses 2-space indent + trailing newline", () => {
    const out = renderSettings({ a: 1 });
    expect(out).toBe('{\n  "a": 1\n}\n');
  });
});

describe("round-trip: install + uninstall byte-identical (modulo sipcode entries)", () => {
  it("user's hand-written settings.json shape is preserved", () => {
    const original = {
      permissions: { allow: ["Bash"] },
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "/usr/local/bin/my-hook" }],
          },
        ],
      },
    };
    let s = upsertSipcodeHook(original, PRESSURE_PLAN);
    s = upsertSipcodeHook(s, BREAKPOINT_PLAN);
    const cleaned = removeSipcodeHooks(s);
    expect(JSON.stringify(cleaned)).toBe(JSON.stringify(original));
  });
});
