import { describe, it, expect } from "vitest";
import {
  installProxyHook,
  uninstallProxyHook,
  proxyHookScriptPath,
} from "../../src/modules/proxy/install.js";

const SCRIPT = "/home/u/.claude/hooks/sipcode-proxy.mjs";

describe("proxy install round-trip", () => {
  it("install adds a PreToolUse '*' entry pointing at the hook script", () => {
    const installed = installProxyHook({}, SCRIPT) as Record<string, any>;
    const pre = installed.hooks.PreToolUse;
    expect(Array.isArray(pre)).toBe(true);
    const entry = pre.find((e: any) =>
      e.hooks?.some((h: any) => h.command?.includes("sipcode-proxy")),
    );
    expect(entry.matcher).toBe("*");
    expect(entry.hooks[0].command).toBe(`node "${SCRIPT}"`);
  });

  it("uninstall restores the original settings byte-for-byte", () => {
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
    const installed = installProxyHook(original, SCRIPT);
    const cleaned = uninstallProxyHook(installed);
    expect(JSON.stringify(cleaned)).toBe(JSON.stringify(original));
  });

  it("install is idempotent (no duplicate entries)", () => {
    const once = installProxyHook({}, SCRIPT);
    const twice = installProxyHook(once, SCRIPT);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("uninstall on settings with no proxy hook is a no-op", () => {
    const settings = { hooks: { PreToolUse: [] } };
    expect(uninstallProxyHook(settings)).toBe(settings);
  });

  it("proxyHookScriptPath builds the canonical hook location", () => {
    const p = proxyHookScriptPath("/home/u");
    expect(p.replace(/\\/g, "/")).toBe("/home/u/.claude/hooks/sipcode-proxy.mjs");
  });
});
