import { describe, it, expect } from "vitest";
import { rewriteLs } from "../../../../src/modules/proxy/rewriters/ls.js";

describe("rewriteLs", () => {
  it("appends `| head -50` to bare `ls`", () => {
    const r = rewriteLs({ command: "ls" });
    expect(r?.updatedInput.command).toBe("ls | head -50");
    expect(r?.rewriterName).toBe("ls");
  });
  it("appends `| head -50` to `ls /tmp`", () => {
    expect(rewriteLs({ command: "ls /tmp" })?.updatedInput.command).toBe("ls /tmp | head -50");
  });
  it("works with flags", () => {
    expect(rewriteLs({ command: "ls -la /var" })?.updatedInput.command).toBe("ls -la /var | head -50");
  });
  it("does NOT rewrite when already piped to head", () => {
    expect(rewriteLs({ command: "ls | head -10" })).toBeNull();
  });
  it("does NOT rewrite when piped to less", () => {
    expect(rewriteLs({ command: "ls | less" })).toBeNull();
  });
  it("does NOT rewrite when chained with && or ;", () => {
    expect(rewriteLs({ command: "ls && pwd" })).toBeNull();
    expect(rewriteLs({ command: "ls; pwd" })).toBeNull();
  });
  it("does NOT match `ls` substrings (lsof)", () => {
    expect(rewriteLs({ command: "lsof -i" })).toBeNull();
  });
});
