import { describe, it, expect } from "vitest";
import {
  generateProxyHookScript,
  SIPCODE_PROXY_HOOK_SIGNATURE,
} from "../../../src/modules/proxy/proxyHookScript.js";

const RUN_URL = "file:///abs/path/dist/modules/proxy/runRewriter.js";
const DEDUP_URL = "file:///abs/path/dist/modules/proxy/hookReadDedup.js";
const AST_URL = "file:///abs/path/dist/modules/proxy/hookAstRead.js";

describe("generateProxyHookScript", () => {
  const script = generateProxyHookScript(RUN_URL, DEDUP_URL, AST_URL);

  it("carries the hook signature marker (for safe upgrade/uninstall detection)", () => {
    expect(script).toContain(SIPCODE_PROXY_HOOK_SIGNATURE);
  });

  it("signature is v4 once AST routing is wired (v3 was dedup-only)", () => {
    expect(SIPCODE_PROXY_HOOK_SIGNATURE).toContain("v4");
  });

  it("dynamically imports all three orchestrators by the supplied URLs", () => {
    expect(script).toContain(RUN_URL);
    expect(script).toContain(DEDUP_URL);
    expect(script).toContain(AST_URL);
    expect(script).toContain("runRewriter");
    expect(script).toContain("hookReadDedup");
    expect(script).toContain("hookAstRead");
    expect(script).toContain("recordSignal");
    expect(script).toContain("await import(");
  });

  it("records search signals before per-tool routing", () => {
    expect(script).toMatch(/recordSignal\s*\(/);
  });

  it("routes Read calls through hookAstRead BEFORE hookReadDedup", () => {
    const astIdx = script.indexOf("hookAstRead(input");
    const dedupIdx = script.indexOf("hookReadDedup(input");
    expect(astIdx).toBeGreaterThan(0);
    expect(dedupIdx).toBeGreaterThan(astIdx);
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
