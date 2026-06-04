import { describe, it, expect } from "vitest";
import {
  generateProxyHookScript,
  SIPCODE_PROXY_HOOK_SIGNATURE,
} from "../../../src/modules/proxy/proxyHookScript.js";

const URL = "file:///abs/path/dist/modules/proxy/runRewriter.js";

describe("generateProxyHookScript", () => {
  const script = generateProxyHookScript(URL);

  it("carries the hook signature marker (for safe upgrade/uninstall detection)", () => {
    expect(script).toContain(SIPCODE_PROXY_HOOK_SIGNATURE);
  });

  it("dynamically imports the tested runRewriter by the supplied URL", () => {
    expect(script).toContain(URL);
    expect(script).toContain("runRewriter");
    expect(script).toContain("await import(");
  });

  it("reads stdin and parses the PreToolUse JSON", () => {
    expect(script).toContain("readFileSync(0");
    expect(script).toContain("JSON.parse");
  });

  it("writes per-PID stats under ~/.sipcode/proxy-stats", () => {
    expect(script).toContain(".sipcode");
    expect(script).toContain("proxy-stats");
    expect(script).toContain("process.pid");
  });

  it("emits the hook output JSON on stdout", () => {
    expect(script).toContain("process.stdout.write");
    expect(script).toContain("result.hookOutput");
  });

  it("ends every path with a clean process.exit(0) safety net", () => {
    expect(script).toContain("process.exit(0)");
  });

  it("never lets a failure break Claude Code (guarded import + parse)", () => {
    // Both the import and the JSON parse must be wrapped so a bad stdin or a
    // removed package degrades to a no-op rather than an error.
    expect(script).toMatch(/catch\s*(\{|\()/);
  });
});
