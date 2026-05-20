import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SIPCODE_HOOK_SIGNATURE,
  breakpointHookScript,
  pressureHookScript,
} from "../../../src/modules/hygiene/hookScript.js";
import {
  classifyPressure,
  utilizationFromTranscript,
} from "../../../src/modules/hygiene/pressure.js";

function writeTmp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sipcode-hook-"));
  const f = join(dir, name);
  writeFileSync(f, content, "utf-8");
  return f;
}

describe("pressureHookScript", () => {
  it("is valid Node.js — node --check passes", () => {
    const f = writeTmp("sipcode-pressure.mjs", pressureHookScript());
    const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf-8" });
    expect(r.status, r.stderr).toBe(0);
  });

  it("contains the sipcode signature marker", () => {
    expect(pressureHookScript()).toContain(SIPCODE_HOOK_SIGNATURE);
  });

  it("is small (under 100 lines per the spec)", () => {
    const lines = pressureHookScript().split("\n").length;
    expect(lines).toBeLessThan(100);
  });

  it("exits 0 silently with no transcripts available (crash-safe)", () => {
    // Run with HOME pointed at a fresh empty dir; should not crash.
    const home = mkdtempSync(join(tmpdir(), "sipcode-home-"));
    const f = writeTmp("sipcode-pressure.mjs", pressureHookScript());
    const r = spawnSync(process.execPath, [f], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      input: "{}",
      encoding: "utf-8",
      timeout: 5000,
    });
    expect(r.status).toBe(0);
  });
});

describe("breakpointHookScript", () => {
  it("is valid Node.js — node --check passes", () => {
    const f = writeTmp("sipcode-breakpoint.mjs", breakpointHookScript());
    const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf-8" });
    expect(r.status, r.stderr).toBe(0);
  });

  it("contains the sipcode signature marker", () => {
    expect(breakpointHookScript()).toContain(SIPCODE_HOOK_SIGNATURE);
  });

  it("is small (under 100 lines per the spec)", () => {
    const lines = breakpointHookScript().split("\n").length;
    expect(lines).toBeLessThan(100);
  });

  it("emits a breakpoint hint after a successful npm test bash call", () => {
    const f = writeTmp("sipcode-breakpoint.mjs", breakpointHookScript());
    const payload = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      tool_response: { exit_code: 0 },
    });
    const r = spawnSync(process.execPath, [f], {
      input: payload,
      encoding: "utf-8",
      timeout: 5000,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("[sipcode]");
    expect(r.stderr).toContain("tests passed");
  });

  it("emits a hint after a git commit bash call", () => {
    const f = writeTmp("sipcode-breakpoint.mjs", breakpointHookScript());
    const payload = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: 'git commit -m "x"' },
      tool_response: { exit_code: 0 },
    });
    const r = spawnSync(process.execPath, [f], {
      input: payload,
      encoding: "utf-8",
      timeout: 5000,
    });
    expect(r.stderr).toContain("commit landed");
  });

  it("stays silent for unrelated Bash commands", () => {
    const f = writeTmp("sipcode-breakpoint.mjs", breakpointHookScript());
    const payload = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_response: { exit_code: 0 },
    });
    const r = spawnSync(process.execPath, [f], {
      input: payload,
      encoding: "utf-8",
      timeout: 5000,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("stays silent on garbage stdin (crash-safe)", () => {
    const f = writeTmp("sipcode-breakpoint.mjs", breakpointHookScript());
    const r = spawnSync(process.execPath, [f], {
      input: "not json {",
      encoding: "utf-8",
      timeout: 5000,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });
});

describe("pressure classifier", () => {
  it("none below 50%", () => {
    expect(classifyPressure(0.1).band).toBe("none");
    expect(classifyPressure(0.49).band).toBe("none");
  });
  it("p50 at exactly 50%", () => {
    expect(classifyPressure(0.5).band).toBe("p50");
  });
  it("p70 at 70%", () => {
    expect(classifyPressure(0.7).band).toBe("p70");
  });
  it("p90 at 90%+", () => {
    expect(classifyPressure(0.9).band).toBe("p90");
    expect(classifyPressure(1.2).band).toBe("p90");
  });
  it("message includes [sipcode] tag", () => {
    expect(classifyPressure(0.95).message).toContain("[sipcode]");
  });
});

describe("utilizationFromTranscript", () => {
  it("returns 0 for empty input", () => {
    expect(utilizationFromTranscript("")).toBe(0);
  });

  it("returns 0 when no usage line is present", () => {
    expect(utilizationFromTranscript('{"role":"user","content":"hi"}\n')).toBe(0);
  });

  it("computes utilization from the last assistant usage block", () => {
    const lines = [
      JSON.stringify({
        message: {
          usage: { input_tokens: 1000, output_tokens: 500 },
        },
      }),
      JSON.stringify({
        message: {
          usage: {
            input_tokens: 100_000,
            cache_read_input_tokens: 50_000,
            cache_creation_input_tokens: 0,
            output_tokens: 5_000,
          },
        },
      }),
    ];
    const util = utilizationFromTranscript(lines.join("\n"));
    // (100000 + 50000 + 0 + 5000) / 200000 = 0.775
    expect(util).toBeCloseTo(0.775, 3);
    expect(classifyPressure(util).band).toBe("p70");
  });

  it("completes in under 50ms on a 1MB transcript fixture", () => {
    const line =
      JSON.stringify({
        message: { usage: { input_tokens: 180_000, output_tokens: 1000 } },
      }) + "\n";
    const filler = "x".repeat(500) + "\n";
    let bulk = "";
    while (bulk.length < 1_000_000) bulk += filler;
    const content = bulk + line; // hot path: last line matches
    const start = performance.now();
    const u = utilizationFromTranscript(content);
    const ms = performance.now() - start;
    expect(u).toBeGreaterThan(0.9);
    expect(ms, `took ${ms.toFixed(1)}ms`).toBeLessThan(50);
  });
});

describe("hook scripts can be written + readback unchanged (idempotence)", () => {
  it("pressure script — write -> read -> compare", () => {
    const f = writeTmp("sipcode-pressure.mjs", pressureHookScript());
    expect(readFileSync(f, "utf-8")).toBe(pressureHookScript());
  });
  it("breakpoint script — write -> read -> compare", () => {
    const f = writeTmp("sipcode-breakpoint.mjs", breakpointHookScript());
    expect(readFileSync(f, "utf-8")).toBe(breakpointHookScript());
  });
});
